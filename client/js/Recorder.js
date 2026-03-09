/**
 * Recorder - Local recording using MediaRecorder API
 * Records WebRTC streams to WebM/MP4 format
 */
class Recorder extends EventEmitter {
  constructor() {
    super();
    this.mediaRecorder = null;
    this.chunks = [];
    this.isRecording = false;
    this.currentStream = null;
    this.recordingOptions = {
      mimeType: this.getSupportedMimeType(),
      videoBitsPerSecond: 2500000 // 2.5 Mbps
    };
  }

  /**
   * Get supported MIME type for recording
   * @returns {string}
   */
  getSupportedMimeType() {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm'
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return 'video/webm';
  }

  /**
   * Start recording a stream
   * @param {MediaStream} stream - Stream to record
   * @param {Object} options - Recording options
   */
  startRecording(stream, options = {}) {
    if (this.isRecording) {
      console.error('[Recorder] Already recording');
      return;
    }

    this.currentStream = stream;
    this.chunks = [];

    const config = { ...this.recordingOptions, ...options };

    try {
      this.mediaRecorder = new MediaRecorder(stream, config);
    } catch (error) {
      console.warn('[Recorder] Could not create MediaRecorder with config, trying default:', error);
      this.mediaRecorder = new MediaRecorder(stream);
    }

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };

    this.mediaRecorder.onstop = () => {
      console.log('[Recorder] Recording stopped');
      this.isRecording = false;
      this.emit('stop', { chunks: this.chunks });
    };

    this.mediaRecorder.onerror = (event) => {
      console.error('[Recorder] Recording error:', event.error);
      this.emit('error', event.error);
    };

    this.mediaRecorder.onstart = () => {
      console.log('[Recorder] Recording started');
      this.isRecording = true;
      this.emit('start');
    };

    // Start recording with timeslice for periodic data availability
    this.mediaRecorder.start(1000); // 1 second intervals
  }

  /**
   * Stop recording
   * @returns {Promise<Blob>}
   */
  stopRecording() {
    return new Promise((resolve, reject) => {
      if (!this.isRecording) {
        reject(new Error('Not recording'));
        return;
      }

      this.mediaRecorder.onstop = () => {
        this.isRecording = false;
        const blob = new Blob(this.chunks, { type: this.recordingOptions.mimeType });
        resolve(blob);
        this.emit('stop', { blob });
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * Pause recording
   */
  pauseRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
      this.emit('pause');
    }
  }

  /**
   * Resume recording
   */
  resumeRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
      this.emit('resume');
    }
  }

  /**
   * Download recorded blob
   * @param {Blob} blob - Recorded video blob
   * @param {string} filename - Output filename
   */
  download(blob, filename = 'recording.webm') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Save recorded blob to file system (requires File System Access API)
   * @param {Blob} blob - Recorded video blob
   * @returns {Promise}
   */
  async saveToFile(blob) {
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: 'recording.webm',
          types: [{
            description: 'Video File',
            accept: { 'video/webm': ['.webm'] }
          }]
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        console.log('[Recorder] File saved successfully');
        return true;
      } catch (error) {
        console.error('[Recorder] Save failed:', error);
        return false;
      }
    } else {
      // Fallback to download
      this.download(blob);
      return true;
    }
  }

  /**
   * Get recording state
   * @returns {boolean}
   */
  isRecording() {
    return this.isRecording;
  }

  /**
   * Get current recording duration
   * @returns {number} - Duration in seconds
   */
  getDuration() {
    // Would need to track start time for accurate duration
    return 0;
  }

  /**
   * Cleanup
   */
  cleanup() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
    }
    this.mediaRecorder = null;
    this.chunks = [];
    this.currentStream = null;
  }
}

module.exports = { Recorder };
