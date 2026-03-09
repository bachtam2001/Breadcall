import {
  mediaDevices,
  MediaStream,
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  registerGlobals
} from 'react-native-webrtc';
import {EventEmitter} from 'react-native';

// Register WebRTC globals
registerGlobals();

/**
 * WebRTCService - Handles WebRTC PeerConnections for mobile
 * Manages multiple peer connections for mesh topology
 */
class WebRTCService extends EventEmitter {
  constructor() {
    super();
    this.localStream = null;
    this.peers = new Map(); // peerId -> RTCPeerConnection
    this.pendingCandidates = new Map(); // peerId -> ICE candidates[]

    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];

    this.config = {
      iceServers: this.iceServers,
      iceCandidatePoolSize: 10,
    };
  }

  /**
   * Initialize local media stream
   * @param {Object} options - Media constraints
   * @returns {Promise<MediaStream>}
   */
  async initLocalStream(options = {}) {
    const {
      audio = true,
      video = true,
      front = true,
      resolution = { width: 1280, height: 720 },
      frameRate = 30
    } = options;

    try {
      const constraints = {
        audio: audio ? {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } : false,
        video: video ? {
          facingMode: front ? 'user' : 'environment',
          width: { ideal: resolution.width },
          height: { ideal: resolution.height },
          frameRate: { ideal: frameRate }
        } : false
      };

      console.log('[WebRTCService] Getting user media with constraints:', constraints);

      const stream = await mediaDevices.getUserMedia(constraints);
      this.localStream = stream;

      console.log('[WebRTCService] Local stream initialized');
      this.emit('local-stream', stream);

      return stream;
    } catch (error) {
      console.error('[WebRTCService] Get user media error:', error);
      this.emit('error', { type: 'media-error', error });
      throw error;
    }
  }

  /**
   * Create peer connection for a participant
   * @param {string} peerId - Peer ID
   * @returns {RTCPeerConnection}
   */
  createPeerConnection(peerId) {
    if (this.peers.has(peerId)) {
      return this.peers.get(peerId);
    }

    console.log('[WebRTCService] Creating peer connection for:', peerId);

    const pc = new RTCPeerConnection(this.config);

    // Add local tracks to peer connection
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    // Handle remote track
    pc.ontrack = (event) => {
      console.log('[WebRTCService] Received remote track from:', peerId);
      const remoteStream = event.streams[0];
      this.emit('remote-stream', { peerId, stream: remoteStream });
    };

    // Handle ICE candidate
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[WebRTCService] ICE candidate generated for:', peerId);
        this.emit('ice-candidate', {
          peerId,
          candidate: event.candidate
        });
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log('[WebRTCService] Connection state for', peerId, ':', pc.connectionState);

      switch (pc.connectionState) {
        case 'connected':
          this.emit('peer-connected', { peerId });
          break;
        case 'disconnected':
        case 'failed':
        case 'closed':
          this.removePeer(peerId);
          this.emit('peer-disconnected', { peerId });
          break;
      }
    };

    // Handle ICE connection state
    pc.oniceconnectionstatechange = () => {
      console.log('[WebRTCService] ICE state for', peerId, ':', pc.iceConnectionState);
    };

    this.peers.set(peerId, pc);

    // Process any pending ICE candidates
    this._processPendingCandidates(peerId);

    return pc;
  }

  /**
   * Create and send offer for a peer
   * @param {string} peerId - Peer ID
   * @returns {Promise<RTCSessionDescription>}
   */
  async createOffer(peerId) {
    try {
      const pc = this.createPeerConnection(peerId);
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });

      await pc.setLocalDescription(offer);

      console.log('[WebRTCService] Offer created for:', peerId);
      this.emit('offer-ready', { peerId, sdp: pc.localDescription });

      return pc.localDescription;
    } catch (error) {
      console.error('[WebRTCService] Create offer error:', error);
      throw error;
    }
  }

  /**
   * Handle received offer and create answer
   * @param {string} peerId - Peer ID
   * @param {RTCSessionDescription} sdp - SDP offer
   * @returns {Promise<RTCSessionDescription>}
   */
  async handleOffer(peerId, sdp) {
    try {
      const pc = this.createPeerConnection(peerId);

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      console.log('[WebRTCService] Answer created for:', peerId);
      this.emit('answer-ready', { peerId, sdp: pc.localDescription });

      return pc.localDescription;
    } catch (error) {
      console.error('[WebRTCService] Handle offer error:', error);
      throw error;
    }
  }

  /**
   * Handle received answer
   * @param {string} peerId - Peer ID
   * @param {RTCSessionDescription} sdp - SDP answer
   */
  async handleAnswer(peerId, sdp) {
    try {
      const pc = this.peers.get(peerId);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        console.log('[WebRTCService] Answer set for:', peerId);
      }
    } catch (error) {
      console.error('[WebRTCService] Handle answer error:', error);
      throw error;
    }
  }

  /**
   * Handle ICE candidate from peer
   * @param {string} peerId - Peer ID
   * @param {RTCIceCandidate} candidate - ICE candidate
   */
  async addIceCandidate(peerId, candidate) {
    const pc = this.peers.get(peerId);

    if (pc && candidate.candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.warn('[WebRTCService] Add ICE candidate error:', error);
        // Store candidate for later if peer connection not ready
        if (!this.pendingCandidates.has(peerId)) {
          this.pendingCandidates.set(peerId, []);
        }
        this.pendingCandidates.get(peerId).push(candidate);
      }
    }
  }

  _processPendingCandidates(peerId) {
    const pc = this.peers.get(peerId);
    const candidates = this.pendingCandidates.get(peerId);

    if (pc && candidates) {
      candidates.forEach(candidate => {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(err => {
          console.warn('[WebRTCService] Failed to add pending ICE candidate:', err);
        });
      });
      this.pendingCandidates.delete(peerId);
    }
  }

  /**
   * Remove peer connection
   * @param {string} peerId - Peer ID
   */
  removePeer(peerId) {
    const pc = this.peers.get(peerId);
    if (pc) {
      pc.close();
      this.peers.delete(peerId);
      console.log('[WebRTCService] Peer removed:', peerId);
    }
  }

  /**
   * Toggle local audio
   * @param {boolean} enabled - Enable audio
   */
  toggleAudio(enabled) {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = enabled;
        this.emit('audio-toggled', { enabled });
      }
    }
  }

  /**
   * Toggle local video
   * @param {boolean} enabled - Enable video
   */
  toggleVideo(enabled) {
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = enabled;
        this.emit('video-toggled', { enabled });
      }
    }
  }

  /**
   * Switch camera (front/back)
   * @returns {Promise<boolean>}
   */
  async switchCamera() {
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack && videoTrack._switchCamera) {
        await videoTrack._switchCamera();
        this.emit('camera-switched');
        return true;
      }
    }
    return false;
  }

  /**
   * Get all peer connections
   * @returns {Map<string, RTCPeerConnection>}
   */
  getPeers() {
    return this.peers;
  }

  /**
   * Get local stream
   * @returns {MediaStream|null}
   */
  getLocalStream() {
    return this.localStream;
  }

  /**
   * Cleanup all connections
   */
  cleanup() {
    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    // Close all peer connections
    this.peers.forEach((pc, peerId) => {
      pc.close();
    });
    this.peers.clear();
    this.pendingCandidates.clear();

    console.log('[WebRTCService] Cleanup complete');
  }
}

export default new WebRTCService();
