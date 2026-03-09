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
    this.appElement.innerHTML = `
      <div class="landing animate-fade-in">
        <h1 class="landing-logo">BreadCall</h1>
        <p class="landing-description">
          Professional WebRTC platform for live production.
          Create rooms, split streams, and broadcast with low latency.
        </p>

        <div class="landing-form glass-panel">
          <h2>Create or Join Room</h2>

          <form id="create-room-form">
            <div class="form-group">
              <label for="room-name">Room Name (optional)</label>
              <input type="text" id="room-name" placeholder="My Room">
            </div>
            <div class="form-group">
              <label for="room-password">Password (optional)</label>
              <input type="password" id="room-password" placeholder="Enter password">
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary btn-block">
                Create New Room
              </button>
            </div>
          </form>

          <div class="form-divider">or</div>

          <form id="join-room-form">
            <div class="form-group">
              <label for="join-room-id">Room ID</label>
              <input type="text" id="join-room-id" placeholder="4-letter code" maxlength="4"
                     style="text-transform: uppercase; letter-spacing: 4px; text-align: center;">
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-secondary btn-block">
                Join Room
              </button>
            </div>
          </form>
        </div>
      </div>
    `;

    this.bindLandingEvents();
    this.currentView = 'landing';
  }

  /**
   * Bind landing page events
   */
  bindLandingEvents() {
    const createForm = document.getElementById('create-room-form');
    createForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('room-name').value;
      const password = document.getElementById('room-password').value;
      this.app.createRoom({ name, password });
    });

    const joinForm = document.getElementById('join-room-form');
    joinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const roomId = document.getElementById('join-room-id').value.toUpperCase();
      if (roomId.length === 4) {
        this.app.joinRoom(roomId);
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

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 4000);
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
