/**
 * SignalingClient - WebSocket wrapper for BreadCall signaling server
 * Handles connection, auto-reconnect, and message routing
 */
class SignalingClient extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.url = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000; // Start at 1s
    this.maxReconnectDelay = 30000; // Max 30s
    this.messageQueue = [];
    this.maxQueueSize = 100; // Prevent memory leaks
    this.pingInterval = null;
  }

  /**
   * Connect to signaling server
   * @param {string} url - WebSocket URL
   */
  connect(url) {
    this.url = url;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('[SignalingClient] Connected');
      this.reconnectAttempts = 0;
      this.dispatchEvent(new CustomEvent('connected'));

      // Send queued messages
      this.messageQueue.forEach(msg => this.send(msg.type, msg.payload));
      this.messageQueue = [];

      // Start ping interval
      this.startPingInterval();
    };

    this.ws.onclose = (event) => {
      console.log('[SignalingClient] Disconnected', event.code, event.reason);
      this.dispatchEvent(new CustomEvent('disconnected', { detail: event }));
      this.stopPingInterval();

      // Attempt reconnect
      this.attemptReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('[SignalingClient] Error:', error);
      this.dispatchEvent(new CustomEvent('error', { detail: error }));
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (error) {
        console.error('[SignalingClient] Parse error:', error);
      }
    };
  }

  /**
   * Handle incoming message
   * @param {Object} data - Parsed message
   */
  handleMessage(data) {
    const { type } = data;

    if (type === 'ping') {
      this.send('pong');
      return;
    }

    console.log('[SignalingClient] Received:', type, data);
    this.dispatchEvent(new CustomEvent(type, { detail: data }));
  }

  /**
   * Send message to server
   * @param {string} type - Message type
   * @param {Object} payload - Message payload
   */
  send(type, payload = {}) {
    const message = { type, payload };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      // Queue message for later with FIFO eviction to prevent memory leaks
      if (this.messageQueue.length >= this.maxQueueSize) {
        this.messageQueue.shift(); // Remove oldest message
        console.warn('[SignalingClient] Message queue full, dropping oldest message');
      }
      this.messageQueue.push({ type, payload });
    }
  }

  /**
   * Attempt to reconnect
   */
  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[SignalingClient] Max reconnect attempts reached');
      this.dispatchEvent(new CustomEvent('max-reconnect-reached'));
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );

    console.log(`[SignalingClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.dispatchEvent(new CustomEvent('reconnecting', {
        detail: { attempt: this.reconnectAttempts }
      }));
      this.connect(this.url);
    }, delay);
  }

  /**
   * Disconnect from server
   */
  disconnect() {
    this.stopPingInterval();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Start ping interval
   */
  startPingInterval() {
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      this.send('ping');
    }, 30000);
  }

  /**
   * Stop ping interval
   */
  stopPingInterval() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Check connection state
   * @returns {boolean} True if connected
   */
  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Validate a token with the server
   * @param {string} token - Token string to validate
   * @param {string} action - Action being performed (optional)
   * @returns {Promise<Object>} Validation result
   */
  async validateToken(token, action = null) {
    try {
      const response = await fetch('/api/tokens/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Validation failed');
      }

      return data;
    } catch (error) {
      console.error('[SignalingClient] Token validation failed:', error);
      throw error;
    }
  }

  /**
   * Join room with token authentication
   * @param {string} roomId - Room ID
   * @param {string} token - Token string
   * @param {string} name - User name
   * @returns {Promise<Object>} Join result
   */
  async joinRoomWithToken(roomId, token, name = 'User') {
    // First validate token
    const validation = await this.validateToken(token, 'join');

    if (!validation.valid) {
      throw new Error(validation.message || 'Invalid token');
    }

    // Extract pre-registered name from token if available
    const useName = validation.payload.metadata?.name || name;

    // Connect to WebSocket
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

    return new Promise((resolve, reject) => {
      const onConnected = () => {
        this.removeEventListener('connected', onConnected);

        // Send join with token
        this.send('join-room-with-token', {
          roomId,
          token,
          name: useName
        });
      };

      const onResponse = (e) => {
        if (e.detail.type === 'joined-room') {
          this.removeEventListener('joined-room', onResponse);
          this.removeEventListener('error', onError);
          resolve(e.detail);
        }
      };

      const onError = (e) => {
        this.removeEventListener('connected', onConnected);
        this.removeEventListener('joined-room', onResponse);
        this.removeEventListener('error', onError);
        reject(new Error(e.detail.message));
      };

      this.addEventListener('connected', onConnected, { once: true });
      this.addEventListener('joined-room', onResponse, { once: true });
      this.addEventListener('error', onError, { once: true });

      if (!this.isConnected()) {
        this.connect(wsUrl);
      } else {
        onConnected();
      }
    });
  }
}

// Export for use
window.SignalingClient = SignalingClient;
