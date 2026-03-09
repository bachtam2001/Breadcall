import WebSocket from 'websocket';
import {EventEmitter} from 'react-native';

/**
 * SignalingService - WebSocket client for BreadCall signaling server
 * Handles room management and WebRTC signaling messages
 */
class SignalingService extends EventEmitter {
  constructor() {
    super();
    this.connection = null;
    this.roomId = null;
    this.participantId = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  /**
   * Connect to signaling server
   * @param {string} serverUrl - WebSocket server URL
   * @returns {Promise<void>}
   */
  async connect(serverUrl) {
    return new Promise((resolve, reject) => {
      try {
        this.connection = new WebSocket.w3cwebsocket(serverUrl);

        this.connection.onopen = () => {
          console.log('[SignalingService] Connected to server');
          this.connected = true;
          this.reconnectAttempts = 0;
          this.emit('connected');
          resolve();
        };

        this.connection.onclose = () => {
          console.log('[SignalingService] Disconnected');
          this.connected = false;
          this.emit('disconnected');
          this._handleReconnect(serverUrl);
        };

        this.connection.onerror = (error) => {
          console.error('[SignalingService] Error:', error);
          this.emit('error', error);
          if (!this.connected) {
            reject(error);
          }
        };

        this.connection.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this._handleMessage(data);
          } catch (error) {
            console.error('[SignalingService] Parse error:', error);
          }
        };

        // Connection timeout
        setTimeout(() => {
          if (!this.connected) {
            reject(new Error('Connection timeout'));
          }
        }, 10000);
      } catch (error) {
        reject(error);
      }
    });
  }

  _handleMessage(data) {
    const {type} = data;

    switch (type) {
      case 'joined-room':
        this._handleJoinedRoom(data);
        break;
      case 'participant-joined':
        this.emit('participant-joined', {
          participantId: data.participantId,
          name: data.name
        });
        break;
      case 'participant-left':
        this.emit('participant-left', {
          participantId: data.participantId
        });
        break;
      case 'offer':
        this.emit('offer', {
          from: data.from,
          sdp: data.sdp
        });
        break;
      case 'answer':
        this.emit('answer', {
          from: data.from,
          sdp: data.sdp
        });
        break;
      case 'ice-candidate':
        this.emit('ice-candidate', {
          from: data.from,
          candidate: data.candidate
        });
        break;
      case 'chat-message':
        this.emit('chat-message', data);
        break;
      case 'ping':
        this._sendPong();
        break;
    }
  }

  _handleJoinedRoom(data) {
    this.participantId = data.participantId;
    this.roomId = data.roomId;
    this.emit('joined-room', {
      participantId: data.participantId,
      roomId: data.roomId,
      existingPeers: data.existingPeers || []
    });
  }

  _handleReconnect(serverUrl) {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      console.log(`[SignalingService] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
      setTimeout(() => this.connect(serverUrl), delay);
    } else {
      console.error('[SignalingService] Max reconnect attempts reached');
      this.emit('reconnect-failed');
    }
  }

  _sendPong() {
    this.send({type: 'pong'});
  }

  /**
   * Join a room
   * @param {string} roomId - Room ID
   * @param {string} name - Participant name
   * @param {string} password - Room password (optional)
   */
  joinRoom(roomId, name, password = null) {
    this.send({
      type: 'join-room',
      payload: {
        roomId,
        name,
        password
      }
    });
  }

  /**
   * Leave current room
   */
  leaveRoom() {
    if (this.roomId) {
      this.send({
        type: 'leave-room',
        payload: {
          roomId: this.roomId
        }
      });
      this.roomId = null;
    }
  }

  /**
   * Send WebRTC offer
   * @param {string} targetPeerId - Target peer ID
   * @param {RTCSessionDescription} sdp - SDP offer
   */
  sendOffer(targetPeerId, sdp) {
    this.send({
      type: 'offer',
      payload: {
        targetPeerId,
        sdp
      }
    });
  }

  /**
   * Send WebRTC answer
   * @param {string} targetPeerId - Target peer ID
   * @param {RTCSessionDescription} sdp - SDP answer
   */
  sendAnswer(targetPeerId, sdp) {
    this.send({
      type: 'answer',
      payload: {
        targetPeerId,
        sdp
      }
    });
  }

  /**
   * Send ICE candidate
   * @param {string} targetPeerId - Target peer ID
   * @param {RTCIceCandidate} candidate - ICE candidate
   */
  sendIceCandidate(targetPeerId, candidate) {
    this.send({
      type: 'ice-candidate',
      payload: {
        targetPeerId,
        candidate
      }
    });
  }

  /**
   * Send chat message
   * @param {string} message - Message text
   */
  sendChatMessage(message) {
    this.send({
      type: 'chat-message',
      payload: {
        roomId: this.roomId,
        message
      }
    });
  }

  /**
   * Send mute status update
   * @param {boolean} muted - Audio muted
   * @param {boolean} videoOff - Video disabled
   */
  sendMuteStatus(muted, videoOff) {
    this.send({
      type: 'mute-status',
      payload: {
        roomId: this.roomId,
        muted,
        videoOff
      }
    });
  }

  /**
   * Send generic message
   * @param {object} data - Message data
   */
  send(data) {
    if (this.connection && this.connected) {
      this.connection.send(JSON.stringify(data));
    }
  }

  /**
   * Disconnect from server
   */
  disconnect() {
    this.leaveRoom();
    if (this.connection) {
      this.connection.close();
      this.connection = null;
    }
    this.connected = false;
    this.roomId = null;
    this.participantId = null;
  }

  /**
   * Get connection status
   * @returns {boolean}
   */
  isConnected() {
    return this.connected;
  }

  /**
   * Get current participant ID
   * @returns {string|null}
   */
  getParticipantId() {
    return this.participantId;
  }
}

export default new SignalingService();
