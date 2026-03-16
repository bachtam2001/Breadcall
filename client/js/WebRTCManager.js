/**
 * WebRTCManager - Handles SFU WebRTC management using MediaMTX (WHIP/WHEP)
 */
class WebRTCManager extends EventTarget {
  constructor(signalingClient, options = {}) {
    super();
    this.signaling = signalingClient;
    this.config = options.config || null; // { webrtcUrl, app, iceServers }
    this.videoCodec = options.videoCodec || 'H265'; // Default to H265 for backwards compatibility

    this.whipClient = null;
    this.playbackConnections = new Map(); // participantId -> { pc }
    this.localStream = null;

    this.bandwidth = options.bandwidth || { min: 30, max: 3000 };
  }

  /**
   * Set WebRTC configuration
   */
  setConfig(config) {
    this.config = config;
    console.log('[WebRTCManager] WebRTC Config updated:', config);
  }

  /**
   * Set local media stream and publish via WHIP
   * @param {MediaStream} stream
   * @param {string} streamName - Unique stream name from backend
   * @param {string} videoCodec - Video codec to use (H264, H265, VP8, VP9)
   */
  async setLocalStream(stream, streamName, videoCodec) {
    if (!this.config) {
      console.error('[WebRTCManager] Cannot publish: WebRTC config missing');
      return;
    }

    this.localStream = stream;
    const codec = videoCodec || this.videoCodec;

    if (this.whipClient) {
      await this.whipClient.stop();
    }

    // MediaMTX WHIP endpoint format: {webrtcUrl}/{streamName}/whip
    const webrtcUrl = this.config.webrtcUrl;
    const whipEndpoint = `${webrtcUrl}/${streamName}/whip`;
    this.whipClient = new WHIPClient(whipEndpoint, {
      authToken: this.config.authToken,
      videoCodec: codec,
      audioCodec: 'opus'
    });

    try {
      await this.whipClient.publish(this.localStream);
      this.dispatchEvent(new CustomEvent('local-stream-published', { detail: { stream, streamName } }));
    } catch (err) {
      console.error('[WebRTCManager] WHIP Publish error:', err);
      this.dispatchEvent(new CustomEvent('error', { detail: err }));
    }
  }

  /**
   * Consume a remote participant's stream via WHEP (HTTP-only)
   * Uses standard WHEP protocol with POST for SDP exchange
   * Based on MediaMTX WebRTC reader
   * @param {string} participantId
   * @param {string} streamName
   * @param {string} videoCodec - Video codec to use (H264, H265, VP8, VP9)
   */
  async consumeRemoteStream(participantId, streamName, videoCodec) {
    if (!this.config) {
      console.error('[WebRTCManager] Cannot consume: WebRTC config missing');
      return;
    }

    if (this.playbackConnections.has(participantId)) {
      await this.closePlaybackConnection(participantId);
    }

    // MediaMTX WHEP endpoint format: {webrtcUrl}/{streamName}/whep
    const webrtcUrl = this.config.webrtcUrl;
    const whepEndpoint = `${webrtcUrl}/${streamName}/whep`;

    console.log('[WebRTCManager] Connecting to MediaMTX for WHEP playback:', whepEndpoint);

    const codec = videoCodec || this.videoCodec;

    try {
      // Create WHEP client with MediaMTX WebRTC reader pattern
      const whepClient = new WHEPClient(whepEndpoint, null, {
        authToken: this.config.authToken,
        videoCodec: codec,
        audioCodec: 'opus',
        onTrack: (event) => {
          console.log('[WebRTCManager] Received track from', participantId, event.track.kind);
          const remoteStream = event.streams[0];
          this.dispatchEvent(new CustomEvent('remote-stream', {
            detail: { peerId: participantId, stream: remoteStream }
          }));
        }
      });

      // Consume the stream
      try {
        await whepClient.consume();
      } catch (consumeErr) {
        console.error('[WebRTCManager] WHEP consume failed:', consumeErr);
        this.dispatchEvent(new CustomEvent('error', { detail: consumeErr }));
        this.dispatchEvent(new CustomEvent('connection-state-change', {
          detail: { peerId: participantId, state: 'failed' }
        }));
        return;
      }

      // Store connection
      this.playbackConnections.set(participantId, { pc: whepClient.pc, whepClient });

    } catch (err) {
      console.error('[WebRTCManager] WHEP Consume error:', err);
      this.dispatchEvent(new CustomEvent('error', { detail: err }));
      this.dispatchEvent(new CustomEvent('connection-state-change', {
        detail: { peerId: participantId, state: 'failed' }
      }));
    }
  }

  /**
   * Close a specific remote connection
   */
  async closePeerConnection(participantId) {
    await this.closePlaybackConnection(participantId);
  }

  /**
   * Close playback connection for a participant
   */
  async closePlaybackConnection(participantId) {
    const conn = this.playbackConnections.get(participantId);
    if (conn) {
      // Close WHEP client (handles DELETE request)
      if (conn.whepClient) await conn.whepClient.stop();
      if (conn.pc) conn.pc.close();
      this.playbackConnections.delete(participantId);
      this.dispatchEvent(new CustomEvent('peer-removed', { detail: { peerId: participantId } }));
    }
  }

  /**
   * Replace video track (for camera/screen switching)
   * In SFU WHIP, we use the standard replaceTrack on the WHIP PC senders
   */
  async replaceVideoTrack(newTrack) {
    if (this.whipClient && this.whipClient.pc) {
      const senders = this.whipClient.pc.getSenders();
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');
      if (videoSender) {
        await videoSender.replaceTrack(newTrack);
        console.log('[WebRTCManager] WHIP Video track replaced');
      }
    }
  }

  /**
   * Replace audio track
   */
  async replaceAudioTrack(newTrack) {
    if (this.whipClient && this.whipClient.pc) {
      const senders = this.whipClient.pc.getSenders();
      const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
      if (audioSender) {
        await audioSender.replaceTrack(newTrack);
        console.log('[WebRTCManager] WHIP Audio track replaced');
      }
    }
  }

  /**
   * Get stats for a participant
   */
  async getStats(participantId) {
    if (participantId === 'local' && this.whipClient) {
      return this.whipClient.pc.getStats();
    }
    const conn = this.playbackConnections.get(participantId);
    if (conn && conn.pc) return conn.pc.getStats();
    return null;
  }

  /**
   * Get all peer IDs
   * @returns {Array<string>}
   */
  getPeerIds() {
    return Array.from(this.playbackConnections.keys());
  }

  /**
   * Get connection state for a participant
   * @param {string} participantId
   * @returns {string} Connection state: 'connected', 'connecting', 'disconnected', 'failed', or 'unknown'
   */
  getConnectionState(participantId) {
    if (participantId === 'local' && this.whipClient) {
      return this.whipClient.pc?.connectionState || 'unknown';
    }
    const conn = this.playbackConnections.get(participantId);
    if (conn && conn.pc) {
      return conn.pc.connectionState || 'connecting';
    }
    return 'unknown';
  }

  /**
   * Cleanup all connections
   */
  async cleanup() {
    if (this.whipClient) await this.whipClient.stop();
    for (const participantId of this.playbackConnections.keys()) {
      await this.closePlaybackConnection(participantId);
    }
    this.playbackConnections.clear();
    this.localStream = null;
  }
}

// Export for use
window.WebRTCManager = WebRTCManager;

