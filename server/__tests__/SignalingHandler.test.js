const WebSocket = require('ws');
const RoomManager = require('../src/RoomManager');
const SignalingHandler = require('../src/SignalingHandler');

// Mock WebSocket
jest.mock('ws');

describe('SignalingHandler', () => {
  let signalingHandler;
  let roomManager;
  let mockWss;
  let mockWs;

  beforeEach(() => {
    roomManager = new RoomManager();
    mockWss = {
      on: jest.fn()
    };
    mockWs = {
      send: jest.fn(),
      readyState: WebSocket.OPEN,
      close: jest.fn()
    };
    signalingHandler = new SignalingHandler(roomManager, mockWss);
  });

  describe('handleConnection', () => {
    test('should initialize heartbeat for new connection', () => {
      signalingHandler.handleConnection(mockWs);
      // Heartbeat should be set
      expect(signalingHandler.heartbeats.has(mockWs)).toBe(true);
    });
  });

  describe('handlePing', () => {
    test('should reset misses counter and send pong', () => {
      signalingHandler.handleConnection(mockWs);
      signalingHandler.handlePing(mockWs);

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"pong"')
      );
    });
  });

  describe('handleJoinRoom', () => {
    test('should reject join without roomId', () => {
      signalingHandler.handleJoinRoom(mockWs, {});

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('Room ID is required')
      );
    });

    test('should join room successfully', () => {
      const room = roomManager.createRoom();

      signalingHandler.handleJoinRoom(mockWs, {
        roomId: room.id,
        name: 'Test User'
      });

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"joined-room"')
      );
    });

    test('should handle join error', () => {
      signalingHandler.handleJoinRoom(mockWs, {
        roomId: 'XYZ8'
      });

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('Room not found')
      );
    });
  });

  describe('handleJoinRoomDirector', () => {
    test('should reject director join without roomId', () => {
      signalingHandler.handleJoinRoomDirector(mockWs, {});

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('Room ID is required')
      );
    });

    test('should reject director join with invalid roomId format', () => {
      signalingHandler.handleJoinRoomDirector(mockWs, {
        roomId: 'invalid-room-id'
      });

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('Invalid room ID format')
      );
    });

    test('should join room as director successfully', () => {
      const room = roomManager.createRoom();

      signalingHandler.handleJoinRoomDirector(mockWs, {
        roomId: room.id,
        name: 'Director'
      });

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"joined-room"')
      );
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"directorId"')
      );
    });

    test('should return existing participants to director', () => {
      const room = roomManager.createRoom();

      // Add a participant first
      const mockWs2 = {
        send: jest.fn(),
        readyState: WebSocket.OPEN,
        close: jest.fn()
      };
      signalingHandler.handleJoinRoom(mockWs2, {
        roomId: room.id,
        name: 'Test Participant'
      });

      jest.clearAllMocks();

      // Now director joins
      signalingHandler.handleJoinRoomDirector(mockWs, {
        roomId: room.id,
        name: 'Director'
      });

      // Director should receive existing peers list (using existingPeers field name)
      const response = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(response.type).toBe('joined-room');
      expect(response.existingPeers).toBeDefined();
      expect(Array.isArray(response.existingPeers)).toBe(true);
      expect(response.existingPeers.length).toBe(1);
      expect(response.existingPeers[0].name).toBe('Test Participant');
    });
  });

  describe('handleLeaveRoom', () => {
    test('should reject leave when not in room', () => {
      signalingHandler.handleLeaveRoom(mockWs, {});

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('Not in a room')
      );
    });

    test('should leave room successfully', () => {
      const room = roomManager.createRoom();
      signalingHandler.handleJoinRoom(mockWs, { roomId: room.id, name: 'Test' });

      jest.clearAllMocks();
      signalingHandler.handleLeaveRoom(mockWs, {});

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"left-room"')
      );
    });
  });

  describe('handleOffer', () => {
    test('should reject offer without required fields', () => {
      signalingHandler.handleOffer(mockWs, {});

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('targetPeerId and sdp are required')
      );
    });

    test('should reject offer when not connected to room', () => {
      signalingHandler.handleOffer(mockWs, {
        targetPeerId: 'peer-123',
        sdp: { type: 'offer', sdp: '...' }
      });

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('Not connected to a room')
      );
    });
  });

  describe('handleAnswer', () => {
    test('should reject answer without required fields', () => {
      signalingHandler.handleAnswer(mockWs, {});

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('targetPeerId and sdp are required')
      );
    });
  });

  describe('handleIceCandidate', () => {
    test('should reject ICE candidate without required fields', () => {
      signalingHandler.handleIceCandidate(mockWs, {});

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('targetPeerId and candidate are required')
      );
    });
  });

  describe('handleChatMessage', () => {
    test('should reject chat message without message', () => {
      signalingHandler.handleChatMessage(mockWs, {});

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('Message is required')
      );
    });

    test('should broadcast chat message to room', () => {
      const room = roomManager.createRoom();
      const mockWs2 = {
        send: jest.fn(),
        readyState: WebSocket.OPEN,
        close: jest.fn()
      };

      signalingHandler.handleJoinRoom(mockWs, { roomId: room.id, name: 'User 1' });
      signalingHandler.handleJoinRoom(mockWs2, { roomId: room.id, name: 'User 2' });

      jest.clearAllMocks();
      signalingHandler.handleChatMessage(mockWs, { message: 'Hello!' });

      // User 2 should receive the chat message
      expect(mockWs2.send).toHaveBeenCalledWith(
        expect.stringContaining('chat-message')
      );
    });
  });

  describe('handleMuteStatus', () => {
    test('should update and broadcast mute status', () => {
      const room = roomManager.createRoom();
      const mockWs2 = {
        send: jest.fn(),
        readyState: WebSocket.OPEN,
        close: jest.fn()
      };

      signalingHandler.handleJoinRoom(mockWs, { roomId: room.id, name: 'User 1' });
      signalingHandler.handleJoinRoom(mockWs2, { roomId: room.id, name: 'User 2' });

      jest.clearAllMocks();
      signalingHandler.handleMuteStatus(mockWs, { isMuted: true, isVideoOff: true });

      // User 2 should receive the mute status
      expect(mockWs2.send).toHaveBeenCalledWith(
        expect.stringContaining('mute-status')
      );
    });
  });

  describe('handleClose', () => {
    test('should clean up when connection closes', () => {
      const room = roomManager.createRoom();
      signalingHandler.handleJoinRoom(mockWs, { roomId: room.id, name: 'Test' });

      signalingHandler.handleClose(mockWs);

      // Connection should be cleaned up
      expect(signalingHandler.wsMap.has(mockWs)).toBe(false);
    });
  });

  describe('send', () => {
    test('should send message to WebSocket', () => {
      signalingHandler.send(mockWs, { type: 'test', data: 'hello' });

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'test', data: 'hello' })
      );
    });

    test('should not send if WebSocket is not open', () => {
      mockWs.readyState = WebSocket.CLOSED;
      signalingHandler.send(mockWs, { type: 'test' });

      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });

  describe('broadcastToRoom', () => {
    test('should broadcast to all participants in room', () => {
      const room = roomManager.createRoom();
      const mockWs2 = {
        send: jest.fn(),
        readyState: WebSocket.OPEN,
        close: jest.fn()
      };

      // Manually add connections to wsMap
      signalingHandler.wsMap.set(mockWs, { participantId: 'p1', roomId: room.id });
      signalingHandler.wsMap.set(mockWs2, { participantId: 'p2', roomId: room.id });

      signalingHandler.broadcastToRoom(room.id, { type: 'broadcast' });

      // Both should receive broadcast
      expect(mockWs.send).toHaveBeenCalled();
      expect(mockWs2.send).toHaveBeenCalled();
    });

    test('should exclude specified WebSocket', () => {
      const room = roomManager.createRoom();
      const mockWs2 = {
        send: jest.fn(),
        readyState: WebSocket.OPEN,
        close: jest.fn()
      };

      // Manually add connections to wsMap
      signalingHandler.wsMap.set(mockWs, { participantId: 'p1', roomId: room.id });
      signalingHandler.wsMap.set(mockWs2, { participantId: 'p2', roomId: room.id });

      signalingHandler.broadcastToRoom(room.id, { type: 'broadcast' }, mockWs);

      // Only ws2 should receive
      expect(mockWs.send).not.toHaveBeenCalled();
      expect(mockWs2.send).toHaveBeenCalled();
    });
  });

  describe('findPeerWebSocket', () => {
    test('should find peer WebSocket', () => {
      const room = roomManager.createRoom();
      const participantId = 'test-peer-id';

      // Manually add connection to wsMap
      signalingHandler.wsMap.set(mockWs, { participantId, roomId: room.id });

      const found = signalingHandler.findPeerWebSocket(room.id, participantId);

      expect(found).toBe(mockWs);
    });

    test('should return null for non-existent peer', () => {
      const result = signalingHandler.findPeerWebSocket('room-123', 'peer-456');
      expect(result).toBeNull();
    });
  });
});
