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
    this.webrtcConfig = null; // Store WebRTC configuration
    this.hasConnected = false; // Track first connection to prevent notification loops
    this.joinTimeoutId = null; // Track join timeout for cleanup
    this.isJoining = false; // Prevent concurrent join attempts

    this.init();
  }

  async init() {
    const configLoaded = await this.fetchWebRTCConfig();
    if (!configLoaded) {
      console.warn('[BreadCallApp] Running without SFU configuration');
    }

    this.setupSignalingHandlers();
    this.setupMediaHandlers();
    this.setupWebRTCHandlers();

    window.addEventListener('hashchange', () => this.handleRouteChange());
    this.handleRouteChange();
  }

  setupSignalingHandlers() {
    this.signaling.addEventListener('connected', () => {
      // Only show toast on first connection, not reconnections
      if (!this.hasConnected) {
        this.uiManager.showToast('Connected to server', 'success');
        this.hasConnected = true;
      }
    });

    this.signaling.addEventListener('joined-room', (e) => {
      const { participantId, existingPeers } = e.detail;
      this.participantId = participantId;

      // Clear join timeout and reset joining state
      if (this.joinTimeoutId) {
        clearTimeout(this.joinTimeoutId);
        this.joinTimeoutId = null;
      }
      this.isJoining = false;

      if (!this.webrtc) {
        this.webrtc = new WebRTCManager(this.signaling, { config: this.webrtcConfig });
        this.setupWebRTCHandlers();
      }

      const localStreamName = `${this.roomId}_${this.participantId}`;
      if (this.localStream) {
        this.webrtc.setLocalStream(this.localStream, localStreamName);
      }

      existingPeers.forEach(peer => {
        if (peer.streamName) {
          this.webrtc.consumeRemoteStream(peer.participantId, peer.streamName);
        }
      });
    });

    this.signaling.addEventListener('participant-joined', (e) => {
      const { participantId, streamName } = e.detail;
      if (this.webrtc && streamName) {
        this.webrtc.consumeRemoteStream(participantId, streamName);
      }
    });

    this.signaling.addEventListener('participant-left', (e) => {
      const { participantId } = e.detail;
      this.uiManager.removeVideoTile(participantId);
      if (this.webrtc) this.webrtc.closePeerConnection(participantId);
    });

    this.signaling.addEventListener('error', (e) => {
      const { message } = e.detail;
      console.error('[BreadCallApp] Server error:', message);

      // Reset joining state on any error during join process
      if (this.isJoining) {
        this.isJoining = false;
        if (this.joinTimeoutId) {
          clearTimeout(this.joinTimeoutId);
          this.joinTimeoutId = null;
        }
      }

      this.uiManager.showToast(message || 'Connection error', 'error');
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

    // P2P Signaling ignored in SFU mode
    /*
    this.signaling.addEventListener('offer', ...);
    this.signaling.addEventListener('answer', ...);
    this.signaling.addEventListener('ice-candidate', ...);
    */
  }

  async fetchWebRTCConfig() {
    try {
      const response = await fetch('/api/webrtc-config');
      if (!response.ok) throw new Error('Config unavailable');
      const data = await response.json();
      if (data.success) {
        this.webrtcConfig = data;
        return true;
      }
    } catch (err) {
      console.error('[BreadCallApp] Failed to fetch WebRTC config:', err);
      this.uiManager.showToast('SFU config failed', 'warning');
      this.webrtcConfig = null;
      return false;
    }
  }

  setupMediaHandlers() {
    this.mediaManager.addEventListener('stream-created', (e) => {
      this.localStream = e.detail.stream;
      const isTestMode = e.detail.testMode || false;
      const localStreamName = this.roomId && this.participantId ? `${this.roomId}_${this.participantId}` : null;
      if (this.webrtc && localStreamName) {
        this.webrtc.setLocalStream(this.localStream, localStreamName);
      }
      this.uiManager.addVideoTile(this.participantId || 'local', this.localStream, isTestMode ? 'You (Test Mode)' : 'You');
    });

    // Handle case when no media devices are found
    this.mediaManager.addEventListener('devices-not-found', (e) => {
      console.warn('[BreadCallApp] No media devices available:', e.detail.message);

      // Show dialog with options
      this.uiManager.showMediaNotFoundDialog(
        // Retry
        () => {
          this.mediaManager.getUserMedia().catch(() => {
            this.uiManager.showToast('Still no devices found', 'warning');
          });
        },
        // Continue without media
        () => {
          this.uiManager.showToast('Joined in view-only mode', 'info');
        },
        // Enable test mode
        () => {
          this.mediaManager.setTestMode(true);
          this.mediaManager.getUserMedia().catch(() => {
            this.uiManager.showToast('Test mode failed', 'error');
          });
        }
      );
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
      this.roomId = hash.split('/')[2]?.toUpperCase();
      this.uiManager.renderRoom(this.roomId);
      this.joinRoom(this.roomId);
    }
    // SoloView and DirectorView now self-initialize based on hash in their respective files
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
    // Prevent multiple concurrent join attempts
    if (this.isJoining) {
      console.log('[BreadCallApp] Already joining, ignoring duplicate request');
      return;
    }
    this.isJoining = true;

    // Clear any previous join timeout
    if (this.joinTimeoutId) {
      clearTimeout(this.joinTimeoutId);
      this.joinTimeoutId = null;
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

    // Connect to signaling server first
    if (!this.signaling.isConnected()) {
      // Wait for connection before sending join-room to prevent race condition
      const onConnected = () => {
        this.signaling.send('join-room', { roomId, name: 'User' });
      };

      this.signaling.addEventListener('connected', onConnected, { once: true });
      this.signaling.connect(wsUrl);
    } else {
      this.signaling.send('join-room', { roomId, name: 'User' });
    }

    // Try to get media, but don't block joining if it fails
    this.mediaManager.getUserMedia()
      .catch((error) => {
        // Media failure is handled by the devices-not-found event
        // User can still join in view-only mode
        console.warn('[BreadCallApp] Joining without media:', error.message);
      });

    // Set a timeout to handle connection failures
    this.joinTimeoutId = setTimeout(() => {
      if (!this.participantId) {
        this.uiManager.showToast('Failed to connect to signaling server', 'error');
        this.isJoining = false;
      }
    }, 10000);
  }

  leaveRoom() {
    // Clear any pending join timeout
    if (this.joinTimeoutId) {
      clearTimeout(this.joinTimeoutId);
      this.joinTimeoutId = null;
    }
    this.isJoining = false;

    if (this.signaling) {
      this.signaling.send('leave-room');
      this.signaling.disconnect();
    }
    if (this.webrtc) this.webrtc.cleanup();
    if (this.mediaManager) this.mediaManager.stop();
    this.roomId = null;
    this.participantId = null;
    this.hasConnected = false; // Reset for next room join
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

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

// Initialize app when DOM is ready (only for main room view, not director/solo views)
document.addEventListener('DOMContentLoaded', () => {
  const hash = window.location.hash;
  // Don't initialize main app for director, solo, or other special views
  if (hash.startsWith('#/director/') || hash.startsWith('#/view/')) {
    console.log('[BreadCallApp] Skipping initialization for special view:', hash);
    return;
  }
  window.app = new BreadCallApp();
});
