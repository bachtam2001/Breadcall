/**
 * SoloView - Full-screen single stream view for OBS Browser Source
 */
class SoloView {
  constructor() {
    this.roomId = null;
    this.streamId = null;
    this.params = {};
    this.signaling = null;
    this.webrtc = null;
    this.video = null;
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
    this.roomId = parts[2];
    this.streamId = parts[3];

    const queryString = window.location.search.slice(1);
    const urlParams = new URLSearchParams(queryString);

    this.params = {
      bitrate: parseInt(urlParams.get('bitrate')) || 2500,
      codec: urlParams.get('codec') || 'H264',
      width: parseInt(urlParams.get('width')) || 1920,
      height: parseInt(urlParams.get('height')) || 1080,
      fps: parseInt(urlParams.get('fps')) || 30,
      stereo: urlParams.get('stereo') === '1',
      buffer: parseInt(urlParams.get('buffer')) || 0,
      transparent: urlParams.get('transparent') === '1'
    };
  }

  render() {
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';
    document.body.style.backgroundColor = this.params.transparent ? 'transparent' : 'black';

    document.body.innerHTML = '<video autoplay playsinline style="width: 100vw; height: 100vh; object-fit: contain;"></video>';
    this.video = document.querySelector('video');
  }

  connect() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

    this.signaling = new SignalingClient();
    this.webrtc = new WebRTCManager(this.signaling);

    this.signaling.connect(wsUrl);

    this.signaling.addEventListener('joined-room', async (e) => {
      console.log('[SoloView] Joined room');
      const { existingPeers } = e.detail;

      // Fetch OME Config
      const res = await fetch('/api/ome-config');
      const config = await res.json();
      if (config.success) this.webrtc.setOmeConfig(config);

      const targetPeer = existingPeers.find(p => p.participantId === this.streamId || this.streamId === 'any');
      if (targetPeer && targetPeer.streamName) {
        this.webrtc.consumeRemoteStream(targetPeer.participantId, targetPeer.streamName);
      }
      this.signaling.send('join-room', { roomId: this.roomId, name: 'SoloView' });
    });

    this.signaling.addEventListener('participant-joined', (e) => {
      const { participantId, streamName } = e.detail;
      if (participantId === this.streamId || this.streamId === 'any') {
        if (streamName) this.webrtc.consumeRemoteStream(participantId, streamName);
      }
    });

    this.webrtc.addEventListener('remote-stream', (e) => {
      if (e.detail.peerId === this.streamId || this.streamId === 'any') {
        console.log('[SoloView] Received stream from', e.detail.peerId);
        this.video.srcObject = e.detail.stream;
      }
    });

    // P2P signaling ignored
    /*
    this.signaling.addEventListener('offer', ...);
    this.signaling.addEventListener('answer', ...);
    this.signaling.addEventListener('ice-candidate', ...);
    */

    this.signaling.addEventListener('disconnected', () => {
      console.log('[SoloView] Disconnected, reconnecting...');
      setTimeout(() => this.connect(), 2000);
    });

    // No need for initial offer in SFU
    // setTimeout(() => webrtc.createOffer(this.streamId), 1000);
  }

  async getStats() {
    if (!this.webrtc) return null;
    return await this.webrtc.getStats(this.streamId);
  }
}

if (window.location.hash.startsWith('#/view/')) {
  window.soloView = new SoloView();
}

window.SoloView = SoloView;
