/**
 * WHEPClient - Implementation of WebRTC-HTTP Egress Protocol (WHEP)
 * for consuming streams from Nimble Streamer.
 * Based on MediaMTX WebRTC reader (bluenviron/mediamtx)
 */
class WHEPClient {
  constructor(endpoint, videoElement, options = {}) {
    this.retryPause = options.retryPause || 2000;
    this.endpoint = endpoint;
    this.videoElement = videoElement;
    this.pc = null;
    this.resourceURL = null;
    this.etag = null;
    this.authToken = options.authToken || null;
    this.state = 'running';
    this.restartTimeout = null;
    this.offerData = null;
    this.queuedCandidates = [];
    this.videoCodec = options.videoCodec || 'H265';
    this.audioCodec = options.audioCodec || 'opus';
    this.onTrack = options.onTrack || null;
  }

  /**
   * Close the reader and all its resources
   */
  close() {
    this.state = 'closed';
    if (this.pc !== null) {
      this.pc.close();
      this.pc = null;
    }
    if (this.restartTimeout !== null) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
  }

  /**
   * Filter SDP section to only include specified codec
   * Based on MediaMTX #setCodec method
   */
  static #setCodec(section, codec) {
    const lines = section.split('\r\n');
    const lines2 = [];
    const payloadFormats = [];

    for (const line of lines) {
      if (!line.startsWith('a=rtpmap:')) {
        lines2.push(line);
      } else if (line.toLowerCase().includes(codec.toLowerCase())) {
        payloadFormats.push(line.slice('a=rtpmap:'.length).split(' ')[0]);
        lines2.push(line);
      }
    }

    const lines3 = [];
    let firstLine = true;
    for (const line of lines2) {
      if (firstLine) {
        firstLine = false;
        lines3.push(line.split(' ').slice(0, 3).concat(payloadFormats).join(' '));
      } else if (line.startsWith('a=fmtp:') || line.startsWith('a=rtcp-fb:')) {
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
   * Edit SDP offer to filter codecs
   */
  static #editOffer(sdp, videoCodec, audioCodec) {
    const sections = sdp.split('m=');
    for (let i = 0; i < sections.length; i++) {
      if (sections[i].startsWith('video')) {
        sections[i] = this.#setCodec(sections[i], videoCodec);
      } else if (sections[i].startsWith('audio')) {
        sections[i] = this.#setCodec(sections[i], audioCodec);
      }
    }
    return sections.join('m=');
  }

  static #unquoteCredential(v) {
    return JSON.parse(`"${v}"`);
  }

  static #linkToIceServers(links) {
    return (links !== null) ? links.split(', ').map((link) => {
      const m = link.match(/^<(.+?)>; rel="ice-server"(; username="(.*?)"; credential="(.*?)"; credential-type="password")?/i);
      const ret = { urls: [m[1]] };
      if (m[3] !== undefined) {
        ret.username = this.#unquoteCredential(m[3]);
        ret.credential = this.#unquoteCredential(m[4]);
        ret.credentialType = 'password';
      }
      return ret;
    }) : [];
  }

  static #parseOffer(sdp) {
    const ret = { iceUfrag: '', icePwd: '', medias: [] };
    for (const line of sdp.split('\r\n')) {
      if (line.startsWith('m=')) ret.medias.push(line.slice('m='.length));
      else if (ret.iceUfrag === '' && line.startsWith('a=ice-ufrag:')) ret.iceUfrag = line.slice('a=ice-ufrag:'.length);
      else if (ret.icePwd === '' && line.startsWith('a=ice-pwd:')) ret.icePwd = line.slice('a=ice-pwd:'.length);
    }
    return ret;
  }

  static #generateSdpFragment(od, candidates) {
    const candidatesByMedia = {};
    for (const candidate of candidates) {
      const mid = candidate.sdpMLineIndex;
      if (candidatesByMedia[mid] === undefined) candidatesByMedia[mid] = [];
      candidatesByMedia[mid].push(candidate);
    }
    let frag = 'a=ice-ufrag:' + od.iceUfrag + '\r\n' + 'a=ice-pwd:' + od.icePwd + '\r\n';
    let mid = 0;
    for (const media of od.medias) {
      if (candidatesByMedia[mid] !== undefined) {
        frag += 'm=' + media + '\r\n' + 'a=mid:' + mid + '\r\n';
        for (const candidate of candidatesByMedia[mid]) frag += 'a=' + candidate.candidate + '\r\n';
      }
      mid++;
    }
    return frag;
  }

  #authHeader() {
    if (this.authToken) {
      return { 'Authorization': `Bearer ${this.authToken}` };
    }
    return {};
  }

  #requestICEServers() {
    return fetch(this.endpoint, {
      method: 'OPTIONS',
      headers: { ...this.#authHeader() },
    }).then((res) => WHEPClient.#linkToIceServers(res.headers.get('Link')));
  }

  #handleError(err) {
    if (this.state === 'running') {
      if (this.pc !== null) {
        this.pc.close();
        this.pc = null;
      }
      this.offerData = null;
      if (this.resourceURL !== null) {
        fetch(this.resourceURL, { method: 'DELETE' });
        this.resourceURL = null;
      }
      this.queuedCandidates = [];
      this.state = 'restarting';
      this.restartTimeout = window.setTimeout(() => {
        this.restartTimeout = null;
        this.state = 'running';
        this.consume();
      }, this.retryPause);
      console.warn(`[WHEP] ${err}, retrying in some seconds`);
    }
  }

  #setupPeerConnection(iceServers) {
    if (this.state !== 'running') throw new Error('closed');

    this.pc = new RTCPeerConnection({
      iceServers,
      sdpSemantics: 'unified-plan',
    });

    this.pc.onicecandidate = (evt) => this.#onLocalCandidate(evt);
    this.pc.onconnectionstatechange = () => this.#onConnectionState();
    this.pc.ontrack = (evt) => this.#onTrack(evt);

    // Add transceivers for recvonly
    this.pc.addTransceiver('video', { direction: 'recvonly' });
    this.pc.addTransceiver('audio', { direction: 'recvonly' });

    return this.pc.createOffer().then((offer) => {
      // Edit SDP to filter codecs
      offer.sdp = WHEPClient.#editOffer(offer.sdp, this.videoCodec, this.audioCodec);
      this.offerData = WHEPClient.#parseOffer(offer.sdp);
      return this.pc.setLocalDescription(offer).then(() => offer.sdp);
    });
  }

  #sendOffer(offer) {
    if (this.state !== 'running') throw new Error('closed');

    return fetch(this.endpoint, {
      method: 'POST',
      headers: { ...this.#authHeader(), 'Content-Type': 'application/sdp' },
      body: offer,
    }).then((res) => {
      switch (res.status) {
        case 201: break;
        case 400: return res.json().then((e) => { throw new Error(e.error); });
        case 404: throw new Error('stream not found');
        default: throw new Error(`bad status code ${res.status}`);
      }
      // Handle Location header from MediaMTX
      // MediaMTX returns session URL like: /{streamName}/whep/{sessionId}
      const location = res.headers.get('location');
      console.log('[WHEP] POST response - Location:', location, 'ETag:', res.headers.get('ETag'));
      console.log('[WHEP] Endpoint was:', this.endpoint);
      if (location) {
        // Use the location URL directly - nginx handles proxy_redirect
        if (location.startsWith('http')) {
          // Absolute URL from nginx
          this.resourceURL = location;
        } else {
          // Relative URL from MediaMTX - construct full URL
          const endpointUrl = new URL(this.endpoint);
          // Location from MediaMTX is relative to server root, not endpoint
          this.resourceURL = `${endpointUrl.protocol}//${endpointUrl.host}${location}`;
        }
        console.log('[WHEP] resourceURL set to:', this.resourceURL);
      }
      this.etag = res.headers.get('ETag');
      return res.text();
    });
  }

  #setAnswer(answer) {
    if (this.state !== 'running') throw new Error('closed');

    return this.pc.setRemoteDescription(new RTCSessionDescription({
      type: 'answer',
      sdp: answer,
    })).then(() => {
      if (this.state !== 'running') return;
      if (this.queuedCandidates.length !== 0) {
        this.#sendLocalCandidates(this.queuedCandidates);
        this.queuedCandidates = [];
      }
    });
  }

  #onLocalCandidate(evt) {
    if (this.state !== 'running') return;
    if (evt.candidate !== null) {
      if (this.resourceURL === null) {
        this.queuedCandidates.push(evt.candidate);
      } else {
        this.#sendLocalCandidates([evt.candidate]);
      }
    }
  }

  #sendLocalCandidates(candidates) {
    const fragment = WHEPClient.#generateSdpFragment(this.offerData, candidates);
    console.log('[WHEP] Sending PATCH to:', this.resourceURL, 'If-Match:', this.etag || '*');
    fetch(this.resourceURL, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/trickle-ice-sdpfrag',
        'If-Match': this.etag || '*',
      },
      body: fragment,
    }).then((res) => {
      switch (res.status) {
        case 204: break;
        case 404: throw new Error('stream not found');
        default: throw new Error(`bad status code ${res.status}`);
      }
    }).catch((err) => {
      console.error('[WHEP] PATCH error:', err);
      this.#handleError(err.toString());
    });
  }

  #onConnectionState() {
    if (this.state !== 'running') return;
    if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') {
      this.#handleError('peer connection closed');
    }
  }

  #onTrack(evt) {
    console.log('[WHEP] Received remote track', evt.track.kind);
    if (this.videoElement && this.videoElement.srcObject !== evt.streams[0]) {
      this.videoElement.srcObject = evt.streams[0];
    }
    if (this.onTrack) {
      this.onTrack(evt);
    }
  }

  /**
   * Consume a stream and render it to the attached video element
   * Uses HTTP POST with SDP offer (standard WHEP pattern)
   * Based on MediaMTX WebRTC reader
   */
  consume() {
    return this.#requestICEServers()
      .then((iceServers) => this.#setupPeerConnection(iceServers))
      .then((offer) => this.#sendOffer(offer))
      .then((answer) => this.#setAnswer(answer))
      .catch((err) => this.#handleError(err.toString()));
  }

  /**
   * Stop consuming and cleanup
   * Sends DELETE to resource URL with ETag (WHEP/WHIP spec)
   */
  async stop() {
    this.close();
    if (this.resourceURL) {
      try {
        const headers = {};
        if (this.etag) {
          headers['If-Match'] = this.etag;
        }
        console.log('[WHEP] Sending DELETE to:', this.resourceURL, 'ETag:', this.etag);
        await fetch(this.resourceURL, {
          method: 'DELETE',
          headers
        });
      } catch (e) {
        console.warn('[WHEP] Failed to notify server about stop', e);
      }
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
  }
}

// Export for global use
window.WHEPClient = WHEPClient;
