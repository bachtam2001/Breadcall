/**
 * UIManager - Handles all UI rendering and user interactions
 */
class UIManager {
  constructor(app) {
    this.app = app;
    this.appElement = document.getElementById('app');
    this.currentView = null;
    this.participants = new Map();
    this.chatMessages = [];
    this.isSidebarOpen = false;
    this.isChatOpen = false;
  }

  /**
   * Render landing page
   */
  renderLanding() {
    // Parse URL parameters for auto-fill
    const urlParams = new URLSearchParams(window.location.search);
    const roomIdFromUrl = urlParams.get('room');
    const passwordFromUrl = urlParams.get('password');

    this.appElement.innerHTML = `
      <div class="landing animate-fade-in">
        <h1 class="landing-logo">BreadCall</h1>
        <p class="landing-description">
          Professional WebRTC platform for live production.
          Join a room to start broadcasting.
        </p>

        <div class="landing-form glass-panel">
          <h2>Join Room</h2>

          <form id="join-room-form">
            <div class="form-group">
              <label for="join-name">Your Name</label>
              <input type="text" id="join-name" placeholder="Enter your name" required>
            </div>
            <div class="form-group">
              <label for="join-room-id">Room ID</label>
              <input type="text" id="join-room-id" placeholder="4-letter code" maxlength="4"
                     style="text-transform: uppercase; letter-spacing: 4px; text-align: center;"
                     value="${roomIdFromUrl || ''}">
            </div>
            <div class="form-group">
              <label for="join-password">Password (optional)</label>
              <input type="password" id="join-password" placeholder="Room password"
                     value="${passwordFromUrl || ''}">
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary btn-block">
                Join Room
              </button>
            </div>
          </form>
        </div>

        <div style="margin-top: 24px; text-align: center;">
          <a href="/login" style="color: var(--color-text-secondary); font-size: var(--font-size-sm);">Staff Login</a>
        </div>

        <div id="toast-container" class="toast-container"></div>
      </div>
    `;

    this.bindLandingEvents();
    this.currentView = 'landing';

    // Auto-focus name field if room ID is pre-filled
    if (roomIdFromUrl) {
      const nameInput = document.getElementById('join-name');
      if (nameInput) nameInput.focus();
    }
  }

  /**
   * Bind landing page events
   */
  bindLandingEvents() {
    const joinForm = document.getElementById('join-room-form');
    joinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('join-name').value;
      const roomId = document.getElementById('join-room-id').value.toUpperCase();
      const password = document.getElementById('join-password').value;

      if (roomId.length === 4) {
        this.app.joinRoom(roomId, name, password);
      } else {
        this.showToast('Please enter a valid 4-character room ID', 'error');
      }
    });

    const roomIdInput = document.getElementById('join-room-id');
    roomIdInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase();
    });
  }

  /**
   * Render room view
   */
  renderRoom(roomId) {
    this.appElement.innerHTML = `
      <div class="room-view animate-fade-in">
        <div id="video-grid" class="video-grid" data-count="0"></div>

        <div class="control-bar glass-panel">
          <button id="btn-mute" class="btn btn-icon" title="Toggle Mic">🎤</button>
          <button id="btn-video" class="btn btn-icon" title="Toggle Camera">📹</button>
          <button id="btn-share" class="btn btn-icon" title="Share Screen">🖥️</button>
          <button id="btn-chat" class="btn btn-icon" title="Chat">💬</button>
          <button id="btn-settings" class="btn btn-icon" title="Settings">⚙️</button>
          <button id="btn-leave" class="btn btn-danger">Leave</button>
        </div>

        <div id="sidebar" class="sidebar">
          <div class="sidebar-header">
            <h3>Participants</h3>
            <button id="btn-close-sidebar" class="btn btn-icon">✕</button>
          </div>
          <div class="sidebar-content">
            <div id="participant-list" class="participant-list"></div>
          </div>
        </div>

        <div id="chat-panel" class="chat-panel glass-panel">
          <div class="chat-messages" id="chat-messages"></div>
          <div class="chat-input-container">
            <input type="text" id="chat-input" placeholder="Type a message...">
            <button id="btn-send-chat" class="btn btn-primary">Send</button>
          </div>
        </div>

        <div id="toast-container" class="toast-container"></div>

        <div id="settings-modal" class="modal-overlay">
          <div class="modal">
            <div class="modal-header">
              <h3>Settings</h3>
              <button id="btn-close-settings" class="modal-close">✕</button>
            </div>
            <div class="modal-body">
              <div class="form-group">
                <label for="camera-select">Camera</label>
                <select id="camera-select"></select>
              </div>
              <div class="form-group">
                <label for="mic-select">Microphone</label>
                <select id="mic-select"></select>
              </div>
              <div class="form-group">
                <label>Video Quality</label>
                <select id="quality-select">
                  <option value="sd">SD (480p)</option>
                  <option value="hd" selected>HD (720p)</option>
                  <option value="fhd">Full HD (1080p)</option>
                </select>
              </div>
            </div>
            <div class="modal-footer">
              <button id="btn-save-settings" class="btn btn-primary">Save</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindRoomEvents();
    this.currentView = 'room';
    this.showToast(`Joined room: ${roomId}`, 'info');
  }

  /**
   * Bind room events
   */
  bindRoomEvents() {
    document.getElementById('btn-mute').addEventListener('click', () => this.app.toggleMute());
    document.getElementById('btn-video').addEventListener('click', () => this.app.toggleVideo());
    document.getElementById('btn-share').addEventListener('click', () => this.app.toggleScreenShare());
    document.getElementById('btn-chat').addEventListener('click', () => this.toggleChat());
    document.getElementById('btn-settings').addEventListener('click', () => this.openSettings());
    document.getElementById('btn-leave').addEventListener('click', () => this.app.leaveRoom());

    document.getElementById('btn-close-sidebar')?.addEventListener('click', () => this.closeSidebar());
    document.getElementById('btn-send-chat')?.addEventListener('click', () => this.sendChatMessage());
    document.getElementById('chat-input')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendChatMessage();
    });
    document.getElementById('btn-close-settings')?.addEventListener('click', () => this.closeSettings());
    document.getElementById('btn-save-settings')?.addEventListener('click', () => this.saveSettings());
  }

  /**
   * Add video tile for participant
   */
  addVideoTile(peerId, stream, name = 'Anonymous') {
    const grid = document.getElementById('video-grid');
    if (!grid) return;

    const tile = document.createElement('div');
    tile.className = 'video-tile animate-fade-in';
    tile.id = `tile-${peerId}`;
    tile.innerHTML = `
      <video autoplay playsinline muted="${peerId === this.app.participantId}"></video>
      <div class="overlay">
        <span class="participant-name">${this.escapeHtml(name)}</span>
        <div class="status-indicator"><span class="status-dot"></span></div>
      </div>
    `;

    const video = tile.querySelector('video');
    video.srcObject = stream;

    grid.appendChild(tile);
    this.updateGridLayout();
    this.participants.set(peerId, { name, element: tile });
  }

  /**
   * Remove video tile
   */
  removeVideoTile(peerId) {
    const tile = document.getElementById(`tile-${peerId}`);
    if (tile) {
      tile.remove();
      this.participants.delete(peerId);
      this.updateGridLayout();
    }
  }

  /**
   * Update grid layout
   */
  updateGridLayout() {
    const grid = document.getElementById('video-grid');
    if (grid) {
      grid.setAttribute('data-count', grid.children.length);
    }
  }

  /**
   * Toggle chat panel
   */
  toggleChat() {
    const chatPanel = document.getElementById('chat-panel');
    if (chatPanel) {
      this.isChatOpen = !this.isChatOpen;
      chatPanel.classList.toggle('open', this.isChatOpen);
    }
  }

  /**
   * Send chat message
   */
  sendChatMessage() {
    const input = document.getElementById('chat-input');
    const message = input?.value.trim();
    if (message) {
      this.app.sendChatMessage(message);
      input.value = '';
    }
  }

  /**
   * Add chat message
   */
  addChatMessage(data) {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message';
    messageEl.innerHTML = `
      <div class="sender">${this.escapeHtml(data.sender || 'Anonymous')}</div>
      <div class="text">${this.escapeHtml(data.message)}</div>
      <div class="time">${new Date(data.timestamp || Date.now()).toLocaleTimeString()}</div>
    `;

    container.appendChild(messageEl);
    container.scrollTop = container.scrollHeight;
  }

  /**
   * Open settings modal
   */
  async openSettings() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
      modal.classList.add('active');
      await this.app.mediaManager.enumerateDevices();
      this.populateDeviceSelects();
    }
  }

  /**
   * Close settings modal
   */
  closeSettings() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.remove('active');
  }

  /**
   * Populate device selects
   */
  populateDeviceSelects() {
    const cameraSelect = document.getElementById('camera-select');
    const micSelect = document.getElementById('mic-select');

    if (cameraSelect) {
      cameraSelect.innerHTML = this.app.mediaManager.devices.cameras
        .map(d => `<option value="${d.deviceId}">${d.label || `Camera ${d.deviceId.slice(0, 5)}`}</option>`)
        .join('');
    }
    if (micSelect) {
      micSelect.innerHTML = this.app.mediaManager.devices.microphones
        .map(d => `<option value="${d.deviceId}">${d.label || `Mic ${d.deviceId.slice(0, 5)}`}</option>`)
        .join('');
    }
  }

  /**
   * Save settings
   */
  saveSettings() {
    const cameraSelect = document.getElementById('camera-select');
    const micSelect = document.getElementById('mic-select');

    if (cameraSelect?.value) this.app.switchCamera(cameraSelect.value);
    if (micSelect?.value) this.app.switchMicrophone(micSelect.value);

    this.closeSettings();
    this.showToast('Settings saved', 'success');
  }

  /**
   * Show toast notification
   */
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    // Prevent duplicate toasts with same message within 5 seconds
    const now = Date.now();
    const key = `${message}-${type}`;
    if (!this.recentToasts) {
      this.recentToasts = new Map();
    }

    // Clean up expired entries (>30s old) on every call to prevent unbounded growth
    const cutoff = now - 30000;
    for (const [k, v] of this.recentToasts.entries()) {
      if (v < cutoff) this.recentToasts.delete(k);
    }

    if (this.recentToasts.has(key)) {
      const lastShown = this.recentToasts.get(key);
      if (now - lastShown < 5000) return; // Skip if shown in last 5s
    }
    this.recentToasts.set(key, now);

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 4000);
  }

  /**
   * Show media device not found dialog with retry options
   */
  showMediaNotFoundDialog(onRetry, onContinueWithoutMedia, onEnableTestMode) {
    // Create modal overlay
    let modalOverlay = document.getElementById('media-not-found-modal');
    if (modalOverlay) {
      modalOverlay.remove();
    }

    modalOverlay = document.createElement('div');
    modalOverlay.id = 'media-not-found-modal';
    modalOverlay.className = 'modal-overlay active';
    modalOverlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 9999;';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.cssText = 'background: var(--color-bg-primary); border-radius: 12px; padding: 24px; max-width: 500px; width: 90%; box-shadow: 0 8px 32px rgba(0,0,0,0.3);';

    const header = document.createElement('div');
    header.style.cssText = 'margin-bottom: 16px;';
    const title = document.createElement('h3');
    title.style.cssText = 'margin: 0; color: var(--color-text-primary);';
    title.textContent = 'No Media Devices Found';
    header.appendChild(title);

    const body = document.createElement('div');
    body.style.cssText = 'margin-bottom: 24px;';

    const infoPara = document.createElement('p');
    infoPara.style.cssText = 'margin-bottom: 16px; color: var(--color-text-secondary);';
    infoPara.textContent = 'No camera or microphone was detected. You can:';
    body.appendChild(infoPara);

    const list = document.createElement('ul');
    list.style.cssText = 'margin: 16px 0; padding-left: 20px; color: var(--color-text-secondary);';

    const retryItem = document.createElement('li');
    retryItem.textContent = 'Retry device detection';
    const viewOnlyItem = document.createElement('li');
    viewOnlyItem.textContent = 'Continue in view-only mode';
    const testModeItem = document.createElement('li');
    testModeItem.textContent = 'Enable test mode (uses simulated video)';

    list.appendChild(retryItem);
    list.appendChild(viewOnlyItem);
    list.appendChild(testModeItem);
    body.appendChild(list);

    const tipPara = document.createElement('p');
    tipPara.style.cssText = 'font-size: 12px; color: var(--color-text-tertiary); margin-top: 16px;';
    tipPara.innerHTML = 'Tip: You can also add <code style="background: var(--color-bg-secondary); padding: 2px 6px; border-radius: 4px;">?testMode=true</code> to the URL.';
    body.appendChild(tipPara);

    const footer = document.createElement('div');
    footer.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap;';

    const retryBtn = document.createElement('button');
    retryBtn.className = 'btn btn-secondary';
    retryBtn.textContent = 'Retry';

    const noMediaBtn = document.createElement('button');
    noMediaBtn.className = 'btn btn-secondary';
    noMediaBtn.textContent = 'Continue Without Media';

    const testModeBtn = document.createElement('button');
    testModeBtn.className = 'btn btn-primary';
    testModeBtn.textContent = 'Enable Test Mode';

    footer.appendChild(retryBtn);
    footer.appendChild(noMediaBtn);
    footer.appendChild(testModeBtn);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    modalOverlay.appendChild(modal);
    document.body.appendChild(modalOverlay);

    // Bind events
    retryBtn.addEventListener('click', () => {
      modalOverlay.remove();
      onRetry();
    });

    noMediaBtn.addEventListener('click', () => {
      modalOverlay.remove();
      onContinueWithoutMedia();
    });

    testModeBtn.addEventListener('click', () => {
      modalOverlay.remove();
      onEnableTestMode();
    });
  }

  /**
   * Show join dialog with name and password fields
   * @param {string} roomId - The room ID to join
   */
  showJoinDialog(roomId) {
    // Remove any existing join dialog
    let dialog = document.querySelector('.join-dialog');
    if (dialog) {
      dialog.remove();
    }

    dialog = document.createElement('div');
    dialog.className = 'join-dialog active';
    dialog.innerHTML = `
      <div class="join-dialog-content">
        <h2>Join Room ${roomId}</h2>
        <div class="form-group">
          <label for="join-name">Your Name</label>
          <input type="text" id="join-name" placeholder="Enter your name" value="User">
        </div>
        <div class="form-group">
          <label for="join-password">Password (if required)</label>
          <input type="password" id="join-password" placeholder="Room password">
        </div>
        <button id="join-submit-btn" class="btn btn-primary">Join Room</button>
      </div>
    `;
    document.body.appendChild(dialog);

    // Bind submit button
    const submitBtn = document.getElementById('join-submit-btn');
    submitBtn.addEventListener('click', () => {
      const name = document.getElementById('join-name').value;
      const password = document.getElementById('join-password').value;
      this.app.joinRoom(roomId, name, password);
    });

    // Allow Enter key to submit
    const passwordInput = document.getElementById('join-password');
    passwordInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const name = document.getElementById('join-name').value;
        const pwd = document.getElementById('join-password').value;
        this.app.joinRoom(roomId, name, pwd);
      }
    });
  }

  /**
   * Update participant status
   */
  updateParticipantStatus(peerId, status) {
    const tile = document.getElementById(`tile-${peerId}`);
    if (!tile) return;
    const statusDot = tile.querySelector('.status-dot');
    if (statusDot) {
      statusDot.className = 'status-dot' + (status.isMuted ? ' warning' : '');
    }
  }

  /**
   * Update mute button state
   */
  updateMuteButton(isMuted) {
    const btn = document.getElementById('btn-mute');
    if (btn) {
      btn.classList.toggle('active', isMuted);
      btn.title = isMuted ? 'Unmute' : 'Mute';
    }
  }

  /**
   * Update video button state
   */
  updateVideoButton(isVideoOff) {
    const btn = document.getElementById('btn-video');
    if (btn) {
      btn.classList.toggle('active', isVideoOff);
      btn.title = isVideoOff ? 'Turn on camera' : 'Turn off camera';
    }
  }

  /**
   * Escape HTML
   */
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Close sidebar
   */
  closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      sidebar.classList.remove('open');
      this.isSidebarOpen = false;
    }
  }
}

window.UIManager = UIManager;
