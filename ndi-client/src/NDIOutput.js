/**
 * NDIOutput - NDI SDK binding for outputting streams
 *
 * NOTE: This module requires the NewTek NDI SDK to be installed.
 * For production use, compile the native addon using node-gyp.
 *
 * Installation:
 * 1. Download NDI SDK from https://ndi.video/
 * 2. Install SDK and note the installation path
 * 3. Set NDI_SDK_DIR environment variable
 * 4. Run: npm run build-ndi (compiles native addon)
 *
 * This implementation provides a fallback mock mode when NDI SDK is not available.
 */

const { EventEmitter } = require('events');

// Try to load native NDI addon
let ndiAddon = null;
try {
  ndiAddon = require('./lib/ndi-native.node');
  console.log('[NDIOutput] NDI native addon loaded');
} catch (error) {
  console.warn('[NDIOutput] NDI native addon not available - running in mock mode');
  console.warn('[NDIOutput] To enable NDI output:');
  console.warn('[NDIOutput]   1. Install NewTek NDI SDK from https://ndi.video/');
  console.warn('[NDIOutput]   2. Build native addon: npm run build-ndi');
}

class NDIOutput extends EventEmitter {
  constructor() {
    super();
    this.sources = new Map(); // peerId -> { sendInstance, name }
    this.initialized = false;
    this.ndiAvailable = !!ndiAddon;

    if (this.ndiAvailable) {
      this.initialize();
    }
  }

  /**
   * Initialize NDI library
   */
  initialize() {
    try {
      if (ndiAddon && ndiAddon.initialize) {
        ndiAddon.initialize();
        this.initialized = true;
        console.log('[NDIOutput] NDI library initialized');
        this.emit('initialized');
      }
    } catch (error) {
      console.error('[NDIOutput] Failed to initialize NDI:', error.message);
      this.ndiAvailable = false;
    }
  }

  /**
   * Add a video source for NDI output
   * @param {string} peerId - Unique identifier for the source
   * @param {MediaStream} stream - WebRTC media stream
   */
  addSource(peerId, stream) {
    if (!this.ndiAvailable) {
      console.log('[NDIOutput] Mock: Adding source', peerId);
      this.sources.set(peerId, {
        name: `BreadCall - ${peerId}`,
        stream,
        mock: true
      });
      this.emit('source-added', { peerId, mock: true });
      return;
    }

    try {
      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];

      if (!videoTrack) {
        throw new Error('No video track in stream');
      }

      const sourceName = `BreadCall - ${peerId}`;

      // Create NDI send instance
      const sendSettings = {
        NDI12 name: sourceName,
        width: videoTrack.getSettings().width || 1920,
        height: videoTrack.getSettings().height || 1080,
        frameRateNumerator: videoTrack.getSettings().frameRate || 30,
        frameRateDenominator: 1
      };

      const sendInstance = ndiAddon.createSend(sendSettings);

      this.sources.set(peerId, {
        sendInstance,
        name: sourceName,
        stream,
        videoTrack,
        audioTrack
      });

      // Start sending frames
      this.startSending(peerId);

      console.log('[NDIOutput] Added NDI source:', sourceName);
      this.emit('source-added', { peerId, name: sourceName });
    } catch (error) {
      console.error('[NDIOutput] Failed to add source:', error.message);
      this.emit('error', { message: error.message, peerId });
    }
  }

  /**
   * Remove a video source
   * @param {string} peerId
   */
  removeSource(peerId) {
    const source = this.sources.get(peerId);
    if (!source) {
      console.warn('[NDIOutput] Source not found:', peerId);
      return;
    }

    if (source.mock) {
      console.log('[NDIOutput] Mock: Removing source', peerId);
      this.sources.delete(peerId);
      this.emit('source-removed', { peerId });
      return;
    }

    try {
      // Stop sending frames
      this.stopSending(peerId);

      // Destroy NDI send instance
      if (source.sendInstance && ndiAddon.destroySend) {
        ndiAddon.destroySend(source.sendInstance);
      }

      this.sources.delete(peerId);
      console.log('[NDIOutput] Removed NDI source:', peerId);
      this.emit('source-removed', { peerId });
    } catch (error) {
      console.error('[NDIOutput] Failed to remove source:', error.message);
    }
  }

  /**
   * Start sending frames to NDI
   * @param {string} peerId
   * @private
   */
  startSending(peerId) {
    const source = this.sources.get(peerId);
    if (!source || source.mock) return;

    const videoTrack = source.videoTrack;

    // Process video frames
    const processFrame = () => {
      if (!this.sources.has(peerId)) return;

      // In a real implementation, this would:
      // 1. Get raw frame data from the video track
      // 2. Convert to NDI video format
      // 3. Send via ndiAddon.sendVideo()

      // Mock: Log frame sending
      console.log('[NDIOutput] Mock: Sending frame for', peerId);

      source.frameInterval = setTimeout(processFrame, 33); // ~30fps
    };

    processFrame();

    // Process audio
    if (source.audioTrack) {
      // In a real implementation, this would:
      // 1. Get audio samples
      // 2. Convert to NDI audio format
      // 3. Send via ndiAddon.sendAudio()
    }
  }

  /**
   * Stop sending frames
   * @param {string} peerId
   * @private
   */
  stopSending(peerId) {
    const source = this.sources.get(peerId);
    if (source) {
      if (source.frameInterval) {
        clearTimeout(source.frameInterval);
      }
    }
  }

  /**
   * Get list of active NDI sources
   * @returns {Array}
   */
  getActiveSources() {
    return Array.from(this.sources.entries()).map(([peerId, source]) => ({
      peerId,
      name: source.name,
      mock: source.mock || false
    }));
  }

  /**
   * Check if NDI output is active
   * @returns {boolean}
   */
  isActive() {
    return this.ndiAvailable && this.initialized && this.sources.size > 0;
  }

  /**
   * Check if NDI SDK is available
   * @returns {boolean}
   */
  isAvailable() {
    return this.ndiAvailable;
  }

  /**
   * Cleanup all sources and NDI library
   */
  cleanup() {
    // Remove all sources
    for (const peerId of this.sources.keys()) {
      this.removeSource(peerId);
    }

    // Cleanup NDI library
    if (this.ndiAvailable && ndiAddon.cleanup) {
      ndiAddon.cleanup();
      this.initialized = false;
    }

    this.sources.clear();
    console.log('[NDIOutput] Cleanup complete');
  }
}

module.exports = { NDIOutput };
