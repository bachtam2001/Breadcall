/**
 * WebRTCManager - Handles PeerConnection management for mesh WebRTC
 */
class WebRTCManager extends EventTarget {
  constructor(signalingClient, options = {}) {
    super();
    this.signaling = signalingClient;
    this.peers = new Map(); // peerId -> { pc, remoteStream, sender }
    this.localStream = null;
    this.iceServers = options.iceServers || [
      { urls: 'stun:stun.l.google.com:19302' }
    ];
    this.codec = options.codec || 'H264';
    this.bandwidth = options.bandwidth || { min: 30, max: 3000 };
    this.pendingCandidates = new Map(); // peerId -> array of candidates
  }

  /**
   * Set local media stream
   * @param {MediaStream} stream
   */
  setLocalStream(stream) {
    this.localStream = stream;

    // Add tracks to existing peers
    for (const [peerId, { pc }] of this.peers.entries()) {
      this.addTracksToPeerConnection(pc, stream);
    }

    this.dispatchEvent(new CustomEvent('local-stream-set', { detail: { stream } }));
  }

  /**
   * Create peer connection for a peer
   * @param {string} peerId
   * @returns {RTCPeerConnection}
   */
  createPeerConnection(peerId) {
    const config = {
      iceServers: this.iceServers,
      iceTransportPolicy: 'all',
      bundlePolicy: 'balanced'
    };

    const pc = new RTCPeerConnection(config);

    // Add local tracks if available
    if (this.localStream) {
      this.addTracksToPeerConnection(pc, this.localStream);
    }

    // ICE candidate handler
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[WebRTCManager] Sending ICE candidate to', peerId);
        this.signaling.send('ice-candidate', {
          targetPeerId: peerId,
          candidate: event.candidate
        });
      }
    };

    // Track handler
    pc.ontrack = (event) => {
      console.log('[WebRTCManager] Received track from', peerId);
      const remoteStream = event.streams[0];
      this.peers.get(peerId).remoteStream = remoteStream;

      this.dispatchEvent(new CustomEvent('remote-stream', {
        detail: { peerId, stream: remoteStream }
      }));
    };

    // Connection state handler
    pc.onconnectionstatechange = () => {
      console.log('[WebRTCManager] Connection state:', pc.connectionState, peerId);
      this.dispatchEvent(new CustomEvent('connection-state-change', {
        detail: { peerId, state: pc.connectionState }
      }));

      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.handleConnectionFailure(peerId);
      }
    };

    // Ice connection state handler
    pc.oniceconnectionstatechange = () => {
      console.log('[WebRTCManager] ICE state:', pc.iceConnectionState, peerId);
    };

    this.peers.set(peerId, { pc, remoteStream: null, sender: null });

    return pc;
  }

  /**
   * Add tracks to peer connection
   * @param {RTCPeerConnection} pc
   * @param {MediaStream} stream
   */
  addTracksToPeerConnection(pc, stream) {
    stream.getTracks().forEach(track => {
      const sender = pc.addTrack(track, stream);
      // Apply bandwidth constraints if video
      if (track.kind === 'video') {
        this.applyBandwidthConstraint(sender);
      }
    });
  }

  /**
   * Apply bandwidth constraint to sender
   * @param {RTCRtpSender} sender
   */
  async applyBandwidthConstraint(sender) {
    try {
      const params = sender.getParameters();
      if (!params.encodings) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = this.bandwidth.max * 1000;
      await sender.setParameters(params);
      console.log('[WebRTCManager] Applied bandwidth constraint:', this.bandwidth.max, 'kbps');
    } catch (error) {
      console.warn('[WebRTCManager] Failed to apply bandwidth constraint:', error);
    }
  }

  /**
   * Create and send offer to peer
   * @param {string} peerId
   */
  async createOffer(peerId) {
    try {
      const pc = this.peers.get(peerId)?.pc || this.createPeerConnection(peerId);

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });

      await pc.setLocalDescription(offer);
      console.log('[WebRTCManager] Created offer for', peerId);

      this.signaling.send('offer', {
        targetPeerId: peerId,
        sdp: pc.localDescription
      });
    } catch (error) {
      console.error('[WebRTCManager] Error creating offer:', error);
      this.dispatchEvent(new CustomEvent('error', { detail: error }));
    }
  }

  /**
   * Handle incoming offer
   * @param {string} peerId
   * @param {RTCSessionDescriptionInit} sdp
   */
  async handleOffer(peerId, sdp) {
    try {
      const pc = this.peers.get(peerId)?.pc || this.createPeerConnection(peerId);

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));

      // Process any pending ICE candidates
      this.processPendingCandidates(peerId);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log('[WebRTCManager] Created answer for', peerId);

      this.signaling.send('answer', {
        targetPeerId: peerId,
        sdp: pc.localDescription
      });
    } catch (error) {
      console.error('[WebRTCManager] Error handling offer:', error);
      this.dispatchEvent(new CustomEvent('error', { detail: error }));
    }
  }

  /**
   * Handle incoming answer
   * @param {string} peerId
   * @param {RTCSessionDescriptionInit} sdp
   */
  async handleAnswer(peerId, sdp) {
    try {
      const peer = this.peers.get(peerId);
      if (!peer) {
        console.warn('[WebRTCManager] No peer found for', peerId);
        return;
      }

      await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));

      // Process any pending ICE candidates
      this.processPendingCandidates(peerId);

      console.log('[WebRTCManager] Set remote answer for', peerId);
    } catch (error) {
      console.error('[WebRTCManager] Error handling answer:', error);
      this.dispatchEvent(new CustomEvent('error', { detail: error }));
    }
  }

  /**
   * Handle incoming ICE candidate
   * @param {string} peerId
   * @param {RTCIceCandidateInit} candidate
   */
  async handleIceCandidate(peerId, candidate) {
    const peer = this.peers.get(peerId);

    if (!peer) {
      // Store candidate for later
      if (!this.pendingCandidates.has(peerId)) {
        this.pendingCandidates.set(peerId, []);
      }
      this.pendingCandidates.get(peerId).push(candidate);
      return;
    }

    try {
      if (candidate.candidate) {
        await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('[WebRTCManager] Added ICE candidate for', peerId);
      }
    } catch (error) {
      console.warn('[WebRTCManager] Failed to add ICE candidate:', error);
    }
  }

  /**
   * Process pending ICE candidates
   * @param {string} peerId
   */
  async processPendingCandidates(peerId) {
    const candidates = this.pendingCandidates.get(peerId);
    if (!candidates) return;

    const peer = this.peers.get(peerId);
    if (!peer) return;

    for (const candidate of candidates) {
      try {
        if (candidate.candidate) {
          await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (error) {
        console.warn('[WebRTCManager] Failed to add pending ICE candidate:', error);
      }
    }

    this.pendingCandidates.delete(peerId);
  }

  /**
   * Handle connection failure
   * @param {string} peerId
   */
  handleConnectionFailure(peerId) {
    console.warn('[WebRTCManager] Connection failure for', peerId);
    this.dispatchEvent(new CustomEvent('peer-lost', { detail: { peerId } }));

    // Attempt reconnection
    this.closePeerConnection(peerId);

    // Re-establish connection if we still have the peer
    setTimeout(() => {
      if (this.peers.has(peerId) === false && this.localStream) {
        console.log('[WebRTCManager] Attempting to re-establish connection with', peerId);
        // Signaling would need to trigger a new offer
      }
    }, 2000);
  }

  /**
   * Close peer connection
   * @param {string} peerId
   */
  closePeerConnection(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    if (peer.pc) {
      peer.pc.ontrack = null;
      peer.pc.onicecandidate = null;
      peer.pc.onconnectionstatechange = null;
      peer.pc.close();
    }

    this.peers.delete(peerId);
    console.log('[WebRTCManager] Closed peer connection:', peerId);

    this.dispatchEvent(new CustomEvent('peer-removed', { detail: { peerId } }));
  }

  /**
   * Replace video track (for camera switching)
   * @param {MediaStreamTrack} newTrack
   */
  async replaceVideoTrack(newTrack) {
    for (const [peerId, { pc }] of this.peers.entries()) {
      const senders = pc.getSenders();
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');
      if (videoSender) {
        await videoSender.replaceTrack(newTrack);
        console.log('[WebRTCManager] Replaced video track for', peerId);
      }
    }
  }

  /**
   * Replace audio track (for mic switching)
   * @param {MediaStreamTrack} newTrack
   */
  async replaceAudioTrack(newTrack) {
    for (const [peerId, { pc }] of this.peers.entries()) {
      const senders = pc.getSenders();
      const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
      if (audioSender) {
        await audioSender.replaceTrack(newTrack);
        console.log('[WebRTCManager] Replaced audio track for', peerId);
      }
    }
  }

  /**
   * Get peer connection stats
   * @param {string} peerId
   * @returns {Promise<RTCStatsReport>}
   */
  async getStats(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return null;
    return peer.pc.getStats();
  }

  /**
   * Get all peer IDs
   * @returns {Array<string>}
   */
  getPeerIds() {
    return Array.from(this.peers.keys());
  }

  /**
   * Get remote stream for peer
   * @param {string} peerId
   * @returns {MediaStream|null}
   */
  getRemoteStream(peerId) {
    return this.peers.get(peerId)?.remoteStream || null;
  }

  /**
   * Get connection state for peer
   * @param {string} peerId
   * @returns {string|null}
   */
  getConnectionState(peerId) {
    return this.peers.get(peerId)?.pc?.connectionState || null;
  }

  /**
   * Cleanup all connections
   */
  cleanup() {
    for (const peerId of this.peers.keys()) {
      this.closePeerConnection(peerId);
    }
    this.localStream = null;
  }
}

// Export for use
window.WebRTCManager = WebRTCManager;
