/**
 * TallyLight - On-air/preview indicators for broadcast workflows
 * Visual indicators showing which stream is live or in preview
 */
class TallyLight {
  constructor() {
    this.states = new Map(); // streamId -> { isLive, isPreview, isRecording }
    this.elements = new Map(); // streamId -> element references
    this.config = {
      colors: {
        live: '#ff0000',
        preview: '#00ff00',
        recording: '#ffaa00',
        inactive: '#333333'
      },
      flashInterval: 500, // ms for flash effect
      transitionDuration: 200 // ms for smooth transitions
    };
  }

  /**
   * Initialize tally light for a stream
   * @param {string} streamId - Stream identifier
   * @param {HTMLElement} container - Container element
   * @returns {HTMLElement} - Tally light element
   */
  init(streamId, container) {
    const tallyEl = document.createElement('div');
    tallyEl.className = 'tally-light';
    tallyEl.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background-color: ${this.config.colors.inactive};
      transition: background-color ${this.config.transitionDuration}ms;
      z-index: 100;
    `;

    const labelEl = document.createElement('span');
    labelEl.className = 'tally-label';
    labelEl.style.cssText = `
      position: absolute;
      top: 6px;
      left: 8px;
      font-size: 10px;
      font-weight: bold;
      color: white;
      text-transform: uppercase;
      opacity: 0;
      transition: opacity ${this.config.transitionDuration}ms;
    `;

    container.style.position = 'relative';
    container.appendChild(tallyEl);
    container.appendChild(labelEl);

    this.elements.set(streamId, { tally: tallyEl, label: labelEl, container });
    this.states.set(streamId, { isLive: false, isPreview: false, isRecording: false });

    return tallyEl;
  }

  /**
   * Set stream as live (on-air)
   * @param {string} streamId - Stream identifier
   * @param {boolean} isLive - Live status
   */
  setLive(streamId, isLive) {
    const state = this.states.get(streamId);
    const elements = this.elements.get(streamId);

    if (state && elements) {
      state.isLive = isLive;
      this._updateDisplay(streamId);

      if (isLive) {
        this.emit('live', { streamId });
      }
    }
  }

  /**
   * Set stream as preview
   * @param {string} streamId - Stream identifier
   * @param {boolean} isPreview - Preview status
   */
  setPreview(streamId, isPreview) {
    const state = this.states.get(streamId);
    const elements = this.elements.get(streamId);

    if (state && elements) {
      state.isPreview = isPreview;
      this._updateDisplay(streamId);

      if (isPreview) {
        this.emit('preview', { streamId });
      }
    }
  }

  /**
   * Set stream as recording
   * @param {string} streamId - Stream identifier
   * @param {boolean} isRecording - Recording status
   */
  setRecording(streamId, isRecording) {
    const state = this.states.get(streamId);
    const elements = this.elements.get(streamId);

    if (state && elements) {
      state.isRecording = isRecording;
      this._updateDisplay(streamId);

      if (isRecording) {
        this._startFlashEffect(streamId);
        this.emit('recording', { streamId });
      } else {
        this._stopFlashEffect(streamId);
      }
    }
  }

  /**
   * Update display based on state
   */
  _updateDisplay(streamId) {
    const state = this.states.get(streamId);
    const elements = this.elements.get(streamId);

    if (!state || !elements) return;

    const { tally, label } = elements;
    let color = this.config.colors.inactive;
    let labelText = '';

    if (state.isLive) {
      color = this.config.colors.live;
      labelText = 'LIVE';
    } else if (state.isPreview) {
      color = this.config.colors.preview;
      labelText = 'PREVIEW';
    }

    tally.style.backgroundColor = color;
    label.textContent = labelText;
    label.style.opacity = labelText ? '1' : '0';
    label.style.color = state.isLive ? '#fff' : '#000';
  }

  /**
   * Start flash effect for recording
   */
  _startFlashEffect(streamId) {
    const elements = this.elements.get(streamId);
    if (!elements) return;

    elements._flashInterval = setInterval(() => {
      const currentlyFlashing = elements.tally.style.opacity === '0.5';
      elements.tally.style.opacity = currentlyFlashing ? '1' : '0.5';
    }, this.config.flashInterval);
  }

  /**
   * Stop flash effect
   */
  _stopFlashEffect(streamId) {
    const elements = this.elements.get(streamId);
    if (elements && elements._flashInterval) {
      clearInterval(elements._flashInterval);
      elements.tally.style.opacity = '1';
    }
  }

  /**
   * Set tally colors
   * @param {Object} colors - Color configuration
   */
  setColors(colors) {
    this.config.colors = { ...this.config.colors, ...colors };
    // Update all displays
    this.states.forEach((_, streamId) => {
      this._updateDisplay(streamId);
    });
  }

  /**
   * Get state for stream
   * @param {string} streamId - Stream identifier
   * @returns {Object|null}
   */
  getState(streamId) {
    return this.states.get(streamId) || null;
  }

  /**
   * Get all live streams
   * @returns {Array<string>}
   */
  getLiveStreams() {
    const live = [];
    this.states.forEach((state, streamId) => {
      if (state.isLive) live.push(streamId);
    });
    return live;
  }

  /**
   * Get all preview streams
   * @returns {Array<string>}
   */
  getPreviewStreams() {
    const preview = [];
    this.states.forEach((state, streamId) => {
      if (state.isPreview) preview.push(streamId);
    });
    return preview;
  }

  /**
   * Remove tally light
   * @param {string} streamId - Stream identifier
   */
  remove(streamId) {
    const elements = this.elements.get(streamId);
    if (elements) {
      this._stopFlashEffect(streamId);
      elements.tally.remove();
      elements.label.remove();
      this.elements.delete(streamId);
      this.states.delete(streamId);
    }
  }

  /**
   * Cleanup all tally lights
   */
  cleanup() {
    this.states.forEach((_, streamId) => {
      this.remove(streamId);
    });
  }

  /**
   * Emit event (simple event emitter)
   */
  emit(event, data) {
    const handlers = this._handlers || (this._handlers = new Map());
    const eventHandlers = handlers.get(event) || [];
    eventHandlers.forEach(handler => handler(data));
  }

  /**
   * Listen to event
   */
  on(event, handler) {
    const handlers = this._handlers || (this._handlers = new Map());
    if (!handlers.has(event)) {
      handlers.set(event, []);
    }
    handlers.get(event).push(handler);
  }

  /**
   * Remove event listener
   */
  off(event, handler) {
    const handlers = this._handlers?.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) handlers.splice(index, 1);
    }
  }
}

module.exports = { TallyLight };
