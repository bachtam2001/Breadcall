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
    this.omeConfig = null; // Store OME configuration

    this.init();
  }

  async init() {
    const configLoaded = await this.fetchOmeConfig();
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
      this.uiManager.showToast('Connected to server', 'success');
    });

    this.signaling.addEventListener('joined-room', (e) => {
      const { participantId, existingPeers } = e.detail;
      this.participantId = participantId;

      if (!this.webrtc) {
        this.webrtc = new WebRTCManager(this.signaling, { omeConfig: this.omeConfig });
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

  async fetchOmeConfig() {
    try {
      const response = await fetch('/api/ome-config');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      if (data.success) {
        this.omeConfig = data;
        console.log('[BreadCallApp] OME Config loaded:', this.omeConfig);
        return true;
      } else {
        throw new Error('Invalid response format');
      }
    } catch (err) {
      console.error('[BreadCallApp] Failed to fetch OME config:', err);
      this.uiManager.showToast('SFU config failed, fallback to P2P might occur', 'warning');
      this.omeConfig = null; // Ensure config is null on failure
      return false;
    }
  }

  setupMediaHandlers() {
    this.mediaManager.addEventListener('stream-created', (e) => {
      this.localStream = e.detail.stream;
      const localStreamName = this.roomId && this.participantId ? `${this.roomId}_${this.participantId}` : null;
      if (this.webrtc && localStreamName) {
        this.webrtc.setLocalStream(this.localStream, localStreamName);
      }
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
    try {
      await this.mediaManager.getUserMedia();
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

      // Wait for connection before sending join-room to prevent race condition
      const onConnected = () => {
        this.signaling.send('join-room', { roomId, name: 'User' });
      };

      this.signaling.addEventListener('connected', onConnected, { once: true });
      this.signaling.connect(wsUrl);

      // Set a timeout to handle connection failures
      setTimeout(() => {
        if (!this.participantId) {
          this.uiManager.showToast('Failed to connect to signaling server', 'error');
        }
      }, 10000);
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
