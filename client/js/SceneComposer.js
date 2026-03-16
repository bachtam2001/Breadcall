/**
 * SceneComposer - Multi-stream layout composer
 * Creates composite layouts with multiple video sources
 */
class SceneComposer {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.scenes = new Map(); // sceneId -> scene config
    this.activeScene = null;
    this.sources = new Map(); // sourceId -> { video, x, y, width, height, zIndex, visible }
    this.background = null;
    this.isRendering = false;
    this.animationFrame = null;
  }

  /**
   * Initialize composer
   * @param {HTMLCanvasElement} canvas - Canvas element
   * @param {number} width - Output width
   * @param {number} height - Output height
   */
  initialize(canvas, width = 1920, height = 1080) {
    this.canvas = canvas;
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');

    // Define preset layouts
    this._definePresets();

    console.log('[SceneComposer] Initialized', width, 'x', height);
  }

  /**
   * Define preset layouts
   */
  _definePresets() {
    this.scenes.set('single', {
      name: 'Single Source',
      sources: [{ id: 'main', x: 0, y: 0, width: 1, height: 1, zIndex: 1 }]
    });

    this.scenes.set('pip-right', {
      name: 'Picture in Picture (Right)',
      sources: [
        { id: 'main', x: 0, y: 0, width: 1, height: 1, zIndex: 1 },
        { id: 'pip', x: 0.7, y: 0.7, width: 0.25, height: 0.25, zIndex: 2 }
      ]
    });

    this.scenes.set('pip-left', {
      name: 'Picture in Picture (Left)',
      sources: [
        { id: 'main', x: 0, y: 0, width: 1, height: 1, zIndex: 1 },
        { id: 'pip', x: 0.05, y: 0.7, width: 0.25, height: 0.25, zIndex: 2 }
      ]
    });

    this.scenes.set('side-by-side', {
      name: 'Side by Side',
      sources: [
        { id: 'left', x: 0, y: 0, width: 0.5, height: 1, zIndex: 1 },
        { id: 'right', x: 0.5, y: 0, width: 0.5, height: 1, zIndex: 1 }
      ]
    });

    this.scenes.set('grid-2x2', {
      name: '2x2 Grid',
      sources: [
        { id: 'tl', x: 0, y: 0, width: 0.5, height: 0.5, zIndex: 1 },
        { id: 'tr', x: 0.5, y: 0, width: 0.5, height: 0.5, zIndex: 1 },
        { id: 'bl', x: 0, y: 0.5, width: 0.5, height: 0.5, zIndex: 1 },
        { id: 'br', x: 0.5, y: 0.5, width: 0.5, height: 0.5, zIndex: 1 }
      ]
    });

    this.scenes.set('grid-3x3', {
      name: '3x3 Grid',
      sources: [
        { id: '0', x: 0, y: 0, width: 0.333, height: 0.333, zIndex: 1 },
        { id: '1', x: 0.333, y: 0, width: 0.333, height: 0.333, zIndex: 1 },
        { id: '2', x: 0.666, y: 0, width: 0.333, height: 0.333, zIndex: 1 },
        { id: '3', x: 0, y: 0.333, width: 0.333, height: 0.333, zIndex: 1 },
        { id: '4', x: 0.333, y: 0.333, width: 0.333, height: 0.333, zIndex: 1 },
        { id: '5', x: 0.666, y: 0.333, width: 0.333, height: 0.333, zIndex: 1 },
        { id: '6', x: 0, y: 0.666, width: 0.333, height: 0.333, zIndex: 1 },
        { id: '7', x: 0.333, y: 0.666, width: 0.333, height: 0.333, zIndex: 1 },
        { id: '8', x: 0.666, y: 0.666, width: 0.333, height: 0.333, zIndex: 1 }
      ]
    });

    this.scenes.set('spotlight', {
      name: 'Spotlight',
      sources: [
        { id: 'spotlight', x: 0, y: 0, width: 0.75, height: 1, zIndex: 1 },
        { id: 'strip1', x: 0.75, y: 0, width: 0.25, height: 0.333, zIndex: 2 },
        { id: 'strip2', x: 0.75, y: 0.333, width: 0.25, height: 0.333, zIndex: 2 },
        { id: 'strip3', x: 0.75, y: 0.666, width: 0.25, height: 0.333, zIndex: 2 }
      ]
    });
  }

  /**
   * Add video source
   * @param {string} sourceId - Source identifier
   * @param {HTMLVideoElement} video - Video element
   * @param {Object} position - Position config {x, y, width, height}
   */
  addSource(sourceId, video, position = {}) {
    this.sources.set(sourceId, {
      video,
      x: position.x || 0,
      y: position.y || 0,
      width: position.width || 1,
      height: position.height || 1,
      zIndex: position.zIndex || 1,
      visible: position.visible !== false,
      borderRadius: position.borderRadius || 0,
      opacity: position.opacity !== undefined ? position.opacity : 1
    });

    console.log('[SceneComposer] Added source:', sourceId);
  }

  /**
   * Remove source
   * @param {string} sourceId
   */
  removeSource(sourceId) {
    this.sources.delete(sourceId);
  }

  /**
   * Update source position
   * @param {string} sourceId
   * @param {Object} position
   */
  updateSource(sourceId, position) {
    const source = this.sources.get(sourceId);
    if (source) {
      Object.assign(source, position);
    }
  }

  /**
   * Set source visibility
   * @param {string} sourceId
   * @param {boolean} visible
   */
  setSourceVisible(sourceId, visible) {
    const source = this.sources.get(sourceId);
    if (source) {
      source.visible = visible;
    }
  }

  /**
   * Set background color or image
   * @param {string|HTMLImageElement} background - Color or image
   */
  setBackground(background) {
    this.background = background;
  }

  /**
   * Load scene preset
   * @param {string} sceneId - Scene preset ID
   * @param {Map<string, HTMLVideoElement>} sourceVideos - Map of sourceId to video
   */
  loadScene(sceneId, sourceVideos) {
    const scene = this.scenes.get(sceneId);
    if (!scene) {
      console.error('[SceneComposer] Scene not found:', sceneId);
      return false;
    }

    // Clear existing sources
    this.sources.clear();

    // Add sources from scene config
    scene.sources.forEach(sourceConfig => {
      const video = sourceVideos.get(sourceConfig.id);
      if (video) {
        this.addSource(sourceConfig.id, video, {
          x: sourceConfig.x,
          y: sourceConfig.y,
          width: sourceConfig.width,
          height: sourceConfig.height,
          zIndex: sourceConfig.zIndex
        });
      }
    });

    this.activeScene = sceneId;
    console.log('[SceneComposer] Loaded scene:', sceneId);
    return true;
  }

  /**
   * Start rendering loop
   */
  startRendering() {
    if (this.isRendering) return;

    this.isRendering = true;
    this._renderLoop();
  }

  /**
   * Stop rendering loop
   */
  stopRendering() {
    this.isRendering = false;
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
  }

  /**
   * Render loop
   */
  _renderLoop() {
    if (!this.isRendering) return;

    this.render();
    this.animationFrame = requestAnimationFrame(() => this._renderLoop());
  }

  /**
   * Render current composition
   */
  render() {
    const { ctx, canvas } = this;
    if (!ctx || !canvas) return;

    // Clear canvas
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw background
    if (this.background) {
      if (typeof this.background === 'string') {
        ctx.fillStyle = this.background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else if (this.background instanceof HTMLImageElement) {
        ctx.drawImage(this.background, 0, 0, canvas.width, canvas.height);
      }
    }

    // Sort sources by zIndex
    const sortedSources = Array.from(this.sources.entries())
      .filter(([_, source]) => source.visible)
      .sort((a, b) => a[1].zIndex - b[1].zIndex);

    // Draw each source
    sortedSources.forEach(([sourceId, source]) => {
      const x = source.x * canvas.width;
      const y = source.y * canvas.height;
      const width = source.width * canvas.width;
      const height = source.height * canvas.height;

      if (source.video && source.video.readyState >= 2) {
        ctx.save();

        // Apply opacity
        ctx.globalAlpha = source.opacity;

        // Draw video
        if (source.borderRadius > 0) {
          // Rounded corners
          ctx.beginPath();
          ctx.roundRect(x, y, width, height, source.borderRadius);
          ctx.clip();
        }

        ctx.drawImage(source.video, x, y, width, height);

        ctx.restore();
      }
    });
  }

  /**
   * Get output as MediaStream
   * @returns {MediaStream}
   */
  getStream(frameRate = 30) {
    if (this.canvas) {
      return this.canvas.captureStream(frameRate);
    }
    return null;
  }

  /**
   * Capture current frame as blob
   * @param {string} type - Image type (image/png, image/jpeg)
   * @param {number} quality - Quality 0-1 (for jpeg)
   * @returns {Promise<Blob>}
   */
  captureFrame(type = 'image/png', quality = 0.9) {
    return new Promise((resolve) => {
      this.canvas.toBlob(resolve, type, quality);
    });
  }

  /**
   * Get available scenes
   * @returns {Array}
   */
  getScenes() {
    return Array.from(this.scenes.entries()).map(([id, scene]) => ({
      id,
      name: scene.name
    }));
  }

  /**
   * Get current scene
   * @returns {string|null}
   */
  getCurrentScene() {
    return this.activeScene;
  }

  /**
   * Add custom scene
   * @param {string} sceneId
   * @param {string} name
   * @param {Array} sources - Source configs
   */
  addScene(sceneId, name, sources) {
    this.scenes.set(sceneId, { name, sources });
  }

  /**
   * Cleanup
   */
  cleanup() {
    this.stopRendering();
    this.sources.clear();
    this.scenes.clear();
    this.activeScene = null;
    this.destroyed = true;
  }
}

module.exports = { SceneComposer };
