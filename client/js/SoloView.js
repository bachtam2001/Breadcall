/**
 * SoloView - Full-screen single stream view for OBS Browser Source
 * Uses MediaMTX embedded WebRTC player via /view/{streamId} proxy
 */

/**
 * Detect if browser supports H265/HEVC codec
 * @returns {Promise<boolean>} True if H265 is supported
 */
async function detectH265Support() {
  // Check if RTCPeerConnection exists
  if (typeof RTCPeerConnection === 'undefined') return false;

  try {
    const pc = new RTCPeerConnection();
    // Try to create an offer with H265
    const offer = await pc.createOffer({ offerToReceiveVideo: true });
    pc.close();
    // Check if H265 is in the SDP offer
    return offer.sdp && (
      offer.sdp.toLowerCase().includes('h265') ||
      offer.sdp.toLowerCase().includes('hevc')
    );
  } catch (e) {
    // If creating offer fails, assume no H265 support
    return false;
  }
}

class SoloView {
  constructor() {
    this.roomId = null;
    this.streamId = null;
    this.streamName = null;
    this.params = {};
    this.signaling = null;
    this.video = null;
    this.whepClient = null;
    this.init();
  }

  init() {
    this.parseUrl();
    this.render();
    this.connect();
  }

  parseUrl() {
    const hash = window.location.hash;
    const parts = hash.split('/');
    this.roomId = parts[2]?.toUpperCase();
    this.streamId = parts[3];

    const queryString = window.location.search.slice(1);
    const urlParams = new URLSearchParams(queryString);

    this.params = {
      muted: urlParams.get('muted') !== '0',
      autoplay: urlParams.get('autoplay') !== 'false',
      controls: urlParams.get('controls') === '1',
      transparent: urlParams.get('transparent') === '1'
    };
  }

  render() {
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';
    document.body.style.backgroundColor = this.params.transparent ? 'transparent' : 'black';

    const container = document.createElement('div');
    container.style.cssText = 'width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center;';

    const mediaContainer = document.createElement('div');
    mediaContainer.id = 'media-container';
    mediaContainer.style.cssText = 'width: 100%; height: 100%; position: relative;';

    const loading = document.createElement('div');
    loading.id = 'loading';
    loading.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-family: sans-serif;';
    loading.textContent = 'Loading...';

    const video = document.createElement('video');
    video.id = 'video';
    video.style.cssText = 'width: 100%; height: 100%; object-fit: contain;';
    video.autoplay = this.params.autoplay;
    video.muted = this.params.muted;
    video.controls = this.params.controls;
    video.playsInline = true;

    mediaContainer.appendChild(loading);
    mediaContainer.appendChild(video);
    container.appendChild(mediaContainer);
    document.body.appendChild(container);

    this.video = video;
  }

  connect() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

    this.signaling = new SignalingClient();

    this.signaling.addEventListener('connected', () => {
      console.log('[SoloView] Connected, joining room');
      this.signaling.send('join-room', { roomId: this.roomId, name: 'SoloView' });
    }, { once: true });

    this.signaling.addEventListener('joined-room', (e) => {
      console.log('[SoloView] Joined room');
      const { existingPeers } = e.detail;
      if (existingPeers && Array.isArray(existingPeers)) {
        for (const peer of existingPeers) {
          if ((peer.participantId === this.streamId || this.streamId === 'any') && peer.streamName) {
            this.streamName = peer.streamName;
            this.startWHEP(peer.streamName);
            break;
          }
        }
      }
    });

    this.signaling.addEventListener('participant-joined', (e) => {
      const { participantId, streamName } = e.detail;
      if ((participantId === this.streamId || this.streamId === 'any') && !this.streamName && streamName) {
        this.streamName = streamName;
        this.startWHEP(streamName);
      }
    });

    this.signaling.addEventListener('participant-left', (e) => {
      const { participantId } = e.detail;
      if (participantId === this.streamId) {
        this.showLoading('Stream unavailable');
      }
    });

    this.signaling.addEventListener('disconnected', () => {
      console.log('[SoloView] Disconnected, reconnecting...');
      this.showLoading('Reconnecting...');
      setTimeout(() => this.connect(), 2000);
    });

    this.signaling.addEventListener('error', (e) => {
      const { message } = e.detail;
      console.error('[SoloView] Server error:', message);
      this.showLoading('Error: ' + (message || 'Connection failed'));
    });

    this.signaling.connect(wsUrl);
  }

  async startWHEP(streamName) {
    const loading = document.getElementById('loading');
    if (!this.video) return;

    console.log('[SoloView] Starting WHEP for stream:', streamName);

    // Detect codec support and fallback to H264 if H265 not supported
    const h265Supported = await detectH265Support();
    const videoCodec = h265Supported ? 'H265' : 'H264';
    console.log('[SoloView] Using video codec:', videoCodec, h265Supported ? '(H265 supported)' : '(H265 not supported, fallback to H264)');

    this.whepClient = new WHEPClient(
      `/view/${streamName}`,
      this.video,
      {
        videoCodec,
        audioCodec: 'opus',
        onTrack: () => {
          console.log('[SoloView] Remote track received');
          if (loading) loading.style.display = 'none';
        }
      }
    );

    await this.whepClient.consume();
  }

  showLoading(message) {
    const loading = document.getElementById('loading');
    if (loading) {
      loading.textContent = message;
      loading.style.display = 'block';
    }
    if (this.video) {
      this.video.srcObject = null;
    }
    if (this.whepClient) {
      this.whepClient.close();
      this.whepClient = null;
    }
    this.streamName = null;
  }

  cleanup() {
    if (this.whepClient) this.whepClient.close();
    if (this.signaling) this.signaling.disconnect();
  }
}

if (window.location.hash.startsWith('#/view/')) {
  window.soloView = new SoloView();

  window.addEventListener('hashchange', () => {
    const newHash = window.location.hash;
    if (newHash.startsWith('#/view/')) {
      const parts = newHash.split('/');
      const newRoomId = parts[2]?.toUpperCase();
      const newStreamId = parts[3];

      if (newRoomId !== window.soloView.roomId || newStreamId !== window.soloView.streamId) {
        console.log('[SoloView] Room/stream changed, reinitializing...');
        if (window.soloView.signaling) window.soloView.signaling.disconnect();
        window.soloView = new SoloView();
      }
    }
  });
}

window.SoloView = SoloView;
