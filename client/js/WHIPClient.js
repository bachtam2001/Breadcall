/**
 * WHIPClient - Implementation of WebRTC-HTTP Ingestion Protocol (WHIP)
 * for publishing streams to OvenMediaEngine.
 */
export class WHIPClient {
  constructor(endpoint) {
    this.endpoint = endpoint;
    this.pc = null;
    this.stream = null;
    this.resourceURL = null; // Used for DELETE request to stop stream
  }

  /**
   * Publish a MediaStream to the WHIP endpoint
   * @param {MediaStream} stream 
   */
  async publish(stream) {
    this.stream = stream;
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    // Add tracks to PeerConnection
    this.stream.getTracks().forEach(track => {
      this.pc.addTrack(track, this.stream);
    });

    // Create offer
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    // Wait for ICE gathering to complete (OME prefers non-trickle or full SDP for WHIP)
    await new Promise(resolve => {
      if (this.pc.iceGatheringState === 'complete') {
        resolve();
      } else {
        const checkState = () => {
          if (this.pc.iceGatheringState === 'complete') {
            this.pc.removeEventListener('icegatheringstatechange', checkState);
            resolve();
          }
        };
        this.pc.addEventListener('icegatheringstatechange', checkState);
        // Fail-safe timeout
        setTimeout(resolve, 3000);
      }
    });

    // Send SDP offer via HTTP POST
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp'
      },
      body: this.pc.localDescription.sdp
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`WHIP Publish failed (${response.status}): ${errorText}`);
    }

    // Store resource URL if provided for clean disconnect
    this.resourceURL = response.headers.get('Location');
    // If relative, make it absolute
    if (this.resourceURL && !this.resourceURL.startsWith('http')) {
      const parsedBase = new URL(this.endpoint);
      this.resourceURL = new URL(this.resourceURL, parsedBase.origin).href;
    }

    // Apply SDP answer from OME
    const answerSdp = await response.text();
    await this.pc.setRemoteDescription(new RTCSessionDescription({
      type: 'answer',
      sdp: answerSdp
    }));

    console.log(`[WHIP] Published successfully to ${this.endpoint}`);
  }

  /**
   * Stop publishing and cleanup
   */
  async stop() {
    if (this.resourceURL) {
      try {
        await fetch(this.resourceURL, { method: 'DELETE' });
      } catch (e) {
        console.warn('[WHIP] Failed to notify server about stop', e);
      }
    }

    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.stream = null;
  }
}
