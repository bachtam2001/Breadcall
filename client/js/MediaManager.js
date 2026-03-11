/**
 * MediaManager - Handles media devices and stream management
 */
class MediaManager extends EventTarget {
  constructor() {
    super();
    this.localStream = null;
    this.audioTrack = null;
    this.videoTrack = null;
    this.devices = {
      cameras: [],
      microphones: [],
      speakers: []
    };
    this.audioContext = null;
    this.analyser = null;
    this.audioLevelInterval = null;
    // Test mode for environments without media devices
    this.testMode = window.location.search.includes('testMode=true') ||
                    window.location.search.includes('testmode=true');
  }

  /**
   * Create a fake media stream for testing
   * Generates a canvas with animated content as a video source
   * @returns {MediaStream} Fake media stream
   */
  createTestStream() {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');

    // Draw animated test pattern
    let frame = 0;
    const draw = () => {
      if (!canvas) return;
      frame++;
      // Gradient background
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, `hsl(${frame % 360}, 70%, 50%)`);
      gradient.addColorStop(1, `hsl(${(frame + 180) % 360}, 70%, 50%)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw text
      ctx.fillStyle = 'white';
      ctx.font = 'bold 24px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('TEST MODE', canvas.width / 2, canvas.height / 2 - 20);
      ctx.fillText(`Frame: ${frame}`, canvas.width / 2, canvas.height / 2 + 20);

      // Draw bouncing circle
      const circleX = (canvas.width / 2) + Math.sin(frame * 0.05) * 150;
      const circleY = (canvas.height / 2) + Math.cos(frame * 0.08) * 100;
      ctx.beginPath();
      ctx.arc(circleX, circleY, 30, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.fill();

      requestAnimationFrame(draw);
    };
    draw();

    const stream = canvas.captureStream(30); // 30 FPS
    return stream;
  }

  /**
   * Get user media with default constraints
   * @param {Object} constraints - Media constraints
   * @param {boolean} allowTestMode - Whether to use test stream if available
   * @returns {Promise<MediaStream>}
   */
  async getUserMedia(constraints = {}, allowTestMode = true) {
    // Test mode: use fake stream
    if (allowTestMode && this.testMode) {
      console.log('[MediaManager] Using test mode - creating fake media stream');
      const stream = this.createTestStream();
      this.localStream = stream;
      this.audioTrack = stream.getAudioTracks()[0] || null;
      this.videoTrack = stream.getVideoTracks()[0];

      this.dispatchEvent(new CustomEvent('stream-created', { detail: { stream, testMode: true } }));
      return stream;
    }

    const defaultConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      }
    };

    const mergedConstraints = { ...defaultConstraints, ...constraints };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(mergedConstraints);
      this.localStream = stream;
      this.audioTrack = stream.getAudioTracks()[0];
      this.videoTrack = stream.getVideoTracks()[0];

      this.setupAudioLevelMonitor(stream);

      this.dispatchEvent(new CustomEvent('stream-created', { detail: { stream, testMode: false } }));
      return stream;
    } catch (error) {
      console.error('[MediaManager] getUserMedia error:', error);
      this.dispatchEvent(new CustomEvent('error', { detail: error }));

      // If we failed and test mode is allowed, offer fallback
      if (allowTestMode && error.name === 'NotFoundError') {
        console.log('[MediaManager] No devices found - consider using ?testMode=true URL parameter');
        this.dispatchEvent(new CustomEvent('devices-not-found', {
          detail: {
            message: 'No media devices found. Add ?testMode=true to URL for testing.',
            error
          }
        }));
      }

      throw error;
    }
  }

  /**
   * Enable or disable test mode
   * @param {boolean} enabled
   */
  setTestMode(enabled) {
    this.testMode = enabled;
    console.log('[MediaManager] Test mode:', enabled ? 'ON' : 'OFF');
  }

  /**
   * Get display media for screen sharing
   * @param {Object} options - Display media options
   * @returns {Promise<MediaStream>}
   */
  async getDisplayMedia(options = {}) {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: options.includeAudio || false,
        ...options
      });

      this.dispatchEvent(new CustomEvent('display-stream-created', { detail: { stream } }));
      return stream;
    } catch (error) {
      console.error('[MediaManager] getDisplayMedia error:', error);
      this.dispatchEvent(new CustomEvent('error', { detail: error }));
      throw error;
    }
  }

  /**
   * Enumerate all media devices
   * @returns {Promise<Object>}
   */
  async enumerateDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();

      this.devices = {
        cameras: devices.filter(d => d.kind === 'videoinput'),
        microphones: devices.filter(d => d.kind === 'audioinput'),
        speakers: devices.filter(d => d.kind === 'audiooutput')
      };

      this.dispatchEvent(new CustomEvent('devices-enumerated', { detail: this.devices }));
      return this.devices;
    } catch (error) {
      console.error('[MediaManager] enumerateDevices error:', error);
      throw error;
    }
  }

  /**
   * Switch camera to specified device
   * @param {string} deviceId - Camera device ID
   * @returns {Promise<void>}
   */
  async switchCamera(deviceId) {
    if (!this.localStream) {
      throw new Error('No local stream available');
    }

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } },
        audio: false
      });

      const newVideoTrack = newStream.getVideoTracks()[0];
      const oldVideoTrack = this.videoTrack;

      // Replace track in local stream
      this.localStream.removeTrack(oldVideoTrack);
      this.localStream.addTrack(newVideoTrack);
      this.videoTrack = newVideoTrack;

      // Stop old track
      oldVideoTrack.stop();

      // Stop new stream (we only need the track)
      newStream.getTracks().forEach(t => {
        if (t !== newVideoTrack) t.stop();
      });

      this.dispatchEvent(new CustomEvent('camera-switched', { detail: { deviceId, track: newVideoTrack } }));
    } catch (error) {
      console.error('[MediaManager] switchCamera error:', error);
      throw error;
    }
  }

  /**
   * Switch microphone to specified device
   * @param {string} deviceId - Microphone device ID
   * @returns {Promise<void>}
   */
  async switchMicrophone(deviceId) {
    if (!this.localStream) {
      throw new Error('No local stream available');
    }

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
        video: false
      });

      const newAudioTrack = newStream.getAudioTracks()[0];
      const oldAudioTrack = this.audioTrack;

      // Replace track in local stream
      this.localStream.removeTrack(oldAudioTrack);
      this.localStream.addTrack(newAudioTrack);
      this.audioTrack = newAudioTrack;

      // Stop old track
      oldAudioTrack.stop();

      // Stop new stream
      newStream.getTracks().forEach(t => {
        if (t !== newAudioTrack) t.stop();
      });

      this.dispatchEvent(new CustomEvent('microphone-switched', { detail: { deviceId, track: newAudioTrack } }));
    } catch (error) {
      console.error('[MediaManager] switchMicrophone error:', error);
      throw error;
    }
  }

  /**
   * Toggle mute state
   * @returns {boolean} New muted state
   */
  toggleMute() {
    if (!this.audioTrack) return false;

    const newState = !this.audioTrack.enabled;
    this.audioTrack.enabled = newState;

    this.dispatchEvent(new CustomEvent('mute-changed', {
      detail: { isMuted: !newState, kind: 'audio' }
    }));

    return !newState;
  }

  /**
   * Toggle video state
   * @returns {boolean} New video off state
   */
  toggleVideo() {
    if (!this.videoTrack) return false;

    const newState = !this.videoTrack.enabled;
    this.videoTrack.enabled = newState;

    this.dispatchEvent(new CustomEvent('mute-changed', {
      detail: { isVideoOff: !newState, kind: 'video' }
    }));

    return !newState;
  }

  /**
   * Set mute state
   * @param {boolean} muted
   */
  setMuted(muted) {
    if (this.audioTrack) {
      this.audioTrack.enabled = !muted;
      this.dispatchEvent(new CustomEvent('mute-changed', {
        detail: { isMuted: muted, kind: 'audio' }
      }));
    }
  }

  /**
   * Set video state
   * @param {boolean} videoOff
   */
  setVideoOff(videoOff) {
    if (this.videoTrack) {
      this.videoTrack.enabled = !videoOff;
      this.dispatchEvent(new CustomEvent('mute-changed', {
        detail: { isVideoOff: videoOff, kind: 'video' }
      }));
    }
  }

  /**
   * Setup audio level monitoring
   * @param {MediaStream} stream
   */
  setupAudioLevelMonitor(stream) {
    this.stopAudioLevelMonitor();

    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.5;

      const source = this.audioContext.createMediaStreamSource(stream);
      source.connect(this.analyser);

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      const checkLevel = () => {
        if (!this.analyser) return;

        this.analyser.getByteFrequencyData(dataArray);

        // Calculate RMS
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length);

        // Normalize to 0-100
        const level = Math.min(100, (rms / 255) * 100);

        this.dispatchEvent(new CustomEvent('audio-level', { detail: { level } }));

        this.audioLevelInterval = requestAnimationFrame(checkLevel);
      };

      checkLevel();
    } catch (error) {
      console.warn('[MediaManager] Audio level monitor setup failed:', error);
    }
  }

  /**
   * Stop audio level monitoring
   */
  stopAudioLevelMonitor() {
    if (this.audioLevelInterval) {
      cancelAnimationFrame(this.audioLevelInterval);
      this.audioLevelInterval = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
      this.analyser = null;
    }
  }

  /**
   * Get current audio level
   * @returns {number} Audio level 0-100
   */
  getAudioLevel() {
    if (!this.analyser) return 0;

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    return Math.sqrt(sum / dataArray.length);
  }

  /**
   * Stop all tracks and cleanup
   */
  stop() {
    this.stopAudioLevelMonitor();

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
      this.audioTrack = null;
      this.videoTrack = null;
    }

    this.dispatchEvent(new CustomEvent('stream-stopped'));
  }

  /**
   * Check if camera is active
   * @returns {boolean}
   */
  isVideoEnabled() {
    return this.videoTrack?.enabled ?? false;
  }

  /**
   * Check if microphone is active
   * @returns {boolean}
   */
  isAudioEnabled() {
    return this.audioTrack?.enabled ?? false;
  }

  /**
   * Get current camera device ID
   * @returns {string|null}
   */
  getCurrentCameraId() {
    return this.videoTrack?.getSettings()?.deviceId || null;
  }

  /**
   * Get current microphone device ID
   * @returns {string|null}
   */
  getCurrentMicrophoneId() {
    return this.audioTrack?.getSettings()?.deviceId || null;
  }
}

// Export for use
window.MediaManager = MediaManager;
