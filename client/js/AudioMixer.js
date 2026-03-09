/**
 * AudioMixer - Multi-source audio mixing with effects
 * Provides EQ, compressor, and gain control for multiple audio sources
 */
class AudioMixer {
  constructor() {
    this.audioContext = null;
    this.sources = new Map(); // sourceId -> { mediaStream, gainNode, eqNodes, compressor }
    this.masterGain = null;
    this.compressor = null;
    this.analyser = null;
    this.destination = null;
    this.initialized = false;
  }

  /**
   * Initialize audio context and master chain
   */
  async initialize() {
    if (this.initialized) return;

    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // Master gain
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 1.0;

    // Master compressor
    this.compressor = this.audioContext.createDynamicsCompressor();
    this.compressor.threshold.value = -24;
    this.compressor.knee.value = 30;
    this.compressor.ratio.value = 12;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.25;

    // Analyser for visualization
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;

    // Connect master chain
    this.masterGain.connect(this.compressor);
    this.compressor.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);

    this.destination = this.audioContext.createMediaStreamDestination();
    this.analyser.connect(this.destination);

    this.initialized = true;
    console.log('[AudioMixer] Initialized');
  }

  /**
   * Add audio source to mixer
   * @param {string} sourceId - Unique source identifier
   * @param {MediaStream} stream - Audio stream to add
   * @returns {Object} - Source control object
   */
  addSource(sourceId, stream) {
    if (!this.initialized) {
      throw new Error('AudioMixer not initialized');
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) {
      console.warn(`[AudioMixer] No audio track in stream for ${sourceId}`);
      return null;
    }

    const source = this.audioContext.createMediaStreamSource(stream);

    // Gain node for volume control
    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = 1.0;

    // 3-band EQ
    const lowEQ = this.audioContext.createBiquadFilter();
    lowEQ.type = 'lowshelf';
    lowEQ.frequency.value = 320;
    lowEQ.gain.value = 0;

    const midEQ = this.audioContext.createBiquadFilter();
    midEQ.type = 'peaking';
    midEQ.frequency.value = 1000;
    midEQ.Q.value = 0.5;
    midEQ.gain.value = 0;

    const highEQ = this.audioContext.createBiquadFilter();
    highEQ.type = 'highshelf';
    highEQ.frequency.value = 3200;
    highEQ.gain.value = 0;

    // High-pass filter to remove rumble
    const highPass = this.audioContext.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = 80;

    // Connect chain: source -> highpass -> lowEQ -> midEQ -> highEQ -> gain -> master
    source.connect(highPass);
    highPass.connect(lowEQ);
    lowEQ.connect(midEQ);
    midEQ.connect(highEQ);
    highEQ.connect(gainNode);
    gainNode.connect(this.masterGain);

    const sourceData = {
      source,
      gainNode,
      eqNodes: { lowEQ, midEQ, highEQ },
      highPass,
      stream,
      muted: false,
      solo: false
    };

    this.sources.set(sourceId, sourceData);
    console.log(`[AudioMixer] Added source: ${sourceId}`);

    return {
      setVolume: (vol) => this.setVolume(sourceId, vol),
      setEQ: (band, value) => this.setEQ(sourceId, band, value),
      mute: () => this.mute(sourceId),
      unmute: () => this.unmute(sourceId),
      solo: () => this.solo(sourceId),
      remove: () => this.removeSource(sourceId)
    };
  }

  /**
   * Remove audio source from mixer
   * @param {string} sourceId - Source identifier
   */
  removeSource(sourceId) {
    const sourceData = this.sources.get(sourceId);
    if (sourceData) {
      sourceData.source.disconnect();
      sourceData.gainNode.disconnect();
      sourceData.eqNodes.lowEQ.disconnect();
      sourceData.eqNodes.midEQ.disconnect();
      sourceData.eqNodes.highEQ.disconnect();
      sourceData.highPass.disconnect();
      this.sources.delete(sourceId);
      console.log(`[AudioMixer] Removed source: ${sourceId}`);
    }
  }

  /**
   * Set source volume
   * @param {string} sourceId - Source identifier
   * @param {number} volume - Volume 0-1
   */
  setVolume(sourceId, volume) {
    const sourceData = this.sources.get(sourceId);
    if (sourceData) {
      sourceData.gainNode.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  /**
   * Set EQ band for source
   * @param {string} sourceId - Source identifier
   * @param {string} band - 'low', 'mid', or 'high'
   * @param {number} value - Gain in dB (-12 to +12)
   */
  setEQ(sourceId, band, value) {
    const sourceData = this.sources.get(sourceId);
    if (sourceData) {
      const clampedValue = Math.max(-12, Math.min(12, value));
      switch (band) {
        case 'low':
          sourceData.eqNodes.lowEQ.gain.value = clampedValue;
          break;
        case 'mid':
          sourceData.eqNodes.midEQ.gain.value = clampedValue;
          break;
        case 'high':
          sourceData.eqNodes.highEQ.gain.value = clampedValue;
          break;
      }
    }
  }

  /**
   * Mute source
   * @param {string} sourceId - Source identifier
   */
  mute(sourceId) {
    const sourceData = this.sources.get(sourceId);
    if (sourceData) {
      sourceData.muted = true;
      sourceData._previousGain = sourceData.gainNode.gain.value;
      sourceData.gainNode.gain.value = 0;
    }
  }

  /**
   * Unmute source
   * @param {string} sourceId - Source identifier
   */
  unmute(sourceId) {
    const sourceData = this.sources.get(sourceId);
    if (sourceData) {
      sourceData.muted = false;
      if (sourceData._previousGain !== undefined) {
        sourceData.gainNode.gain.value = sourceData._previousGain;
      }
    }
  }

  /**
   * Solo source (mute all others)
   * @param {string} sourceId - Source identifier
   */
  solo(sourceId) {
    this.sources.forEach((data, id) => {
      if (id === sourceId) {
        data.solo = true;
        if (data._previousGain !== undefined) {
          data.gainNode.gain.value = data._previousGain;
        }
      } else {
        data._previousGain = data.gainNode.gain.value;
        data.gainNode.gain.value = 0;
      }
    });
  }

  /**
   * Unsolo all sources
   */
  unsoloAll() {
    this.sources.forEach((data) => {
      data.solo = false;
      if (data._previousGain !== undefined && !data.muted) {
        data.gainNode.gain.value = data._previousGain;
      }
    });
  }

  /**
   * Set master volume
   * @param {number} volume - Volume 0-1
   */
  setMasterVolume(volume) {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  /**
   * Get analyser for visualization
   * @returns {AnalyserNode}
   */
  getAnalyser() {
    return this.analyser;
  }

  /**
   * Get mixed audio output stream
   * @returns {MediaStream}
   */
  getOutputStream() {
    return this.destination.stream;
  }

  /**
   * Get audio level for source (0-1)
   * @param {string} sourceId - Source identifier
   * @returns {number}
   */
  getAudioLevel(sourceId) {
    // Would need individual analyser per source for accurate levels
    // This is a simplified version
    return 0;
  }

  /**
   * Apply preset EQ curve
   * @param {string} preset - 'flat', 'bright', 'warm', 'radio', 'phone'
   */
  applyPreset(sourceId, preset) {
    const presets = {
      flat: { low: 0, mid: 0, high: 0 },
      bright: { low: -2, mid: 2, high: 6 },
      warm: { low: 4, mid: 2, high: -2 },
      radio: { low: -4, mid: 4, high: 6 },
      phone: { low: -8, mid: 8, high: -4, highPass: 300 }
    };

    const values = presets[preset];
    if (values) {
      this.setEQ(sourceId, 'low', values.low);
      this.setEQ(sourceId, 'mid', values.mid);
      this.setEQ(sourceId, 'high', values.high);

      const sourceData = this.sources.get(sourceId);
      if (values.highPass && sourceData) {
        sourceData.highPass.frequency.value = values.highPass;
      }
    }
  }

  /**
   * Cleanup and disconnect
   */
  cleanup() {
    this.sources.forEach((data, id) => {
      this.removeSource(id);
    });

    if (this.masterGain) this.masterGain.disconnect();
    if (this.compressor) this.compressor.disconnect();
    if (this.analyser) this.analyser.disconnect();
    if (this.audioContext) {
      this.audioContext.close();
    }

    this.initialized = false;
  }
}

module.exports = { AudioMixer };
