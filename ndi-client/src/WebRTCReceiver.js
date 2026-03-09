const wrtc = require('wrtc');
const { EventEmitter } = require('events');
const fetch = require('node-fetch');
const WebSocket = require('ws');

const { RTCPeerConnection, MediaStream } = wrtc;

/**
 * WebRTCReceiver - Handles WebRTC connections for receiving streams
 * Extends EventEmitter for IPC communication with UI
 */
class WebRTCReceiver extends EventEmitter {
  constructor() {
    super();
    this.peers = new Map(); // peerId -> { pc, stream, element }
    this.localStream = null;
    this.signaling = null;
    this.roomId = null;
    this.participantId = null;
    this.serverUrl = null;

    // ICE servers (use public STUN + optional TURN)
    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];
  }

  /**
   * Connect to signaling server and join room
   * @param {string} serverUrl - WebSocket server URL
   * @param {string} roomId - Room ID to join
   */
  async connect(serverUrl, roomId) {
    this.serverUrl = serverUrl;
    this.roomId = roomId;

    return new Promise((resolve, reject) => {
      const wsProtocol = serverUrl.startsWith('https') ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${serverUrl.replace(/https?:\/\//, '')}/ws`;

      this.signaling = new WebSocket(wsUrl);

      this.signaling.onopen = () => {
        console.log('[WebRTCReceiver] Connected to signaling server');
        // Join room as silent viewer (no local media)
        this.signaling.send(JSON.stringify({
          type: 'join-room',
          payload: {
            roomId,
            name: 'NDI Client'
          }
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
        this.emit('error', { message: 'Signaling connection failed' });
        reject(new Error('Signaling connection failed'));
      };

      this.signaling.onclose = () => {
        console.log('[WebRTCReceiver] Signaling connection closed');
        this.emit('disconnected');
      };

      // Timeout for connection
      setTimeout(() => {
        if (this.signaling.readyState !== WebSocket.OPEN) {
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Handle incoming signaling messages
   * @param {Object} data - Message data
   */
  handleMessage(data) {
    const { type } = data;

    switch (type) {
      case 'joined-room':
        this.handleJoinedRoom(data);
        break;

      case 'participant-joined':
        this.emit('peer-joined', { peerId: data.participantId, name: data.name });
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

      default:
        console.log('[WebRTCReceiver] Unknown message type:', type);
    }
  }

  /**
   * Handle joined-room response
   * @param {Object} data - Message data
   */
  handleJoinedRoom(data) {
    const { participantId, existingPeers } = data;
    this.participantId = participantId;

    console.log('[WebRTCReceiver] Joined room as', participantId);

    // Create offers for existing peers
    existingPeers.forEach(peer => {
      this.createPeerConnection(peer.participantId);
      this.createOffer(peer.participantId);
    });
  }

  /**
   * Handle participant leaving
   * @param {Object} data - Message data
   */
  handleParticipantLeft(data) {
    const { participantId } = data;
    this.closePeerConnection(participantId);
    this.emit('peer-left', { peerId: participantId });
  }

  /**
   * Create peer connection for a peer
   * @param {string} peerId
   */
  createPeerConnection(peerId) {
    if (this.peers.has(peerId)) {
      return this.peers.get(peerId).pc;
    }

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers
    });

    // Handle remote track
    const remoteStream = new MediaStream();
    pc.ontrack = (event) => {
      console.log('[WebRTCReceiver] Received track from', peerId);
      event.streams[0].getTracks().forEach(track => {
        remoteStream.addTrack(track);
      });
      this.emit('stream', peerId, remoteStream);
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendIceCandidate(peerId, event.candidate);
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log('[WebRTCReceiver] Connection state:', peerId, pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.closePeerConnection(peerId);
      }
    };

    this.peers.set(peerId, { pc, stream: remoteStream });
    return pc;
  }

  /**
   * Create and send offer to peer
   * @param {string} peerId
   */
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
        payload: {
          targetPeerId: peerId,
          sdp: pc.localDescription
        }
      }));

      console.log('[WebRTCReceiver] Created offer for', peerId);
    } catch (error) {
      console.error('[WebRTCReceiver] Create offer error:', error);
      this.emit('error', { message: `Failed to create offer: ${error.message}` });
    }
  }

  /**
   * Handle incoming offer
   * @param {Object} data - Offer data
   */
  async handleOffer(data) {
    try {
      const { from, sdp } = data;
      const pc = this.createPeerConnection(from);

      await pc.setRemoteDescription(new wrtc.RTCSessionDescription(sdp));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.signaling.send(JSON.stringify({
        type: 'answer',
        payload: {
          targetPeerId: from,
          sdp: pc.localDescription
        }
      }));

      console.log('[WebRTCReceiver] Sent answer to', from);
    } catch (error) {
      console.error('[WebRTCReceiver] Handle offer error:', error);
      this.emit('error', { message: `Failed to handle offer: ${error.message}` });
    }
  }

  /**
   * Handle incoming answer
   * @param {Object} data - Answer data
   */
  async handleAnswer(data) {
    try {
      const { from, sdp } = data;
      const peer = this.peers.get(from);

      if (!peer) {
        console.warn('[WebRTCReceiver] No peer found for answer from', from);
        return;
      }

      await peer.pc.setRemoteDescription(new wrtc.RTCSessionDescription(sdp));
      console.log('[WebRTCReceiver] Set remote answer for', from);
    } catch (error) {
      console.error('[WebRTCReceiver] Handle answer error:', error);
    }
  }

  /**
   * Handle incoming ICE candidate
   * @param {Object} data - ICE candidate data
   */
  async handleIceCandidate(data) {
    try {
      const { from, candidate } = data;
      const peer = this.peers.get(from);

      if (!peer || !candidate.candidate) {
        return;
      }

      await peer.pc.addIceCandidate(new wrtc.RTCIceCandidate(candidate));
    } catch (error) {
      console.error('[WebRTCReceiver] Add ICE candidate error:', error);
    }
  }

  /**
   * Send ICE candidate to peer
   * @param {string} peerId
   * @param {RTCIceCandidate} candidate
   */
  sendIceCandidate(peerId, candidate) {
    this.signaling.send(JSON.stringify({
      type: 'ice-candidate',
      payload: {
        targetPeerId: peerId,
        candidate
      }
    }));
  }

  /**
   * Close peer connection
   * @param {string} peerId
   */
  closePeerConnection(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.pc.close();
      this.peers.delete(peerId);
      console.log('[WebRTCReceiver] Closed peer connection:', peerId);
    }
  }

  /**
   * Get stream for a peer
   * @param {string} peerId
   * @returns {MediaStream|null}
   */
  getStream(peerId) {
    const peer = this.peers.get(peerId);
    return peer ? peer.stream : null;
  }

  /**
   * Get list of connected peers
   * @returns {Array}
   */
  getPeers() {
    return Array.from(this.peers.keys()).map(peerId => ({
      peerId,
      hasStream: !!this.peers.get(peerId)?.stream
    }));
  }

  /**
   * Disconnect from signaling server
   */
  async disconnect() {
    if (this.signaling) {
      this.signaling.close();
      this.signaling = null;
    }

    for (const peerId of this.peers.keys()) {
      this.closePeerConnection(peerId);
    }

    this.peers.clear();
    console.log('[WebRTCReceiver] Disconnected');
  }
}

module.exports = { WebRTCReceiver };
