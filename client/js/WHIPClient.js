/**
 * WHIPClient - WHIP (WebRTC-HTTP Ingestion Protocol) client
 * Publish WebRTC streams via HTTP POST/DELETE
 * @see https://www.ietf.org/archive/id/draft-ietf-wish-whip-02.html
 */
class WHIPClient {
  constructor() {
    this.connections = new Map(); // resourceId -> { pc, resourceUrl, stream }
    this.defaultIceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];
  }

  /**
   * Publish a stream via WHIP
   * @param {string} endpoint - WHIP endpoint URL
   * @param {MediaStream} stream - Stream to publish
   * @param {Object} options - WHIP options
   * @returns {Promise<Object>} - Connection info
   */
  async publish(endpoint, stream, options = {}) {
    const {
      iceServers = this.defaultIceServers,
      token,
      metadata = {}
    } = options;

    // Create peer connection
    const pc = new RTCPeerConnection({ iceServers });

    // Add tracks
    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });

    // Create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // POST offer to WHIP endpoint
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(metadata['Content-Type'] ? { 'Content-Type': metadata['Content-Type'] } : {})
      },
      body: offer.sdp
    });

    if (!response.ok) {
      throw new Error(`WHIP POST failed: ${response.status} ${response.statusText}`);
    }

    // Get resource URL from Location header
    const resourceUrl = response.headers.get('Location');
    if (!resourceUrl) {
      throw new Error('WHIP endpoint did not return Location header');
    }

    // Get ETag for DELETE requests
    const etag = response.headers.get('ETag');

    // Handle answer
    const answerSdp = await response.text();
    const answer = new RTCSessionDescription({
      type: 'answer',
      sdp: answerSdp
    });
    await pc.setRemoteDescription(answer);

    // Store connection
    const connectionId = resourceUrl.split('/').pop() || Date.now().toString();
    this.connections.set(connectionId, {
      pc,
      resourceUrl,
      etag,
      stream,
      endpoint
    });

    console.log('[WHIPClient] Published to:', resourceUrl);

    return {
      connectionId,
      resourceUrl,
      pc
    };
  }

  /**
   * Stop publishing (DELETE resource)
   * @param {string} connectionId - Connection ID or resource URL
   * @returns {Promise<void>}
   */
  async stop(connectionId) {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      // Try treating connectionId as resource URL
      await this._deleteResource(connectionId);
      return;
    }

    await this._deleteResource(connection.resourceUrl, connection.etag);

    // Close peer connection
    connection.pc.close();
    this.connections.delete(connectionId);

    console.log('[WHIPClient] Stopped publishing');
  }

  async _deleteResource(resourceUrl, etag) {
    const headers = {
      ...(etag ? { 'If-Match': etag } : {})
    };

    const response = await fetch(resourceUrl, {
      method: 'DELETE',
      headers
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`WHIP DELETE failed: ${response.status}`);
    }
  }

  /**
   * Get connection by ID
   * @param {string} connectionId
   * @returns {Object|null}
   */
  getConnection(connectionId) {
    return this.connections.get(connectionId) || null;
  }

  /**
   * Get all connections
   * @returns {Map}
   */
  getConnections() {
    return new Map(this.connections);
  }

  /**
   * Cleanup all connections
   */
  cleanup() {
    this.connections.forEach((conn, id) => {
      conn.pc.close();
    });
    this.connections.clear();
  }
}

/**
 * WHEPClient - WHEP (WebRTC-HTTP Egress Protocol) client
 * Consume WebRTC streams via HTTP GET
 * @see https://www.ietf.org/archive/id/draft-ietf-wish-whep-02.html
 */
class WHEPClient {
  constructor() {
    this.connections = new Map();
    this.defaultIceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];
  }

  /**
   * Consume a stream via WHEP
   * @param {string} endpoint - WHEP endpoint URL
   * @param {Object} options - WHEP options
   * @returns {Promise<MediaStream>} - Received media stream
   */
  async consume(endpoint, options = {}) {
    const {
      iceServers = this.defaultIceServers,
      token
    } = options;

    // Create peer connection
    const pc = new RTCPeerConnection({ iceServers });

    // Create transceivers for receiving
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });

    // Handle incoming track
    let remoteStream;
    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        remoteStream = event.streams[0];
      } else {
        remoteStream = new MediaStream();
        remoteStream.addTrack(event.track);
      }
    };

    // Create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // POST offer to WHEP endpoint
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: offer.sdp
    });

    if (!response.ok) {
      throw new Error(`WHEP POST failed: ${response.status} ${response.statusText}`);
    }

    // Get resource URL from Location header
    const resourceUrl = response.headers.get('Location');
    const etag = response.headers.get('ETag');

    // Handle answer
    const answerSdp = await response.text();
    const answer = new RTCSessionDescription({
      type: 'answer',
      sdp: answerSdp
    });
    await pc.setRemoteDescription(answer);

    // Wait for stream
    await new Promise((resolve) => {
      const checkStream = () => {
        if (remoteStream) {
          resolve();
        } else {
          setTimeout(checkStream, 100);
        }
      };
      checkStream();
    });

    // Store connection
    const connectionId = resourceUrl?.split('/').pop() || Date.now().toString();
    this.connections.set(connectionId, {
      pc,
      resourceUrl,
      etag,
      endpoint,
      stream: remoteStream
    });

    console.log('[WHEPClient] Consuming from:', resourceUrl);

    return {
      connectionId,
      stream: remoteStream,
      pc
    };
  }

  /**
   * Stop consuming
   * @param {string} connectionId
   * @returns {Promise<void>}
   */
  async stop(connectionId) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    if (connection.resourceUrl) {
      await this._deleteResource(connection.resourceUrl, connection.etag);
    }

    connection.pc.close();
    this.connections.delete(connectionId);

    console.log('[WHEPClient] Stopped consuming');
  }

  async _deleteResource(resourceUrl, etag) {
    const headers = {
      ...(etag ? { 'If-Match': etag } : {})
    };

    const response = await fetch(resourceUrl, {
      method: 'DELETE',
      headers
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`WHEP DELETE failed: ${response.status}`);
    }
  }

  /**
   * Get connection by ID
   */
  getConnection(connectionId) {
    return this.connections.get(connectionId) || null;
  }

  /**
   * Cleanup all connections
   */
  cleanup() {
    this.connections.forEach((conn) => {
      conn.pc.close();
    });
    this.connections.clear();
  }
}

module.exports = { WHIPClient, WHEPClient };
