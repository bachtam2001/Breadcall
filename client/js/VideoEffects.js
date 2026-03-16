/**
 * VideoEffects - Video filters, LUT, chroma key, and virtual background
 * Uses WebGL for real-time video processing
 */
class VideoEffects {
  constructor() {
    this.canvas = null;
    this.gl = null;
    this.program = null;
    this.textures = new Map();
    this.currentEffect = null;
    this.initialized = false;
    this.buffers = []; // Track created buffers for cleanup
  }

  /**
   * Initialize WebGL context
   * @param {HTMLCanvasElement} canvas - Canvas element
   * @returns {boolean}
   */
  async initialize(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

    if (!this.gl) {
      console.error('[VideoEffects] WebGL not supported');
      return false;
    }

    // Create shader program
    this.program = this._createProgram();
    this.initialized = true;

    return true;
  }

  /**
   * Create shader program
   */
  _createProgram() {
    const gl = this.gl;

    // Vertex shader
    const vsSource = `
      attribute vec4 aPosition;
      attribute vec2 aTexCoord;
      varying vec2 vTexCoord;
      void main() {
        gl_Position = aPosition;
        vTexCoord = aTexCoord;
      }
    `;

    // Fragment shader (default - passthrough)
    const fsSource = `
      precision mediump float;
      varying vec2 vTexCoord;
      uniform sampler2D uTexture;
      uniform float uBrightness;
      uniform float uContrast;
      uniform float uSaturation;
      uniform vec3 uChromaKey;
      uniform float uChromaThreshold;
      uniform int uEffect;

      vec3 rgb2hsv(vec3 c) {
        vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
        vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
        vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
        float d = q.x - min(q.w, q.y);
        float e = 1.0e-10;
        return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
      }

      vec3 hsv2rgb(vec3 c) {
        vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
      }

      void main() {
        vec4 color = texture2D(uTexture, vTexCoord);

        // Brightness
        color.rgb += uBrightness;

        // Contrast
        color.rgb = ((color.rgb - 0.5) * uContrast) + 0.5;

        // Saturation
        vec3 hsv = rgb2hsv(color.rgb);
        hsv.y *= uSaturation;
        color.rgb = hsv2rgb(hsv);

        // Chroma key
        if (uEffect == 1) {
          float dist = distance(color.rgb, uChromaKey);
          if (dist < uChromaThreshold) {
            color.a = 0.0;
          }
        }

        gl_FragColor = color;
      }
    `;

    const vs = this._compileShader(vsSource, gl.VERTEX_SHADER);
    const fs = this._compileShader(fsSource, gl.FRAGMENT_SHADER);

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[VideoEffects] Shader program failed:', gl.getProgramInfoLog(program));
      return null;
    }

    return program;
  }

  /**
   * Compile shader
   */
  _compileShader(source, type) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('[VideoEffects] Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  /**
   * Apply effect to video frame
   * @param {HTMLVideoElement} video - Source video
   * @param {string} effect - Effect name
   * @param {Object} params - Effect parameters
   */
  applyEffect(video, effect, params = {}) {
    if (!this.initialized) return;

    const gl = this.gl;

    // Set canvas size
    this.canvas.width = video.videoWidth;
    this.canvas.height = video.videoHeight;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    // Create texture from video
    const texture = this._createVideoTexture(video);

    // Use program
    gl.useProgram(this.program);

    // Set attributes
    this._setupBuffers();

    // Set uniforms
    const location = {
      texture: gl.getUniformLocation(this.program, 'uTexture'),
      brightness: gl.getUniformLocation(this.program, 'uBrightness'),
      contrast: gl.getUniformLocation(this.program, 'uContrast'),
      saturation: gl.getUniformLocation(this.program, 'uSaturation'),
      chromaKey: gl.getUniformLocation(this.program, 'uChromaKey'),
      chromaThreshold: gl.getUniformLocation(this.program, 'uChromaThreshold'),
      effect: gl.getUniformLocation(this.program, 'uEffect')
    };

    gl.uniform1i(location.texture, 0);
    gl.uniform1f(location.brightness, params.brightness || 0);
    gl.uniform1f(location.contrast, params.contrast || 1);
    gl.uniform1f(location.saturation, params.saturation || 1);

    if (effect === 'chromaKey') {
      gl.uniform1i(location.effect, 1);
      gl.uniform3fv(location.chromaKey, params.chromaColor || [0, 1, 0]); // Green screen default
      gl.uniform1f(location.chromaThreshold, params.threshold || 0.3);
    } else {
      gl.uniform1i(location.effect, 0);
    }

    // Draw
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Create video texture
   */
  _createVideoTexture(video) {
    const gl = this.gl;

    let texture = this.textures.get('video');
    if (!texture) {
      texture = gl.createTexture();
      this.textures.set('video', texture);
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return texture;
  }

  /**
   * Setup buffers
   */
  _setupBuffers() {
    const gl = this.gl;

    // Position buffer
    let positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1, 1, 1
    ]), gl.STATIC_DRAW);
    this.buffers.push(positionBuffer);

    const positionLocation = gl.getAttribLocation(this.program, 'aPosition');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    // TexCoord buffer
    let texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0, 1, 1, 1, 0, 0, 1, 0
    ]), gl.STATIC_DRAW);
    this.buffers.push(texCoordBuffer);

    const texCoordLocation = gl.getAttribLocation(this.program, 'aTexCoord');
    gl.enableVertexAttribArray(texCoordLocation);
    gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);
  }

  /**
   * Apply preset filter
   * @param {HTMLVideoElement} video
   * @param {string} preset - 'none', 'warm', 'cool', 'vintage', 'dramatic', 'grayscale'
   */
  applyPreset(video, preset) {
    const presets = {
      none: { brightness: 0, contrast: 1, saturation: 1 },
      warm: { brightness: 0.05, contrast: 1.1, saturation: 1.2 },
      cool: { brightness: -0.05, contrast: 1.1, saturation: 0.9 },
      vintage: { brightness: 0.1, contrast: 0.9, saturation: 0.7 },
      dramatic: { brightness: -0.1, contrast: 1.3, saturation: 0.8 },
      grayscale: { brightness: 0, contrast: 1, saturation: 0 }
    };

    const params = presets[preset] || presets.none;
    this.applyEffect(video, 'none', params);
  }

  /**
   * Apply chroma key (green screen)
   * @param {HTMLVideoElement} video
   * @param {Array} color - RGB color array [r, g, b]
   * @param {number} threshold - Threshold 0-1
   */
  applyChromaKey(video, color = [0, 1, 0], threshold = 0.3) {
    this.applyEffect(video, 'chromaKey', {
      chromaColor: color,
      threshold
    });
  }

  /**
   * Get processed canvas
   * @returns {HTMLCanvasElement}
   */
  getCanvas() {
    return this.canvas;
  }

  /**
   * Get output as MediaStream
   * @returns {MediaStream}
   */
  getStream() {
    if (this.canvas) {
      return this.canvas.captureStream(30);
    }
    return null;
  }

  /**
   * Cleanup
   */
  cleanup() {
    if (this.gl) {
      // Delete buffers
      this.buffers.forEach(buffer => {
        this.gl.deleteBuffer(buffer);
      });
      this.buffers = [];

      // Delete textures
      this.textures.forEach(texture => {
        this.gl.deleteTexture(texture);
      });
      this.textures.clear();

      // Delete program
      if (this.program) {
        this.gl.deleteProgram(this.program);
      }
    }

    this.initialized = false;
    this.canvas = null;
    this.gl = null;
    this.program = null;
  }
}

module.exports = { VideoEffects };
