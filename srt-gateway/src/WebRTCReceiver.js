const wrtc = require('wrtc');
const { EventEmitter } = require('events');

const { RTCPeerConnection, MediaStream } = wrtc;

/**
 * WebRTCReceiver - Handles WebRTC connections for SRT Gateway
 * Receives streams from BreadCall signaling server
 */
class WebRTCReceiver extends EventEmitter {
  constructor() {
    super();
    this.peers = new Map(); // peerId -> { pc, stream, mediaStream }
    this.signaling = null;
    this.roomId = null;
    this.participantId = null;
    this.connected = false;

    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];
  }

  /**
   * Connect to signaling server and join room
   * @param {string} signalingUrl - WebSocket URL
   * @param {string} roomId - Room ID
   */
  async connect(signalingUrl, roomId) {
    this.roomId = roomId;

    return new Promise((resolve, reject) => {
      this.signaling = new WebSocket(signalingUrl);

      this.signaling.onopen = () => {
        console.log('[WebRTCReceiver] Connected to signaling');
        this.signaling.send(JSON.stringify({
          type: 'join-room',
          payload: { roomId, name: 'SRT Gateway' }
        }));
      };

      this.signaling.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (error) {
          console.error('[WebRTCReceiver] Parse error:', error);
        }
      };

      this.signaling.onerror = (error) => {
        console.error('[WebRTCReceiver] Signaling error:', error);
        reject(new Error('Signaling connection failed'));
      };

      this.signaling.onclose = () => {
        console.log('[WebRTCReceiver] Signaling closed');
        this.connected = false;
        this.emit('disconnected');
      };

      setTimeout(() => {
        if (!this.connected) reject(new Error('Connection timeout'));
      }, 10000);
    });
  }

  handleMessage(data) {
    const { type } = data;

    switch (type) {
      case 'joined-room':
        this.handleJoinedRoom(data);
        break;
      case 'participant-joined':
        this.emit('peer-joined', { peerId: data.participantId });
        break;
      case 'participant-left':
        this.handleParticipantLeft(data);
        break;
      case 'offer':
        this.handleOffer(data);
        break;
      case 'answer':
        this.handleAnswer(data);
        break;
      case 'ice-candidate':
        this.handleIceCandidate(data);
        break;
    }
  }

  handleJoinedRoom(data) {
    const { participantId, existingPeers } = data;
    this.participantId = participantId;
    this.connected = true;

    console.log('[WebRTCReceiver] Joined as', participantId);

    existingPeers.forEach(peer => {
      this.createPeerConnection(peer.participantId);
      this.createOffer(peer.participantId);
    });
  }

  handleParticipantLeft(data) {
    const { participantId } = data;
    this.closePeerConnection(participantId);
    this.emit('peer-left', { peerId: participantId });
  }

  createPeerConnection(peerId) {
    if (this.peers.has(peerId)) return this.peers.get(peerId).pc;

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });

    const remoteStream = new MediaStream();
    pc.ontrack = (event) => {
      event.streams[0].getTracks().forEach(track => {
        remoteStream.addTrack(track);
      });
      console.log('[WebRTCReceiver] Received track from', peerId);
      this.emit('stream', peerId, remoteStream);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendIceCandidate(peerId, event.candidate);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.closePeerConnection(peerId);
      }
    };

    this.peers.set(peerId, { pc, stream: remoteStream });
    return pc;
  }

  async createOffer(peerId) {
    try {
      const pc = this.createPeerConnection(peerId);
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      await pc.setLocalDescription(offer);

      this.signaling.send(JSON.stringify({
        type: 'offer',
        payload: { targetPeerId: peerId, sdp: pc.localDescription }
      }));
    } catch (error) {
      console.error('[WebRTCReceiver] Create offer error:', error);
    }
  }

  async handleOffer(data) {
    try {
      const { from, sdp } = data;
      const pc = this.createPeerConnection(from);
      await pc.setRemoteDescription(new wrtc.RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.signaling.send(JSON.stringify({
        type: 'answer',
        payload: { targetPeerId: from, sdp: pc.localDescription }
      }));
    } catch (error) {
      console.error('[WebRTCReceiver] Handle offer error:', error);
    }
  }

  async handleAnswer(data) {
    try {
      const { from, sdp } = data;
      const peer = this.peers.get(from);
      if (peer) {
        await peer.pc.setRemoteDescription(new wrtc.RTCSessionDescription(sdp));
      }
    } catch (error) {
      console.error('[WebRTCReceiver] Handle answer error:', error);
    }
  }

  async handleIceCandidate(data) {
    try {
      const { from, candidate } = data;
      const peer = this.peers.get(from);
      if (peer && candidate.candidate) {
        await peer.pc.addIceCandidate(new wrtc.RTCIceCandidate(candidate));
      }
    } catch (error) {
      console.error('[WebRTCReceiver] Add ICE candidate error:', error);
    }
  }

  sendIceCandidate(peerId, candidate) {
    this.signaling.send(JSON.stringify({
      type: 'ice-candidate',
      payload: { targetPeerId: peerId, candidate }
    }));
  }

  closePeerConnection(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.pc.close();
      this.peers.delete(peerId);
    }
  }

  getStream(peerId) {
    const peer = this.peers.get(peerId);
    return peer ? peer.stream : null;
  }

  getPeers() {
    return Array.from(this.peers.keys()).map(id => ({
      peerId: id,
      hasStream: !!this.peers.get(id)?.stream
    }));
  }

  isConnected() {
    return this.connected;
  }

  async disconnect() {
    if (this.signaling) {
      this.signaling.close();
    }
    for (const peerId of this.peers.keys()) {
      this.closePeerConnection(peerId);
    }
    this.peers.clear();
    this.connected = false;
  }
}

module.exports = { WebRTCReceiver };
