const RoomManager = require('../src/RoomManager');

describe('SRT Integration', () => {
  let roomManager;

  beforeEach(() => {
    roomManager = new RoomManager();
  });

  test('room creation includes SRT URL components', () => {
    const room = roomManager.createRoom();

    expect(room.srtPublishSecret).toBeDefined();
    expect(room.srtPublishSecret).toHaveLength(32);
    expect(room.srtStreamActive).toBe(false);
    expect(room.srtConnectedAt).toBeNull();
  });

  test('SRT stream state updates trigger director notifications', () => {
    const room = roomManager.createRoom();

    // Simulate director joining
    const mockWs = { send: jest.fn(), readyState: 1 };
    roomManager.joinRoomAsDirector(room.id, { ws: mockWs, name: 'Test Director' });

    // Simulate stream start
    room.srtStreamActive = true;
    room.srtConnectedAt = new Date().toISOString();
    roomManager.notifyDirectors(room.id, {
      type: 'srt-feed-updated',
      active: true,
      connectedAt: room.srtConnectedAt
    });

    expect(mockWs.send).toHaveBeenCalledWith(
      expect.stringContaining('srt-feed-updated')
    );
  });

  test('SRT publish URL format is correct', () => {
    const room = roomManager.createRoom();
    const host = 'localhost';
    const srtPublishUrl = `srt://${host}:8890?streamid=publish:room/${room.id}/${room.srtPublishSecret}`;

    // Verify URL format
    expect(srtPublishUrl).toMatch(/^srt:\/\/[^:]+:\d+\?streamid=publish:room\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/[a-f0-9]{32}$/);
  });

  test('each room gets unique SRT secret', () => {
    const room1 = roomManager.createRoom();
    const room2 = roomManager.createRoom();
    const room3 = roomManager.createRoom();

    const secrets = [room1.srtPublishSecret, room2.srtPublishSecret, room3.srtPublishSecret];
    const uniqueSecrets = new Set(secrets);

    expect(uniqueSecrets.size).toBe(3);
  });

  test('SRT stream state can be updated', () => {
    const room = roomManager.createRoom();

    // Initially inactive
    expect(room.srtStreamActive).toBe(false);
    expect(room.srtConnectedAt).toBeNull();

    // Activate stream
    room.srtStreamActive = true;
    room.srtConnectedAt = new Date().toISOString();

    expect(room.srtStreamActive).toBe(true);
    expect(room.srtConnectedAt).toBeDefined();

    // Deactivate stream
    room.srtStreamActive = false;
    room.srtConnectedAt = null;

    expect(room.srtStreamActive).toBe(false);
    expect(room.srtConnectedAt).toBeNull();
  });
});
