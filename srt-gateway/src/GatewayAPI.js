const { v4: uuidv4 } = require('uuid');

/**
 * GatewayAPI - REST API handler for SRT Gateway
 * Manages WebRTC connections and SRT output lifecycle
 */
class GatewayAPI {
  constructor(webrtcReceiver, srtOutput) {
    this.webrtcReceiver = webrtcReceiver;
    this.srtOutput = srtOutput;
    this.activeConnections = new Map(); // connectionId -> { roomId, streamId, peerId }
  }

  /**
   * POST /api/connect/:roomId
   * Connect to a BreadCall room and receive streams
   */
  async connect(req, res) {
    const { roomId } = req.params;
    const { signalingUrl } = req.body;

    if (!signalingUrl) {
      return res.status(400).json({
        error: 'signalingUrl is required',
        message: 'Provide the WebSocket URL of the BreadCall signaling server'
      });
    }

    try {
      // Check if already connected
      if (this.webrtcReceiver.isConnected()) {
        return res.status(400).json({
          error: 'Already connected',
          message: 'Disconnect from current room first'
        });
      }

      // Connect to signaling server
      await this.webrtcReceiver.connect(signalingUrl, roomId);

      // Create connection record
      const connectionId = uuidv4();
      this.activeConnections.set(connectionId, {
        roomId,
        connectedAt: new Date().toISOString()
      });

      console.log('[GatewayAPI] Connected to room:', roomId, 'Connection ID:', connectionId);

      res.json({
        success: true,
        connectionId,
        roomId,
        message: 'Connected to room. Waiting for streams...'
      });
    } catch (error) {
      console.error('[GatewayAPI] Connect error:', error);
      res.status(500).json({
        error: 'Connection failed',
        message: error.message
      });
    }
  }

  /**
   * POST /api/disconnect
   * Disconnect from current room
   */
  async disconnect(req, res) {
    try {
      // Stop all SRT outputs first
      this.srtOutput.cleanup();

      // Disconnect from WebRTC
      await this.webrtcReceiver.disconnect();

      // Clear connections
      this.activeConnections.clear();

      console.log('[GatewayAPI] Disconnected from room');

      res.json({
        success: true,
        message: 'Disconnected successfully'
      });
    } catch (error) {
      console.error('[GatewayAPI] Disconnect error:', error);
      res.status(500).json({
        error: 'Disconnect failed',
        message: error.message
      });
    }
  }

  /**
   * POST /api/srt/:streamId/start
   * Start SRT output for a stream
   */
  async startSRT(req, res) {
    const { streamId } = req.params;
    const { srtUrl, peerId } = req.body;

    if (!srtUrl) {
      return res.status(400).json({
        error: 'srtUrl is required',
        message: 'Provide the destination SRT URL (e.g., srt://host:port)'
      });
    }

    // Get stream from WebRTC receiver
    const stream = peerId
      ? this.webrtcReceiver.getStream(peerId)
      : this._getFirstStream();

    if (!stream) {
      return res.status(404).json({
        error: 'Stream not found',
        message: peerId
          ? `No stream found for peer ${peerId}`
          : 'No streams available'
      });
    }

    // Start SRT output
    const success = this.srtOutput.startSRT(streamId, stream, srtUrl);

    if (success) {
      const output = this.srtOutput.getStatus(streamId);
      res.json({
        success: true,
        streamId,
        ...output,
        message: 'SRT output started'
      });
    } else {
      res.status(500).json({
        error: 'Failed to start SRT',
        message: 'Check if FFmpeg is installed and port is available'
      });
    }
  }

  /**
   * DELETE /api/srt/:streamId/stop
   * Stop SRT output for a stream
   */
  async stopSRT(req, res) {
    const { streamId } = req.params;

    const stopped = this.srtOutput.stopSRT(streamId);

    if (stopped) {
      res.json({
        success: true,
        streamId,
        message: 'SRT output stopped'
      });
    } else {
      res.status(404).json({
        error: 'Stream not found',
        message: `No active SRT output for stream ${streamId}`
      });
    }
  }

  /**
   * GET /api/srt/status
   * Get status of all SRT outputs
   */
  async getStatus(req, res) {
    const activeOutputs = this.srtOutput.getActiveOutputs();
    const availablePorts = this.srtOutput.getAvailablePortsCount();

    res.json({
      success: true,
      webrtc: {
        connected: this.webrtcReceiver.isConnected(),
        peers: this.webrtcReceiver.getPeers()
      },
      srt: {
        activeOutputs,
        activeCount: activeOutputs.length,
        availablePorts
      }
    });
  }

  /**
   * GET /api/streams
   * Get all available streams
   */
  async getStreams(req, res) {
    const peers = this.webrtcReceiver.getPeers();
    const activeSRT = this.srtOutput.getActiveOutputs();
    const activeSRTIds = new Set(activeSRT.map(o => o.streamId));

    const streams = peers.map(peer => ({
      peerId: peer.peerId,
      hasStream: peer.hasStream,
      hasSRTOutput: activeSRTIds.has(peer.peerId)
    }));

    res.json({
      success: true,
      streams,
      total: streams.length,
      withSRT: activeSRT.length
    });
  }

  /**
   * Get first available stream (helper for single-stream use case)
   * @private
   */
  _getFirstStream() {
    const peers = this.webrtcReceiver.getPeers();
    for (const peer of peers) {
      if (peer.hasStream) {
        return this.webrtcReceiver.getStream(peer.peerId);
      }
    }
    return null;
  }
}

module.exports = { GatewayAPI };
