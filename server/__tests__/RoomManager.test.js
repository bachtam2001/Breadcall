const RoomManager = require('../src/RoomManager');

describe('RoomManager', () => {
  let roomManager;

  beforeEach(() => {
    roomManager = new RoomManager();
  });

  afterEach(() => {
    // Clear all TTL timers
    jest.clearAllTimers();
  });

  describe('createRoom', () => {
    test('should create a room with default options', () => {
      const room = roomManager.createRoom();

      expect(room).toBeDefined();
      expect(room.id).toHaveLength(4);
      expect(room.password).toBeNull();
      expect(room.maxParticipants).toBe(10);
      expect(room.quality).toBe('720p');
      expect(room.codec).toBe('H264');
      expect(room.participants.size).toBe(0);
    });

    test('should create a room with custom options', () => {
      const room = roomManager.createRoom({
        password: 'secret123',
        maxParticipants: 5,
        quality: '1080p',
        codec: 'VP9'
      });

      expect(room.password).toBe('secret123');
      expect(room.maxParticipants).toBe(5);
      expect(room.quality).toBe('1080p');
      expect(room.codec).toBe('VP9');
    });

    test('should generate unique room IDs', () => {
      const room1 = roomManager.createRoom();
      const room2 = roomManager.createRoom();

      expect(room1.id).not.toBe(room2.id);
    });
  });

  describe('joinRoom', () => {
    test('should join a room successfully', async () => {
      const room = roomManager.createRoom();
      const result = await roomManager.joinRoom(room.id, { name: 'Test User' });

      expect(result.participantId).toBeDefined();
      expect(result.room.id).toBe(room.id);
      expect(result.existingPeers).toHaveLength(0);
    });

    test('should return existing peers when joining', async () => {
      const room = roomManager.createRoom();

      // First participant
      const result1 = await roomManager.joinRoom(room.id, { name: 'User 1' });

      // Second participant
      const result2 = await roomManager.joinRoom(room.id, { name: 'User 2' });

      expect(result2.existingPeers).toHaveLength(1);
      expect(result2.existingPeers[0].name).toBe('User 1');
    });

    test('should throw error when room not found', async () => {
      await expect(roomManager.joinRoom('INVALID', { name: 'Test' })).rejects.toThrow('Room not found');
    });

    test('should throw error when room is full', async () => {
      const room = roomManager.createRoom({ maxParticipants: 2 });

      await roomManager.joinRoom(room.id, { name: 'User 1' });
      await roomManager.joinRoom(room.id, { name: 'User 2' });

      await expect(roomManager.joinRoom(room.id, { name: 'User 3' })).rejects.toThrow('Room is full');
    });

    test('should throw error when password is invalid', async () => {
      const room = roomManager.createRoom({ password: 'correct' });

      await expect(roomManager.joinRoom(room.id, { name: 'Test', password: 'wrong' })).rejects.toThrow('Invalid password');
    });

    test('should join room with correct password', async () => {
      const room = roomManager.createRoom({ password: 'correct' });

      await expect(roomManager.joinRoom(room.id, { name: 'Test', password: 'correct' })).resolves.not.toThrow();
    });
  });

  describe('leaveRoom', () => {
    test('should remove participant from room', async () => {
      const room = roomManager.createRoom();
      const { participantId } = await roomManager.joinRoom(room.id, { name: 'Test' });

      const result = roomManager.leaveRoom(room.id, participantId);

      expect(result).toBe(true);
      expect(roomManager.getRoomParticipants(room.id)).toHaveLength(0);
    });

    test('should return false when room not found', () => {
      const result = roomManager.leaveRoom('INVALID', 'participant-123');
      expect(result).toBe(false);
    });

    test('should start TTL timer when room becomes empty', async () => {
      // Create a separate RoomManager with fake timers
      jest.useFakeTimers();
      const testRoomManager = new RoomManager();
      const room = testRoomManager.createRoom();
      const { participantId } = await testRoomManager.joinRoom(room.id, { name: 'Test' });

      testRoomManager.leaveRoom(room.id, participantId);

      // Room should still exist (TTL not expired)
      expect(testRoomManager.getRoom(room.id)).toBeDefined();

      // Fast-forward past TTL (5 minutes)
      jest.advanceTimersByTime(5 * 60 * 1000 + 1000);

      // Room should be deleted (returns null)
      expect(testRoomManager.getRoom(room.id)).toBeNull();

      jest.useRealTimers();
    });
  });

  describe('deleteRoom', () => {
    test('should delete a room', async () => {
      const room = roomManager.createRoom();
      const result = await roomManager.deleteRoom(room.id);

      expect(result).toBe(true);
      expect(roomManager.getRoom(room.id)).toBeNull();
    });

    test('should return false when room not found', async () => {
      const result = await roomManager.deleteRoom('INVALID');
      expect(result).toBe(false);
    });
  });

  describe('getRoom', () => {
    test('should return room by ID', () => {
      const room = roomManager.createRoom();
      const found = roomManager.getRoom(room.id);

      expect(found).toBeDefined();
      expect(found.id).toBe(room.id);
    });

    test('should return null for non-existent room', () => {
      const found = roomManager.getRoom('INVALID');
      expect(found).toBeNull();
    });
  });

  describe('getRoomParticipants', () => {
    test('should return list of participants', async () => {
      const room = roomManager.createRoom();
      await roomManager.joinRoom(room.id, { name: 'User 1' });
      await roomManager.joinRoom(room.id, { name: 'User 2' });

      const participants = roomManager.getRoomParticipants(room.id);

      expect(participants).toHaveLength(2);
      expect(participants.map(p => p.name)).toEqual(expect.arrayContaining(['User 1', 'User 2']));
    });

    test('should return null for non-existent room', () => {
      const participants = roomManager.getRoomParticipants('INVALID');
      expect(participants).toBeNull();
    });
  });

  describe('updateParticipant', () => {
    test('should update participant status', async () => {
      const room = roomManager.createRoom();
      const { participantId } = await roomManager.joinRoom(room.id, { name: 'Test' });

      roomManager.updateParticipant(room.id, participantId, {
        isMuted: true,
        isVideoOff: true
      });

      const participants = roomManager.getRoomParticipants(room.id);
      expect(participants[0].isMuted).toBe(true);
      expect(participants[0].isVideoOff).toBe(true);
    });

    test('should return false for non-existent room', () => {
      const result = roomManager.updateParticipant('INVALID', 'participant-123', { isMuted: true });
      expect(result).toBe(false);
    });
  });

  describe('getAllRooms', () => {
    test('should return all rooms', () => {
      roomManager.createRoom();
      roomManager.createRoom();
      roomManager.createRoom();

      const rooms = roomManager.getAllRooms();

      expect(rooms).toHaveLength(3);
    });
  });
});
