/**
 * WHIPClient - Implementation of WebRTC-HTTP Ingestion Protocol (WHIP)
 * for publishing streams to Nimble Streamer.
 * Based on MediaMTX WebRTC publisher (bluenviron/mediamtx)
 */
class WHIPClient {
  constructor(endpoint, options = {}) {
    this.endpoint = endpoint;
    this.authToken = options.authToken || null;
    this.pc = null;
    this.stream = null;
    this.resourceURL = null;
    this.etag = null;
    this.videoCodec = options.videoCodec || 'H265';
    this.audioCodec = options.audioCodec || 'opus';
  }

  /**
   * Filter SDP section to only include specified codec
   * Based on MediaMTX #setCodec method
   */
  static #setCodec(section, codec) {
    const lines = section.split('\r\n');
    const lines2 = [];
    const payloadFormats = [];

    // First pass: collect payload formats for the desired codec
    for (const line of lines) {
      if (!line.startsWith('a=rtpmap:')) {
        lines2.push(line);
      } else if (line.toLowerCase().includes(codec.toLowerCase())) {
        payloadFormats.push(line.slice('a=rtpmap:'.length).split(' ')[0]);
        lines2.push(line);
      }
    }

    // Second pass: rebuild m= line and filter fmtp/rtcp-fb
    const lines3 = [];
    let firstLine = true;
    for (const line of lines2) {
      if (firstLine) {
        firstLine = false;
        // Rebuild m= line with only selected payload formats
        lines3.push(line.split(' ').slice(0, 3).concat(payloadFormats).join(' '));
      } else if (line.startsWith('a=fmtp:') || line.startsWith('a=rtcp-fb:')) {
        // Only include fmtp/rtcp-fb for selected payloads
        const payload = line.split(' ')[0].replace(/[a-z:]/g, '');
        if (payloadFormats.includes(payload)) {
          lines3.push(line);
        }
      } else {
        lines3.push(line);
      }
    }

    return lines3.join('\r\n');
  }

  /**
   * Edit SDP offer to filter video codec
   */
  static #editOffer(sdp, videoCodec) {
    const sections = sdp.split('m=');
    for (let i = 0; i < sections.length; i++) {
      if (sections[i].startsWith('video')) {
        sections[i] = this.#setCodec(sections[i], videoCodec);
      }
    }
    return sections.join('m=');
  }

  /**
   * Close the publisher and all its resources
   */
  close() {
    if (this.pc !== null) this.pc.close();
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

    // Edit SDP to filter codecs using MediaMTX approach
    let sdp = this.pc.localDescription.sdp;
    sdp = WHIPClient.#editOffer(sdp, this.videoCodec);

    // Wait for ICE gathering to complete (Nimble prefers non-trickle or full SDP for WHIP)
    await new Promise(resolve => {
      if (this.pc.iceGatheringState === 'complete') {
        resolve();
      } else {
        let resolved = false;
        const checkState = () => {
          if (!resolved && this.pc.iceGatheringState === 'complete') {
            resolved = true;
            this.pc.removeEventListener('icegatheringstatechange', checkState);
            resolve();
          }
        };
        this.pc.addEventListener('icegatheringstatechange', checkState);
        // Fail-safe timeout - always clean up
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            this.pc.removeEventListener('icegatheringstatechange', checkState);
            resolve();
          }
        }, 3000);
      }
    });

    // Send SDP offer via HTTP POST
    const headers = {
      'Content-Type': 'application/sdp'
    };
    // Add authentication if provided
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: sdp
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`WHIP Publish failed (${response.status}): ${errorText}`);
    }

    // Store resource URL if provided for clean disconnect
    this.resourceURL = response.headers.get('Location');
    // Store ETag for DELETE request (WHIP spec requires If-Match header)
    this.etag = response.headers.get('ETag');
    console.log('[WHIP] Received Location:', this.resourceURL, 'ETag:', this.etag);

    // If relative, make it absolute
    if (this.resourceURL && !this.resourceURL.startsWith('http')) {
      const parsedBase = new URL(this.endpoint);
      this.resourceURL = new URL(this.resourceURL, parsedBase.origin).href;
    }

    // Apply SDP answer from Nimble
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
        const headers = {};
        // WHIP spec: Include ETag in If-Match header for DELETE
        if (this.etag) {
          headers['If-Match'] = this.etag;
        }
        console.log('[WHIP] Sending DELETE to:', this.resourceURL, 'ETag:', this.etag);
        const response = await fetch(this.resourceURL, {
          method: 'DELETE',
          headers
        });
        if (!response.ok) {
          console.warn('[WHIP] DELETE failed:', response.status, await response.text());
        } else {
          console.log('[WHIP] DELETE successful');
        }
      } catch (e) {
        console.warn('[WHIP] Failed to notify server about stop', e);
      }
    }

    this.close();
    this.stream = null;
  }
}

// Export for global use
window.WHIPClient = WHIPClient;
