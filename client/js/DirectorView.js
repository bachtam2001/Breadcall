/**
 * DirectorView - Director dashboard for managing room participants
 */
class DirectorView {
  constructor() {
    this.roomId = null;
    this.signaling = null;
    this.webrtc = null;
    this.participants = new Map();
    this.statsInterval = null;
    this.init();
  }

  init() {
    this.parseUrl();
    this.render();
    this.connect();
    this.startStatsPolling();
  }

  parseUrl() {
    const hash = window.location.hash;
    const parts = hash.split('/');
    this.roomId = parts[2];
  }

  render() {
    document.body.innerHTML = `
      <div class="director-dashboard animate-fade-in">
        <div class="director-header glass-panel" style="padding: 16px 24px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <h1 style="margin: 0 0 8px 0; font-size: 24px;">Director Dashboard</h1>
            <p style="margin: 0; color: var(--color-text-secondary);">Room: <strong style="color: var(--color-accent-primary);">${this.roomId}</strong></p>
          </div>
          <div class="director-stats" style="display: flex; gap: 32px;">
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
  }

  connect() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

    this.signaling = new SignalingClient();
    this.webrtc = new WebRTCManager(this.signaling);

    this.signaling.connect(wsUrl);

    this.signaling.addEventListener('connected', () => {
      console.log('[Director] Connected');
      this.signaling.send('join-room', { roomId: this.roomId, name: 'Director' });
    });

    this.signaling.addEventListener('joined-room', (e) => {
      const { existingPeers } = e.detail;
      console.log('[Director] Joined room, existing peers:', existingPeers);
      existingPeers.forEach(peer => {
        this.addParticipant(peer.participantId, peer.name);
        this.webrtc.createOffer(peer.participantId);
      });
      this.updateParticipantCount();
    });

    this.signaling.addEventListener('participant-joined', (e) => {
      const { participantId, name } = e.detail;
      console.log('[Director] Participant joined:', participantId);
      this.addParticipant(participantId, name);
      this.webrtc.createOffer(participantId);
      this.updateParticipantCount();
      this.showToast(`${name} joined the room`, 'info');
    });

    this.signaling.addEventListener('participant-left', (e) => {
      const { participantId } = e.detail;
      console.log('[Director] Participant left:', participantId);
      this.removeParticipant(participantId);
      this.updateParticipantCount();
    });

    this.webrtc.addEventListener('remote-stream', (e) => {
      const { peerId, stream } = e.detail;
      console.log('[Director] Received stream from', peerId);
      this.attachStream(peerId, stream);
    });

    this.signaling.addEventListener('disconnected', () => {
      console.log('[Director] Disconnected, reconnecting...');
      setTimeout(() => this.connect(), 2000);
    });
  }

  addParticipant(peerId, name) {
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
          <button class="btn btn-sm btn-secondary" onclick="window.directorView.copySoloLink('${peerId}')">Copy Link</button>
          <button class="btn btn-sm btn-secondary" onclick="window.directorView.showStats('${peerId}')">Stats</button>
          <button class="btn btn-sm btn-danger" onclick="window.directorView.muteParticipant('${peerId}')">Mute</button>
          <button class="btn btn-sm btn-danger" onclick="window.directorView.kickParticipant('${peerId}')">Kick</button>
        </div>
      </div>
    `;

    grid.appendChild(card);
    this.participants.set(peerId, { name, card, stream: null });
  }

  attachStream(peerId, stream) {
    const participant = this.participants.get(peerId);
    if (!participant) return;

    const video = participant.card.querySelector('video');
    if (video) {
      video.srcObject = stream;
      participant.stream = stream;
    }
  }

  removeParticipant(peerId) {
    const card = document.getElementById(`director-card-${peerId}`);
    if (card) card.remove();
    this.participants.delete(peerId);
  }

  updateParticipantCount() {
    const countEl = document.getElementById('participant-count');
    if (countEl) countEl.textContent = this.participants.size;
  }

  async copySoloLink(peerId) {
    const participant = this.participants.get(peerId);
    if (!participant) return;

    const link = `${window.location.origin}/#/view/${this.roomId}/${peerId}`;

    try {
      await navigator.clipboard.writeText(link);
      this.showToast('Solo view link copied!', 'success');
    } catch (error) {
      this.showToast('Failed to copy link', 'error');
    }
  }

  async showStats(peerId) {
    const participant = this.participants.get(peerId);
    if (!participant) return;

    try {
      const stats = await this.webrtc.getStats(peerId);
      let statsText = `Stats for ${participant.name}:\n\n`;

      stats.forEach(report => {
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          statsText += `Resolution: ${report.frameWidth}x${report.frameHeight}\n`;
          statsText += `FPS: ${report.framesPerSecond}\n`;
          statsText += `Packets Lost: ${report.packetsLost}\n`;
        }
      });

      alert(statsText);
    } catch (error) {
      this.showToast('Failed to get stats', 'error');
    }
  }

  muteParticipant(peerId) {
    this.signaling.send('remote-mute', { targetPeerId: peerId, muted: true });
    this.showToast(`Mute request sent for ${peerId}`, 'info');
  }

  kickParticipant(peerId) {
    if (confirm(`Are you sure you want to kick ${this.participants.get(peerId)?.name || 'this participant'}?`)) {
      this.signaling.send('kick-participant', { targetPeerId: peerId });
      this.showToast('Kick request sent', 'info');
    }
  }

  startStatsPolling() {
    this.statsInterval = setInterval(() => {
      this.participants.forEach((participant, peerId) => {
        const statusEl = participant.card.querySelector('.connection-status');
        const state = this.webrtc.getConnectionState(peerId);

        if (statusEl) {
          if (state === 'connected') {
            statusEl.textContent = 'Connected';
            statusEl.style.color = 'var(--color-success)';
          } else if (state === 'disconnected' || state === 'failed') {
            statusEl.textContent = 'Disconnected';
            statusEl.style.color = 'var(--color-error)';
          } else {
            statusEl.textContent = 'Connecting...';
            statusEl.style.color = 'var(--color-warning)';
          }
        }
      });
    }, 2000);
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => toast.remove(), 4000);
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  cleanup() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    if (this.webrtc) this.webrtc.cleanup();
    if (this.signaling) this.signaling.disconnect();
  }
}

if (window.location.hash.startsWith('#/director/')) {
  window.directorView = new DirectorView();
  window.addEventListener('beforeunload', () => window.directorView.cleanup());
}

window.DirectorView = DirectorView;
