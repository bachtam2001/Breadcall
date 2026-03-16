/**
 * IframeAPI - postMessage API for OBS Browser Source integration
 * Allows OBS to communicate with embedded BreadCall pages
 */
class IframeAPI {
  constructor(targetOrigin = '*') {
    this.targetOrigin = targetOrigin;
    this.parentWindow = null;
    this.commandHandlers = {};
    this.eventListeners = [];

    this.init();
  }

  /**
   * Initialize iframe API
   */
  init() {
    // Only initialize if we're in an iframe
    if (window.self === window.top) {
      console.log('[IframeAPI] Not running in iframe, skipping initialization');
      return;
    }

    this.parentWindow = window.parent;

    // Bind the handler so we can remove it later
    this._messageHandler = (event) => {
      this.handleCommand(event);
    };

    // Listen for commands from parent
    window.addEventListener('message', this._messageHandler);

    console.log('[IframeAPI] Initialized');
  }

  /**
   * Destroy iframe API and cleanup listeners
   */
  destroy() {
    if (this._messageHandler) {
      window.removeEventListener('message', this._messageHandler);
      this._messageHandler = null;
    }
    this.parentWindow = null;
    this.commandHandlers = {};
    console.log('[IframeAPI] Destroyed');
  }

  /**
   * Handle incoming command
   * @param {MessageEvent} event
   */
  handleCommand(event) {
    const { type, command, payload } = event.data;

    if (type !== 'breadcall-command') return;

    console.log('[IframeAPI] Received command:', command, payload);

    const handler = this.commandHandlers[command];
    if (handler) {
      try {
        const result = handler(payload);
        this.sendEvent('command-result', { command, result, success: true });
      } catch (error) {
        this.sendEvent('command-result', { command, error: error.message, success: false });
      }
    } else {
      this.sendEvent('command-result', { command, error: 'Unknown command', success: false });
    }
  }

  /**
   * Register command handler
   * @param {string} command
   * @param {Function} handler
   */
  on(command, handler) {
    this.commandHandlers[command] = handler;
  }

  /**
   * Send event to parent window
   * @param {string} type - Event type
   * @param {Object} payload - Event data
   */
  sendEvent(type, payload) {
    if (!this.parentWindow) return;

    this.parentWindow.postMessage({
      type: 'breadcall-event',
      event: type,
      payload
    }, this.targetOrigin);
  }

  /**
   * Register event listener for parent communication
   * @param {string} event - Event type to listen for
   * @param {Function} callback
   */
  addEventListener(event, callback) {
    this.eventListeners.push({ event, callback });

    window.addEventListener('message', (e) => {
      if (e.data.type === 'breadcall-event' && e.data.event === event) {
        callback(e.data.payload);
      }
    });
  }
}

/**
 * IframeController - Controller for embedding BreadCall in OBS
 * Used by the parent window (OBS browser source)
 */
class IframeController {
  constructor(iframe) {
    this.iframe = iframe;
    this.iframeWindow = iframe?.contentWindow;
    this.eventListeners = new Map();

    this.init();
  }

  /**
   * Initialize controller
   */
  init() {
    window.addEventListener('message', (event) => {
      if (event.source !== this.iframeWindow) return;

      const { type, event: eventType, payload } = event.data;

      if (type === 'breadcall-event') {
        this.handleEvent(eventType, payload);
      }
    });
  }

  /**
   * Handle event from iframe
   * @param {string} event - Event type
   * @param {Object} payload - Event data
   */
  handleEvent(event, payload) {
    const listeners = this.eventListeners.get(event) || [];
    listeners.forEach(callback => callback(payload));
  }

  /**
   * Send command to iframe
   * @param {string} command - Command name
   * @param {Object} payload - Command data
   * @returns {Promise<any>}
   */
  sendCommand(command, payload = {}) {
    return new Promise((resolve, reject) => {
      const requestId = Date.now();

      const responseHandler = (event) => {
        if (event.source !== this.iframeWindow) return;
        if (event.data.type !== 'breadcall-command-result') return;
        if (event.data.command !== command) return;

        window.removeEventListener('message', responseHandler);

        if (event.data.success) {
          resolve(event.data.result);
        } else {
          reject(new Error(event.data.error));
        }
      };

      window.addEventListener('message', responseHandler);

      this.iframeWindow.postMessage({
        type: 'breadcall-command',
        command,
        payload,
        requestId
      }, '*');

      // Timeout after 5 seconds
      setTimeout(() => {
        window.removeEventListener('message', responseHandler);
        reject(new Error('Command timeout'));
      }, 5000);
    });
  }

  /**
   * Listen for events from iframe
   * @param {string} event - Event type
   * @param {Function} callback
   */
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }

  /**
   * Available commands
   */

  /**
   * Get current stream stats
   * @returns {Promise<Object>}
   */
  async getStats() {
    return this.sendCommand('getStats');
  }

  /**
   * Mute/unmute audio
   * @param {boolean} muted
   */
  async setMuted(muted) {
    return this.sendCommand('setMuted', { muted });
  }

  /**
   * Set volume (0-100)
   * @param {number} volume
   */
  async setVolume(volume) {
    return this.sendCommand('setVolume', { volume });
  }

  /**
   * Set quality preset
   * @param {string} quality - sd, hd, fhd
   */
  async setQuality(quality) {
    return this.sendCommand('setQuality', { quality });
  }

  /**
   * Reload the stream
   */
  async reload() {
    return this.sendCommand('reload');
  }
}

// Export for use
window.IframeAPI = IframeAPI;
window.IframeController = IframeController;

// Auto-init IframeAPI if in iframe
if (typeof window !== 'undefined' && window.self !== window.top) {
  window.iframeAPI = new IframeAPI();

  // Register default command handlers
  window.iframeAPI.on('getStats', async () => {
    if (window.soloView) {
      return await window.soloView.getStats();
    }
    return null;
  });

  window.iframeAPI.on('reload', () => {
    window.location.reload();
  });
}
