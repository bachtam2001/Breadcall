/**
 * BreadCall Main App
 */
class BreadCallApp {
  constructor() {
    this.signaling = new SignalingClient();
    this.webrtc = null;
    this.mediaManager = new MediaManager();
    this.uiManager = new UIManager(this);

    this.roomId = null;
    this.participantId = null;
    this.localStream = null;
    this.isScreenSharing = false;
    this.screenStream = null;

    this.init();
  }

  async init() {
    this.setupSignalingHandlers();
    this.setupMediaHandlers();
    this.setupWebRTCHandlers();

    window.addEventListener('hashchange', () => this.handleRouteChange());
    this.handleRouteChange();
  }

  setupSignalingHandlers() {
    this.signaling.addEventListener('connected', () => {
      this.uiManager.showToast('Connected to server', 'success');
    });

    this.signaling.addEventListener('joined-room', (e) => {
      const { participantId, existingPeers } = e.detail;
      this.participantId = participantId;

      if (!this.webrtc) {
        this.webrtc = new WebRTCManager(this.signaling);
        this.setupWebRTCHandlers();
      }

      if (this.localStream) {
        this.webrtc.setLocalStream(this.localStream);
      }

      existingPeers.forEach(peer => {
        this.webrtc.createOffer(peer.participantId);
      });
    });

    this.signaling.addEventListener('participant-joined', (e) => {
      const { participantId } = e.detail;
      if (this.webrtc) this.webrtc.createOffer(participantId);
    });

    this.signaling.addEventListener('participant-left', (e) => {
      const { participantId } = e.detail;
      this.uiManager.removeVideoTile(participantId);
      if (this.webrtc) this.webrtc.closePeerConnection(participantId);
    });

    this.signaling.addEventListener('chat-message', (e) => {
      const { from, message, timestamp } = e.detail;
      const participant = this.uiManager.participants.get(from);
      this.uiManager.addChatMessage({
        sender: participant?.name || 'Anonymous',
        message,
        timestamp
      });
    });

    this.signaling.addEventListener('mute-status', (e) => {
      const { participantId, isMuted } = e.detail;
      this.uiManager.updateParticipantStatus(participantId, { isMuted });
    });

    this.signaling.addEventListener('offer', (e) => {
      const { from, sdp } = e.detail;
      if (this.webrtc) this.webrtc.handleOffer(from, sdp);
    });

    this.signaling.addEventListener('answer', (e) => {
      const { from, sdp } = e.detail;
      if (this.webrtc) this.webrtc.handleAnswer(from, sdp);
    });

    this.signaling.addEventListener('ice-candidate', (e) => {
      const { from, candidate } = e.detail;
      if (this.webrtc) this.webrtc.handleIceCandidate(from, candidate);
    });
  }

  setupMediaHandlers() {
    this.mediaManager.addEventListener('stream-created', (e) => {
      this.localStream = e.detail.stream;
      if (this.webrtc) this.webrtc.setLocalStream(this.localStream);
      this.uiManager.addVideoTile(this.participantId || 'local', this.localStream, 'You');
    });

    this.mediaManager.addEventListener('mute-changed', (e) => {
      const { isMuted, isVideoOff, kind } = e.detail;
      if (kind === 'audio') this.uiManager.updateMuteButton(isMuted);
      else if (kind === 'video') this.uiManager.updateVideoButton(isVideoOff);
      this.signaling.send('mute-status', { isMuted, isVideoOff });
    });
  }

  setupWebRTCHandlers() {
    if (!this.webrtc) return;

    this.webrtc.addEventListener('remote-stream', (e) => {
      const { peerId, stream } = e.detail;
      const tile = document.getElementById(`tile-${peerId}`);
      if (tile) {
        const video = tile.querySelector('video');
        if (video) video.srcObject = stream;
      } else {
        const participant = this.uiManager.participants.get(peerId);
        this.uiManager.addVideoTile(peerId, stream, participant?.name || 'Participant');
      }
    });

    this.webrtc.addEventListener('connection-state-change', (e) => {
      const { peerId, state } = e.detail;
      const tile = document.getElementById(`tile-${peerId}`);
      if (tile) {
        const indicator = tile.querySelector('.status-indicator');
        if (indicator) {
          if (state === 'connected') {
            indicator.innerHTML = '<span class="status-dot"></span>';
          } else if (state === 'failed') {
            indicator.innerHTML = '<span class="status-dot error"></span>';
          } else {
            indicator.innerHTML = '<span class="status-dot warning"></span>';
          }
        }
      }
    });
  }

  handleRouteChange() {
    const hash = window.location.hash;
    if (!hash || hash === '#/' || hash === '') {
      this.uiManager.renderLanding();
    } else if (hash.startsWith('#/room/')) {
      this.roomId = hash.split('/')[2];
      this.uiManager.renderRoom(this.roomId);
      this.joinRoom(this.roomId);
    } else if (hash.startsWith('#/view/')) {
      const parts = hash.split('/');
      this.renderSoloView(parts[2], parts[3]);
    } else if (hash.startsWith('#/director/')) {
      this.renderDirectorView(hash.split('/')[2]);
    }
  }

  async createRoom(options = {}) {
    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options)
      });
      const data = await response.json();
      if (data.success) {
        window.location.hash = `#/room/${data.roomId}`;
      } else {
        this.uiManager.showToast('Failed to create room: ' + data.error, 'error');
      }
    } catch (error) {
      this.uiManager.showToast('Failed to create room', 'error');
    }
  }

  async joinRoom(roomId) {
    try {
      await this.mediaManager.getUserMedia();
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
      this.signaling.connect(wsUrl);
      this.signaling.send('join-room', { roomId, name: 'User' });
    } catch (error) {
      this.uiManager.showToast('Failed to join room: ' + error.message, 'error');
    }
  }

  leaveRoom() {
    if (this.signaling) {
      this.signaling.send('leave-room');
      this.signaling.disconnect();
    }
    if (this.webrtc) this.webrtc.cleanup();
    if (this.mediaManager) this.mediaManager.stop();
    this.roomId = null;
    this.participantId = null;
    window.location.hash = '#/';
  }

  toggleMute() {
    if (this.mediaManager) this.mediaManager.toggleMute();
  }

  toggleVideo() {
    if (this.mediaManager) this.mediaManager.toggleVideo();
  }

  async toggleScreenShare() {
    if (!this.isScreenSharing) {
      try {
        this.screenStream = await this.mediaManager.getDisplayMedia({ includeAudio: false });
        const videoTrack = this.screenStream.getVideoTracks()[0];
        if (this.webrtc) await this.webrtc.replaceVideoTrack(videoTrack);
        this.isScreenSharing = true;
        this.uiManager.showToast('Screen sharing started', 'success');
        videoTrack.onended = () => this.toggleScreenShare();
      } catch (error) {
        this.uiManager.showToast('Failed to share screen', 'error');
      }
    } else {
      if (this.screenStream) {
        this.screenStream.getTracks().forEach(t => t.stop());
        this.screenStream = null;
      }
      if (this.localStream && this.webrtc) {
        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack) await this.webrtc.replaceVideoTrack(videoTrack);
      }
      this.isScreenSharing = false;
      this.uiManager.showToast('Screen sharing stopped', 'info');
    }
  }

  sendChatMessage(message) {
    this.signaling.send('chat-message', { message });
    this.uiManager.addChatMessage({ sender: 'You', message, timestamp: Date.now() });
  }

  async switchCamera(deviceId) {
    try {
      await this.mediaManager.switchCamera(deviceId);
      const newTrack = this.mediaManager.videoTrack;
      if (this.webrtc) await this.webrtc.replaceVideoTrack(newTrack);
      this.uiManager.showToast('Camera switched', 'success');
    } catch (error) {
      this.uiManager.showToast('Failed to switch camera', 'error');
    }
  }

  async switchMicrophone(deviceId) {
    try {
      await this.mediaManager.switchMicrophone(deviceId);
      const newTrack = this.mediaManager.audioTrack;
      if (this.webrtc) await this.webrtc.replaceAudioTrack(newTrack);
      this.uiManager.showToast('Microphone switched', 'success');
    } catch (error) {
      this.uiManager.showToast('Failed to switch microphone', 'error');
    }
  }

  renderSoloView(roomId, streamId) {
    document.body.innerHTML = '<div class="solo-view"><video autoplay playsinline></video></div>';
    const video = document.querySelector('video');
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

    const signaling = new SignalingClient();
    const webrtc = new WebRTCManager(signaling);

    signaling.connect(wsUrl);

    signaling.addEventListener('connected', () => {
      signaling.send('join-room', { roomId, name: 'SoloView' });
    });

    webrtc.addEventListener('remote-stream', (e) => {
      video.srcObject = e.detail.stream;
    });

    signaling.addEventListener('offer', (e) => {
      const { from, sdp } = e.detail;
      if (from === streamId || streamId === 'any') {
        webrtc.handleOffer(from, sdp);
      }
    });

    signaling.addEventListener('answer', (e) => {
      const { from, sdp } = e.detail;
      webrtc.handleAnswer(from, sdp);
    });

    signaling.addEventListener('ice-candidate', (e) => {
      const { from, candidate } = e.detail;
      webrtc.handleIceCandidate(from, candidate);
    });

    setTimeout(() => webrtc.createOffer(streamId), 500);
  }

  renderDirectorView(roomId) {
    document.body.innerHTML = `
      <div class="director-dashboard">
        <div class="director-header" style="padding: 16px 24px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <h1 style="margin: 0 0 8px 0;">Director Dashboard</h1>
            <p style="margin: 0; color: var(--color-text-secondary);">Room: <strong>${roomId}</strong></p>
          </div>
          <div class="director-stats">
            <div class="stat-item" style="text-align: center;">
              <div class="stat-value" id="participant-count" style="font-size: 32px; font-weight: 700; color: var(--color-accent-primary);">0</div>
              <div class="stat-label" style="font-size: 12px; color: var(--color-text-tertiary);">Participants</div>
            </div>
          </div>
        </div>
        <div id="director-grid" class="director-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 16px;"></div>
        <div id="toast-container" class="toast-container"></div>
      </div>
    `;

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

    const signaling = new SignalingClient();
    const webrtc = new WebRTCManager(signaling);
    const participants = new Map();

    signaling.connect(wsUrl);

    signaling.addEventListener('joined-room', (e) => {
      const { existingPeers } = e.detail;
      document.getElementById('participant-count').textContent = existingPeers.length;
      existingPeers.forEach(peer => {
        this.addDirectorCard(peer.participantId, peer.name, roomId);
        webrtc.createOffer(peer.participantId);
      });
    });

    signaling.addEventListener('participant-joined', (e) => {
      const { participantId, name } = e.detail;
      this.addDirectorCard(participantId, name, roomId);
      webrtc.createOffer(participantId);
      const countEl = document.getElementById('participant-count');
      countEl.textContent = parseInt(countEl.textContent) + 1;
    });

    signaling.addEventListener('participant-left', (e) => {
      const { participantId } = e.detail;
      const card = document.getElementById(`director-card-${participantId}`);
      if (card) card.remove();
      const countEl = document.getElementById('participant-count');
      countEl.textContent = Math.max(0, parseInt(countEl.textContent) - 1);
    });

    webrtc.addEventListener('remote-stream', (e) => {
      const { peerId, stream } = e.detail;
      const card = document.getElementById(`director-card-${peerId}`);
      if (card) {
        const video = card.querySelector('video');
        if (video) video.srcObject = stream;
      }
    });

    signaling.send('join-room', { roomId, name: 'Director' });

    // Store for global access
    window.directorView = { signaling, webrtc, participants };
  }

  addDirectorCard(peerId, name, roomId) {
    const grid = document.getElementById('director-grid');
    if (!grid) return;

    const card = document.createElement('div');
    card.className = 'director-card glass-panel animate-fade-in';
    card.id = `director-card-${peerId}`;
    card.innerHTML = `
      <video autoplay muted playsinline style="width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: 8px; background: var(--color-bg-primary);"></video>
      <div style="padding: 12px 0 0 0;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <span style="font-weight: 500;">${this.escapeHtml(name)}</span>
          <span class="connection-status" style="font-size: 12px; color: var(--color-success);">Connected</span>
        </div>
        <div class="director-card-controls" style="display: flex; flex-wrap: wrap; gap: 8px;">
          <button class="btn btn-sm btn-secondary" onclick="navigator.clipboard.writeText('${window.location.origin}/#/view/${roomId}/${peerId}')">Copy Link</button>
          <button class="btn btn-sm btn-danger" onclick="alert('Kick functionality coming soon')">Kick</button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new BreadCallApp();
});
