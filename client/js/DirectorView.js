/**
 * DirectorView - Director dashboard for managing room participants
 * Uses MediaMTX embedded WebRTC player (iframe)
 */
class DirectorView {
  constructor() {
    this.roomId = null;
    this.signaling = null;
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
    this.roomId = parts[2]?.toUpperCase();
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

    this.signaling.addEventListener('connected', () => {
      console.log('[Director] Connected');
      this.signaling.send('join-room-director', { roomId: this.roomId, name: 'Director' });
    });

    this.signaling.addEventListener('joined-room', (e) => {
      const { existingPeers } = e.detail;
      console.log('[Director] Joined room, existing peers:', existingPeers);

      if (existingPeers && Array.isArray(existingPeers)) {
        existingPeers.forEach(peer => {
          this.addParticipant(peer.participantId, peer.name, peer.streamName);
        });
      }
      this.updateParticipantCount();
    });

    this.signaling.addEventListener('participant-joined', (e) => {
      const { participantId, name, streamName } = e.detail;
      console.log('[Director] Participant joined:', participantId);
      this.addParticipant(participantId, name, streamName);
      this.updateParticipantCount();
      this.showToast(`${name} joined the room`, 'info');
    });

    this.signaling.addEventListener('participant-left', (e) => {
      const { participantId } = e.detail;
      console.log('[Director] Participant left:', participantId);
      this.removeParticipant(participantId);
      this.updateParticipantCount();
    });

    this.signaling.addEventListener('disconnected', () => {
      console.log('[Director] Disconnected, reconnecting...');
      setTimeout(() => this.connect(), 2000);
    });

    this.signaling.addEventListener('error', (e) => {
      const { message } = e.detail;
      console.error('[Director] Server error:', message);
      this.showToast(message || 'Connection error', 'error');
    });

    this.signaling.connect(wsUrl);
  }

  getMediaMTXEmbedUrl(streamName) {
    return `/view/${streamName}`;
  }

  addParticipant(peerId, name, streamName) {
    const grid = document.getElementById('director-grid');
    if (!grid) return;

    const card = document.createElement('div');
    card.className = 'director-card glass-panel animate-fade-in';
    card.id = `director-card-${peerId}`;

    const embedUrl = streamName ? this.getMediaMTXEmbedUrl(streamName) : '';
    const escapedName = this.escapeHtml(name);

    let videoContent;
    if (embedUrl) {
      videoContent = `
        <iframe
          src="${embedUrl}?autoplay=true&muted=true&playsinline=true"
          style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none;"
          allow="autoplay; encrypted-media"
          allowfullscreen
          scrolling="no">
        </iframe>
      `;
    } else {
      videoContent = `
        <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--color-text-secondary);">
          <span>No Stream</span>
        </div>
      `;
    }

    card.innerHTML = `
      <div style="position: relative; width: 100%; aspect-ratio: 16/9; background: var(--color-bg-primary); border-radius: 8px; overflow: hidden;">
        ${videoContent}
      </div>
      <div style="padding: 12px 0 0 0;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <span style="font-weight: 500;">${escapedName}</span>
          <span class="connection-status" style="font-size: 12px; color: var(--color-success);">Connected</span>
        </div>
        <div class="director-card-controls" style="display: flex; flex-wrap: wrap; gap: 8px;">
          <button class="btn btn-sm btn-secondary" onclick="window.directorView.copyPlayerLink('${this.escapeHtml(peerId)}')">Player Link</button>
          <button class="btn btn-sm btn-secondary" onclick="window.directorView.copySrtLink('${this.escapeHtml(peerId)}')">SRT Link</button>
          <button class="btn btn-sm btn-danger" onclick="window.directorView.muteParticipant('${this.escapeHtml(peerId)}')">Mute</button>
          <button class="btn btn-sm btn-danger" onclick="window.directorView.kickParticipant('${this.escapeHtml(peerId)}')">Kick</button>
        </div>
      </div>
    `;

    grid.appendChild(card);
    this.participants.set(peerId, { name, card, streamName, connected: true });
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

  async copyPlayerLink(peerId) {
    const participant = this.participants.get(peerId);
    if (!participant?.streamName) {
      this.showToast('No stream available', 'error');
      return;
    }
    const host = window.location.hostname;
    const link = `${window.location.origin}/view/${participant.streamName}/`;
    await this.copyToClipboard(link, 'Player link copied!');
  }

  async copySrtLink(peerId) {
    const participant = this.participants.get(peerId);
    if (!participant?.streamName) {
      this.showToast('No stream available', 'error');
      return;
    }
    const host = window.location.hostname;
    const streamId = `read:${participant.streamName}`;
    const link = `srt://${host}:8890?streamid=${streamId}`;
    await this.copyToClipboard(link, 'SRT link copied!');
  }

  async copyToClipboard(text, successMsg) {
    try {
      await navigator.clipboard.writeText(text);
      this.showToast(successMsg, 'success');
    } catch (error) {
      this.showToast('Failed to copy', 'error');
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
      this.participants.forEach((participant) => {
        const statusEl = participant.card.querySelector('.connection-status');
        if (statusEl) {
          statusEl.textContent = 'Connected';
          statusEl.style.color = 'var(--color-success)';
        }
      });
    }, 2000);
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const now = Date.now();
    const key = `${message}-${type}`;
    if (this.recentToasts && this.recentToasts.has(key)) {
      const lastShown = this.recentToasts.get(key);
      if (now - lastShown < 5000) return;
    }

    if (!this.recentToasts) this.recentToasts = new Map();
    this.recentToasts.set(key, now);

    if (this.recentToasts.size > 50) {
      const cutoff = now - 30000;
      for (const [k, v] of this.recentToasts.entries()) {
        if (v < cutoff) this.recentToasts.delete(k);
      }
    }

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
    if (this.recentToasts) {
      this.recentToasts.clear();
    }
    if (this.signaling) this.signaling.disconnect();
  }
}

if (window.location.hash.startsWith('#/director/')) {
  window.directorView = new DirectorView();
  window.addEventListener('beforeunload', () => window.directorView.cleanup());

  window.addEventListener('hashchange', () => {
    const newHash = window.location.hash;
    if (newHash.startsWith('#/director/')) {
      const newRoomId = newHash.split('/')[2]?.toUpperCase();
      if (newRoomId && newRoomId !== window.directorView.roomId) {
        console.log('[Director] Room changed from', window.directorView.roomId, 'to', newRoomId);
        window.directorView.cleanup();
        window.directorView = new DirectorView();
      }
    }
  });
}

window.DirectorView = DirectorView;
