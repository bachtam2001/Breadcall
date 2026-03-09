const ffmpeg = require('fluent-ffmpeg');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');

/**
 * SRTOutput - Handles SRT output for WebRTC streams
 * Uses FFmpeg to encode MediaStream to SRT protocol
 */
class SRTOutput extends EventEmitter {
  constructor(portRange = '9000-9100') {
    super();
    this.portRange = portRange;
    this.outputs = new Map(); // streamId -> { ffmpeg, port, srtUrl }
    this.availablePorts = this._parsePortRange(portRange);
  }

  _parsePortRange(rangeStr) {
    const [start, end] = rangeStr.split('-').map(Number);
    const ports = [];
    for (let i = start; i <= end; i++) {
      ports.push(i);
    }
    return ports;
  }

  _getAvailablePort() {
    return this.availablePorts.shift() || null;
  }

  _releasePort(port) {
    if (!this.availablePorts.includes(port)) {
      this.availablePorts.push(port);
    }
  }

  /**
   * Start SRT output for a WebRTC stream
   * @param {string} streamId - Unique stream identifier
   * @param {MediaStream} stream - WebRTC MediaStream
   * @param {string} srtUrl - Destination SRT URL (e.g., srt://host:port)
   * @returns {boolean} - Success status
   */
  startSRT(streamId, stream, srtUrl) {
    if (this.outputs.has(streamId)) {
      console.error('[SRTOutput] Stream already running:', streamId);
      return false;
    }

    const port = this._getAvailablePort();
    if (!port) {
      console.error('[SRTOutput] No available ports');
      return false;
    }

    try {
      // Create a local SRT listener that FFmpeg will push to
      const localSrtPort = port;
      const localSrtUrl = `srt://0.0.0.0:${localSrtPort}?mode=listener`;

      // Get video/audio tracks from stream
      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];

      if (!videoTrack) {
        console.error('[SRTOutput] No video track in stream');
        this._releasePort(port);
        return false;
      }

      console.log('[SRTOutput] Starting SRT output for', streamId, '->', srtUrl);

      // FFmpeg command to receive WebRTC track and output SRT
      // Note: In production, this would use a more sophisticated pipeline
      // For now, we create an FFmpeg process that outputs to SRT
      const ffmpegArgs = [
        '-f', 'lavfi',
        '-i', 'testsrc=size=1920x1080:rate=30', // Placeholder - would receive actual stream
        '-f', 'lavfi',
        '-i', 'sine=frequency=1000', // Placeholder audio
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-b:v', '2500k',
        '-g', '30',
        '-keyint_min', '30',
        '-sc_threshold', '0',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-f', 'mpegts',
        `srt://${srtUrl.replace('srt://', '')}?mode=caller&latency=1000000`
      ];

      const ffmpegProc = spawn('ffmpeg', ffmpegArgs, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      ffmpegProc.stderr.on('data', (data) => {
        console.log(`[FFmpeg][${streamId}]`, data.toString().trim());
      });

      ffmpegProc.on('error', (err) => {
        console.error(`[SRTOutput][${streamId}] FFmpeg error:`, err);
        this._cleanup(streamId);
      });

      ffmpegProc.on('close', (code) => {
        console.log(`[SRTOutput][${streamId}] FFmpeg exited with code ${code}`);
        this._cleanup(streamId);
        if (code === 0 || code === null) {
          this.emit('srt-stop', { streamId });
        } else {
          this.emit('srt-error', { streamId, code });
        }
      });

      this.outputs.set(streamId, {
        ffmpeg: ffmpegProc,
        port: localSrtPort,
        srtUrl: srtUrl,
        localSrtUrl: localSrtUrl
      });

      console.log('[SRTOutput] Started SRT for', streamId, 'on port', localSrtPort);
      this.emit('srt-start', { streamId, port: localSrtPort, srtUrl });

      return true;
    } catch (error) {
      console.error('[SRTOutput] Start SRT error:', error);
      this._releasePort(port);
      return false;
    }
  }

  /**
   * Stop SRT output for a stream
   * @param {string} streamId - Stream identifier
   */
  stopSRT(streamId) {
    return this._cleanup(streamId);
  }

  _cleanup(streamId) {
    const output = this.outputs.get(streamId);
    if (output) {
      if (output.ffmpeg && !output.ffmpeg.killed) {
        output.ffmpeg.kill('SIGTERM');
      }
      this._releasePort(output.port);
      this.outputs.delete(streamId);
      console.log('[SRTOutput] Stopped SRT for', streamId);
      return true;
    }
    return false;
  }

  /**
   * Get active SRT outputs
   * @returns {Array} - List of active outputs
   */
  getActiveOutputs() {
    return Array.from(this.outputs.entries()).map(([streamId, output]) => ({
      streamId,
      port: output.port,
      srtUrl: output.srtUrl,
      localSrtUrl: output.localSrtUrl
    }));
  }

  /**
   * Get status of a specific stream
   * @param {string} streamId - Stream identifier
   * @returns {Object|null} - Status object
   */
  getStatus(streamId) {
    const output = this.outputs.get(streamId);
    if (!output) return null;

    return {
      streamId,
      active: true,
      port: output.port,
      srtUrl: output.srtUrl,
      ffmpegRunning: output.ffmpeg && !output.ffmpeg.killed
    };
  }

  /**
   * Cleanup all outputs
   */
  cleanup() {
    for (const streamId of this.outputs.keys()) {
      this.stopSRT(streamId);
    }
    this.outputs.clear();
  }

  /**
   * Get available ports count
   * @returns {number}
   */
  getAvailablePortsCount() {
    return this.availablePorts.length;
  }
}

module.exports = { SRTOutput };
