import {NativeModules, Platform} from 'react-native';
import {EventEmitter} from 'react-native';

const {ScreenCaptureModule} = NativeModules;

/**
 * ScreenShareService - Handles screen sharing with system audio
 * Platform-specific implementation for Android and iOS
 */
class ScreenShareService extends EventEmitter {
  constructor() {
    super();
    this.isCapturing = false;
    this.stream = null;
  }

  /**
   * Start screen capture
   * @returns {Promise<MediaStream>}
   */
  async startCapture() {
    try {
      if (Platform.OS === 'android') {
        return await this._startAndroidCapture();
      } else if (Platform.OS === 'ios') {
        return await this._startIOSCapture();
      } else {
        throw new Error('Platform not supported');
      }
    } catch (error) {
      console.error('[ScreenShareService] Start capture error:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Android screen capture using MediaProjection
   * @private
   */
  async _startAndroidCapture() {
    return new Promise((resolve, reject) => {
      if (!ScreenCaptureModule) {
        reject(new Error('Native ScreenCaptureModule not available'));
        return;
      }

      // Request foreground service permission for Android 10+
      if (Platform.Version >= 29) {
        ScreenCaptureModule.requestForegroundServicePermission()
          .catch(err => console.warn('Foreground service permission error:', err));
      }

      // Start screen capture
      ScreenCaptureModule.startCapture({
        width: 1280,
        height: 720,
        frameRate: 30,
        captureAudio: true, // AudioPlaybackCapture API for system audio
        density: 320
      })
        .then((result) => {
          this.isCapturing = true;
          console.log('[ScreenShareService] Android capture started');
          this.emit('capture-started');

          // Create MediaStream from native result
          // The native module should return a stream ID or display ID
          this._createStreamFromNative(result)
            .then(resolve)
            .catch(reject);
        })
        .catch(reject);
    });
  }

  /**
   * iOS screen capture using ReplayKit Broadcast Upload Extension
   * @private
   */
  async _startIOSCapture() {
    return new Promise((resolve, reject) => {
      if (!ScreenCaptureModule) {
        reject(new Error('Native ScreenCaptureModule not available'));
        return;
      }

      // Start ReplayKit broadcast
      ScreenCaptureModule.startBroadcast({
        width: 1280,
        height: 720,
        frameRate: 30,
        captureAudio: true,
        bundleIdentifier: 'com.breadcall.BroadcastUploadExtension'
      })
        .then((result) => {
          this.isCapturing = true;
          console.log('[ScreenShareService] iOS capture started');
          this.emit('capture-started');

          // Create MediaStream from ReplayKit
          this._createStreamFromNative(result)
            .then(resolve)
            .catch(reject);
        })
        .catch(reject);
    });
  }

  /**
   * Create MediaStream from native module result
   * @private
   */
  async _createStreamFromNative(result) {
    // This would integrate with react-native-webrtc
    // to create a MediaStream from the native capture
    const {mediaDevices, MediaStream} = require('react-native-webrtc');

    // Get display media using the native stream ID
    const stream = await mediaDevices.getDisplayMedia({
      video: {
        width: {ideal: 1280},
        height: {ideal: 720},
        frameRate: {ideal: 30}
      },
      audio: true,
      streamId: result.streamId
    });

    this.stream = stream;
    return stream;
  }

  /**
   * Stop screen capture
   */
  stopCapture() {
    if (Platform.OS === 'android') {
      this._stopAndroidCapture();
    } else if (Platform.OS === 'ios') {
      this._stopIOSCapture();
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    this.isCapturing = false;
    this.emit('capture-stopped');
  }

  _stopAndroidCapture() {
    if (ScreenCaptureModule) {
      ScreenCaptureModule.stopCapture()
        .then(() => console.log('[ScreenShareService] Android capture stopped'))
        .catch(err => console.error('Stop capture error:', err));
    }
  }

  _stopIOSCapture() {
    if (ScreenCaptureModule) {
      ScreenCaptureModule.stopBroadcast()
        .then(() => console.log('[ScreenShareService] iOS capture stopped'))
        .catch(err => console.error('Stop broadcast error:', err));
    }
  }

  /**
   * Check if screen capture is supported
   * @returns {boolean}
   */
  isSupported() {
    if (Platform.OS === 'android') {
      return Platform.Version >= 21; // Android 5.0+
    } else if (Platform.OS === 'ios') {
      return Platform.Version >= 11; // iOS 11+
    }
    return false;
  }

  /**
   * Check if system audio capture is supported
   * @returns {boolean}
   */
  isAudioCaptureSupported() {
    if (Platform.OS === 'android') {
      return Platform.Version >= 29; // Android 10+ with AudioPlaybackCapture
    } else if (Platform.OS === 'ios') {
      return Platform.Version >= 14; // iOS 14+ with ReplayKit improvements
    }
    return false;
  }
}

export default new ScreenShareService();
