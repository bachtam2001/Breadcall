import { WHIPClient } from './WHIPClient.js';
import { WHEPClient } from './WHEPClient.js';

/**
 * WebRTCManager - Handles SFU WebRTC management using OvenMediaEngine (WHIP/WHEP)
 */
class WebRTCManager extends EventTarget {
  constructor(signalingClient, options = {}) {
    super();
    this.signaling = signalingClient;
    this.omeConfig = options.omeConfig || null; // { omeUrl, appProfile }

    this.whipClient = null;
    this.whepClients = new Map(); // participantId -> WHEPClient
    this.localStream = null;

    this.bandwidth = options.bandwidth || { min: 30, max: 3000 };
  }

  /**
   * Set OME configuration
   */
  setOmeConfig(config) {
    this.omeConfig = config;
    console.log('[WebRTCManager] OME Config updated:', config);
  }

  /**
   * Set local media stream and publish via WHIP
   * @param {MediaStream} stream
   * @param {string} streamName - Unique stream name from backend
   */
  async setLocalStream(stream, streamName) {
    if (!this.omeConfig) {
      console.error('[WebRTCManager] Cannot publish: OME config missing');
      return;
    }

    this.localStream = stream;

    if (this.whipClient) {
      await this.whipClient.stop();
    }

    const whipEndpoint = `${this.omeConfig.omeUrl}/${this.omeConfig.appProfile}/${streamName}`;
    this.whipClient = new WHIPClient(whipEndpoint);

    try {
      await this.whipClient.publish(this.localStream);
      this.dispatchEvent(new CustomEvent('local-stream-published', { detail: { stream, streamName } }));
    } catch (err) {
      console.error('[WebRTCManager] WHIP Publish error:', err);
      this.dispatchEvent(new CustomEvent('error', { detail: err }));
    }
  }

  /**
   * Consume a remote participant's stream via WHEP
   * @param {string} participantId 
   * @param {string} streamName 
   */
  async consumeRemoteStream(participantId, streamName) {
    if (!this.omeConfig) {
      console.error('[WebRTCManager] Cannot consume: OME config missing');
      return;
    }

    if (this.whepClients.has(participantId)) {
      await this.whepClients.get(participantId).stop();
    }

    const whepEndpoint = `${this.omeConfig.omeUrl}/${this.omeConfig.appProfile}/${streamName}`;

    // We create a ghost video element or just emit the stream
    const tempVideo = document.createElement('video');
    const client = new WHEPClient(whepEndpoint, tempVideo);
    this.whepClients.set(participantId, client);

    try {
      await client.consume();

      // Listen for track events from WHEP PC
      client.pc.ontrack = (event) => {
        const remoteStream = event.streams[0];
        this.dispatchEvent(new CustomEvent('remote-stream', {
          detail: { peerId: participantId, stream: remoteStream }
        }));
      };

      this.dispatchEvent(new CustomEvent('connection-state-change', {
        detail: { peerId: participantId, state: 'connected' }
      }));
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
    const client = this.whepClients.get(participantId);
    if (client) {
      await client.stop();
      this.whepClients.delete(participantId);
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
    const client = this.whepClients.get(participantId);
    if (client) return client.pc.getStats();
    return null;
  }

  /**
   * Get all peer IDs
   * @returns {Array<string>}
   */
  getPeerIds() {
    return Array.from(this.whepClients.keys());
  }

  /**
   * Cleanup all connections
   */
  async cleanup() {
    if (this.whipClient) await this.whipClient.stop();
    for (const client of this.whepClients.values()) {
      await client.stop();
    }
    this.whepClients.clear();
    this.localStream = null;
  }
}

// Export for use
window.WebRTCManager = WebRTCManager;
export { WebRTCManager };

