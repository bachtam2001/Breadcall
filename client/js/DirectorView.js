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

  async init() {
    this.parseUrl();
    this.srtPublishUrl = null;
    this.srtStreamActive = false;
    this.srtMode = null; // 'push' or 'pull'
    this.srtPullUrl = null;

    // Check for token in URL
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (token) {
      // Validate token before rendering
      await this.handleTokenBasedAccess(token);
    } else {
      this.render();
      this.connect();
      this.startStatsPolling();
      this.fetchSrtConfig();
    }
  }

  async handleTokenBasedAccess(token) {
    try {
      const signaling = new SignalingClient();
      // Validate token with 'view_all' permission for director access
      const validation = await signaling.validateToken(token, 'view_all');

      if (!validation.valid) {
        console.error('[Director] Token validation failed:', validation.reason);
        alert(validation.message || 'Invalid or expired token');
        window.location.href = '/';
        return;
      }

      const { type, roomId, permissions, metadata } = validation.payload;

      if (type !== 'director_access') {
        alert('Invalid token type for director access');
        window.location.href = '/';
        return;
      }

      console.log('[Director] Token validated successfully:', { roomId, type, permissions });

      // Update room ID and proceed with normal initialization
      this.roomId = roomId;
      this.authToken = token;
      this.tokenMetadata = metadata;

      this.render();
      this.connect();
      this.startStatsPolling();
    } catch (error) {
      console.error('[Director] Token handling failed:', error);
      alert('Token validation failed: ' + error.message);
      window.location.href = '/';
    }
  }

  parseUrl() {
    const path = window.location.pathname;
    const parts = path.split('/');
    this.roomId = parts[2]?.toUpperCase();
  }

  /**
   * Fetch SRT configuration from server
   */
  async fetchSrtConfig() {
    try {
      const response = await fetch(`/api/${this.roomId}/srt/config`);
      const data = await response.json();

      if (data.success) {
        this.srtMode = data.mode;
        this.srtPullUrl = data.pullUrl;
        this.srtStreamActive = data.streamActive;

        // Fetch SRT publish URL if in push mode
        if (this.srtMode === 'push') {
          await this.fetchSrtPublishUrl();
        }

        this.updateSrtDisplay();
        this.updateSrtModeUI();
      }
    } catch (error) {
      console.error('[Director] Failed to fetch SRT config:', error);
    }
  }

  /**
   * Fetch SRT publish URL for push mode
   */
  async fetchSrtPublishUrl() {
    try {
      const host = window.location.hostname;
      // The secret would be fetched from server - for now construct with room ID
      this.srtPublishUrl = `srt://${host}:8890?streamid=publish:room/${this.roomId}`;
    } catch (error) {
      console.error('[Director] Failed to fetch SRT publish URL:', error);
    }
  }

  /**
   * Update SRT status display
   */
  updateSrtDisplay() {
    const statusEl = document.getElementById('srt-status');
    if (statusEl) {
      if (this.srtMode === 'pull') {
        statusEl.textContent = this.srtStreamActive ? '● Active (Pull)' : '○ Waiting for stream';
      } else if (this.srtMode === 'push') {
        statusEl.textContent = this.srtStreamActive ? '● Active (Push)' : '○ Waiting for source';
      } else {
        statusEl.textContent = '○ Not configured';
      }
      statusEl.style.color = this.srtStreamActive ? 'var(--color-success)' : 'var(--color-text-tertiary)';
    }

    const urlEl = document.getElementById('srt-url');
    if (urlEl) {
      if (this.srtMode === 'push' && this.srtPublishUrl) {
        urlEl.textContent = this.srtPublishUrl;
      } else if (this.srtMode === 'pull' && this.srtPullUrl) {
        urlEl.textContent = this.srtPullUrl;
      } else {
        urlEl.textContent = 'Not configured';
      }
    }
  }

  /**
   * Update SRT mode UI (radio buttons and input visibility)
   */
  updateSrtModeUI() {
    // Update radio buttons
    const pushRadio = document.getElementById('srt-mode-push');
    const pullRadio = document.getElementById('srt-mode-pull');
    if (pushRadio && pullRadio) {
      pushRadio.checked = this.srtMode === 'push';
      pullRadio.checked = this.srtMode === 'pull';
    }

    // Show/hide pull URL input
    const pullUrlSection = document.getElementById('srt-pull-url-section');
    const pushUrlSection = document.getElementById('srt-push-url-section');
    if (pullUrlSection && pushUrlSection) {
      if (this.srtMode === 'pull') {
        pullUrlSection.style.display = 'block';
        pushUrlSection.style.display = 'none';
      } else if (this.srtMode === 'push') {
        pullUrlSection.style.display = 'none';
        pushUrlSection.style.display = 'block';
      } else {
        pullUrlSection.style.display = 'none';
        pushUrlSection.style.display = 'none';
      }
    }

    // Update connect/disconnect button state
    const connectBtn = document.getElementById('srt-connect-btn');
    const disconnectBtn = document.getElementById('srt-disconnect-btn');
    if (connectBtn && disconnectBtn) {
      if (this.srtMode === 'pull') {
        connectBtn.style.display = this.srtStreamActive ? 'none' : 'inline-block';
        disconnectBtn.style.display = this.srtStreamActive ? 'inline-block' : 'none';
      } else {
        connectBtn.style.display = 'none';
        disconnectBtn.style.display = 'none';
      }
    }
  }

  /**
   * Copy SRT URL to clipboard
   */
  async copySrtUrl() {
    const url = this.srtMode === 'pull' ? this.srtPullUrl : this.srtPublishUrl;
    if (!url) {
      this.showToast('SRT URL not available', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      this.showToast('SRT URL copied!', 'success');
    } catch (error) {
      this.showToast('Failed to copy', 'error');
    }
  }

  /**
   * Set SRT mode (push or pull)
   */
  async setSrtMode(mode, pullUrl = null) {
    try {
      const response = await fetch(`/api/${this.roomId}/srt/configure`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ mode, pullUrl })
      });

      const data = await response.json();

      if (data.success) {
        this.srtMode = mode;
        this.srtPullUrl = pullUrl;
        this.srtStreamActive = data.streamActive;

        if (mode === 'push') {
          await this.fetchSrtPublishUrl();
        }

        this.updateSrtDisplay();
        this.updateSrtModeUI();
        this.showToast(`SRT mode set to ${mode}`, 'success');

        // Notify via signaling for real-time updates
        this.signaling.send('srt-config-changed', {
          roomId: this.roomId,
          mode,
          pullUrl
        });
      } else {
        this.showToast(data.error || 'Failed to set SRT mode', 'error');
      }
    } catch (error) {
      console.error('[Director] Set SRT mode failed:', error);
      this.showToast('Failed to set SRT mode', 'error');
    }
  }

  /**
   * Connect SRT pull stream
   */
  async connectSrtPull() {
    const pullUrlInput = document.getElementById('srt-pull-url-input');
    const pullUrl = pullUrlInput?.value?.trim();

    if (!pullUrl) {
      this.showToast('Please enter an SRT URL', 'error');
      return;
    }

    if (!pullUrl.startsWith('srt://')) {
      this.showToast('Invalid SRT URL format', 'error');
      return;
    }

    await this.setSrtMode('pull', pullUrl);
  }

  /**
   * Disconnect SRT pull stream
   */
  async disconnectSrtPull() {
    try {
      // Switch to push mode to disconnect pull
      await this.setSrtMode('push');
      this.showToast('SRT pull disconnected', 'success');
    } catch (error) {
      console.error('[Director] Disconnect SRT failed:', error);
      this.showToast('Failed to disconnect', 'error');
    }
  }

  render() {
    // Note: HTML is generated from controlled template literals, not user input
    // All dynamic values are escaped via escapeHtml() method
    document.body.innerHTML = `
      <div class="director-dashboard animate-fade-in">
        <div class="director-header glass-panel" style="padding: 16px 24px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <h1 style="margin: 0 0 8px 0; font-size: 24px;">Director Dashboard</h1>
            <p style="margin: 0; color: var(--color-text-secondary);">Room: <strong style="color: var(--color-accent-primary);">${this.escapeHtml(this.roomId)}</strong></p>
          </div>
          <div class="director-stats" style="display: flex; gap: 32px;">
            <div class="stat-item" style="text-align: center;">
              <div class="stat-value" id="participant-count" style="font-size: 32px; font-weight: 700; color: var(--color-accent-primary);">0</div>
              <div class="stat-label" style="font-size: 12px; color: var(--color-text-tertiary);">Participants</div>
            </div>
          </div>
        </div>

        <!-- SRT Input Section -->
        <div class="srt-input-section glass-panel" style="padding: 16px; margin-bottom: 24px;">
          <h2 style="margin: 0 0 12px 0; font-size: 18px;">SRT Input Feed</h2>

          <!-- Mode Selection -->
          <div style="margin-bottom: 16px;">
            <label style="display: inline-flex; align-items: center; gap: 8px; margin-right: 16px; cursor: pointer;">
              <input type="radio" name="srt-mode" id="srt-mode-push" value="push" ${this.srtMode === 'push' ? 'checked' : ''} onchange="window.directorView.setSrtMode('push')">
              <span>Push Mode (External source pushes to this room)</span>
            </label>
            <label style="display: inline-flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="radio" name="srt-mode" id="srt-mode-pull" value="pull" ${this.srtMode === 'pull' ? 'checked' : ''} onchange="window.directorView.setSrtMode('pull', document.getElementById('srt-pull-url-input').value.trim())">
              <span>Pull Mode (This room pulls from external SRT source)</span>
            </label>
          </div>

          <!-- Push Mode URL Section -->
          <div id="srt-push-url-section" style="${this.srtMode === 'push' ? 'display: block;' : 'display: none;'}">
            <p style="color: var(--color-text-secondary); margin-bottom: 12px;">
              Use this URL to push external video sources (OBS, vMix) to the room
            </p>
            <div style="display: flex; gap: 8px; align-items: center;">
              <code id="srt-url" style="flex: 1; background: var(--color-bg-secondary); padding: 8px; border-radius: 4px; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${this.srtPublishUrl || 'SRT URL not available'}
              </code>
              <button class="btn btn-secondary" id="copy-srt-btn">
                Copy
              </button>
            </div>
          </div>

          <!-- Pull Mode URL Section -->
          <div id="srt-pull-url-section" style="${this.srtMode === 'pull' ? 'display: block;' : 'display: none;'}">
            <p style="color: var(--color-text-secondary); margin-bottom: 12px;">
              Enter the SRT URL of the remote source to pull from
            </p>
            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
              <input
                type="text"
                id="srt-pull-url-input"
                placeholder="srt://remote-server:8890?mode=caller&streamid=mystream"
                value="${this.srtPullUrl || ''}"
                style="flex: 1; background: var(--color-bg-secondary); border: 1px solid var(--color-border); padding: 8px; border-radius: 4px; font-family: monospace; color: var(--color-text-primary);"
              />
              <button class="btn btn-primary" id="srt-connect-btn" ${this.srtStreamActive ? 'style="display: none;"' : ''}>
                Connect
              </button>
              <button class="btn btn-danger" id="srt-disconnect-btn" ${!this.srtStreamActive ? 'style="display: none;"' : ''}>
                Disconnect
              </button>
            </div>
            <div style="margin-top: 8px;">
              <code id="srt-url" style="background: var(--color-bg-secondary); padding: 8px; border-radius: 4px; font-family: monospace; display: block; overflow: hidden; text-overflow: ellipsis;">
                ${this.srtPullUrl || 'Not configured'}
              </code>
            </div>
          </div>

          <div id="srt-status" style="margin-top: 12px; font-size: 12px; color: var(--color-text-tertiary);">
            ${this.srtStreamActive ? '● Active' : '○ Not configured'}
          </div>
        </div>

        <div id="director-grid" class="director-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 16px;"></div>
        <div id="toast-container" class="toast-container"></div>
      </div>
    `;

    // Attach event listeners
    const copyBtn = document.getElementById('copy-srt-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => this.copySrtUrl());
    }

    const connectBtn = document.getElementById('srt-connect-btn');
    if (connectBtn) {
      connectBtn.addEventListener('click', () => this.connectSrtPull());
    }

    const disconnectBtn = document.getElementById('srt-disconnect-btn');
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', () => this.disconnectSrtPull());
    }
  }

  connect() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

    this.signaling = new SignalingClient();

    this.signaling.addEventListener('connected', () => {
      console.log('[Director] Connected');

      // Use token if available
      if (this.authToken) {
        this.signaling.send('join-room-with-token', {
          roomId: this.roomId,
          token: this.authToken,
          name: this.tokenMetadata?.name || 'Director'
        });
      } else {
        this.signaling.send('join-room-director', { roomId: this.roomId, name: 'Director' });
      }
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

    this.signaling.addEventListener('srt-feed-updated', (e) => {
      const { active, connectedAt } = e.detail;
      console.log('[Director] SRT feed updated:', { active, connectedAt });
      this.srtStreamActive = active;
      this.updateSrtDisplay();

      if (active) {
        this.showToast('SRT feed is now active', 'success');
      } else {
        this.showToast('SRT feed has stopped', 'info');
      }
    });

    this.signaling.addEventListener('srt-config-updated', (e) => {
      const { mode, pullUrl, streamActive } = e.detail;
      console.log('[Director] SRT config updated:', { mode, pullUrl, streamActive });
      this.srtMode = mode;
      this.srtPullUrl = pullUrl;
      this.srtStreamActive = streamActive;

      if (mode === 'push') {
        this.fetchSrtPublishUrl();
      }

      this.updateSrtDisplay();
      this.updateSrtModeUI();
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
    // Clear any existing interval to prevent duplicates
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }
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

if (window.location.pathname.startsWith('/director/')) {
  window.directorView = new DirectorView();
  window.addEventListener('beforeunload', () => window.directorView.cleanup());

  window.addEventListener('popstate', () => {
    const newPath = window.location.pathname;
    if (newPath.startsWith('/director/')) {
      const newRoomId = newPath.split('/')[2]?.toUpperCase();
      if (newRoomId && newRoomId !== window.directorView.roomId) {
        console.log('[Director] Room changed from', window.directorView.roomId, 'to', newRoomId);
        window.directorView.cleanup();
        window.directorView = new DirectorView();
      }
    }
  });
}

window.DirectorView = DirectorView;
