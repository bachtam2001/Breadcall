const request = require('supertest');
const express = require('express');
const RoomManager = require('../src/RoomManager');

describe('SRT Auth Webhook', () => {
  let roomManager;
  let app;

  beforeEach(() => {
    roomManager = new RoomManager();
    app = express();
    app.use(express.json());

    // Import MediaMTX routes with mocked roomManager
    const createMediaMTXRoutes = require('../src/routes/mediamtx');
    const router = createMediaMTXRoutes(roomManager);
    app.use('/api/mediamtx', router);
  });

  test('validates correct SRT secret', async () => {
    const room = roomManager.createRoom();
    const payload = {
      action: 'publish',
      path: `room/${room.id}`,
      query: `streamid=publish:room/${room.id}/${room.srtPublishSecret}`,
      ip: '192.168.1.50',
      user_agent: 'OBS/29.0',
      protocol: 'srt'
    };

    const response = await request(app)
      .post('/api/mediamtx/auth')
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ allow: true });
  });

  test('rejects invalid secret', async () => {
    const room = roomManager.createRoom();
    const payload = {
      action: 'publish',
      path: `room/${room.id}`,
      query: `streamid=publish:room/${room.id}/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4`, // Valid format, wrong secret
      ip: '192.168.1.50',
      user_agent: 'OBS/29.0',
      protocol: 'srt'
    };

    const response = await request(app)
      .post('/api/mediamtx/auth')
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ allow: false, reason: 'invalid_secret' });
  });

  test('rejects non-existent room', async () => {
    const payload = {
      action: 'publish',
      path: 'room/abc-defg-hij',
      query: 'streamid=publish:room/abc-defg-hij/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
      ip: '192.168.1.50',
      user_agent: 'OBS/29.0',
      protocol: 'srt'
    };

    const response = await request(app)
      .post('/api/mediamtx/auth')
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ allow: false, reason: 'room_not_found' });
  });

  test('rejects invalid path format', async () => {
    const payload = {
      action: 'publish',
      path: 'invalid',
      query: 'streamid=publish:invalid/secret',
      ip: '192.168.1.50',
      user_agent: 'OBS/29.0',
      protocol: 'srt'
    };

    const response = await request(app)
      .post('/api/mediamtx/auth')
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ allow: false, reason: 'invalid_format' });
  });

  test('handles stream start event', async () => {
    const room = roomManager.createRoom();
    const payload = {
      path: `room/${room.id}`,
      event: 'publish_start'
    };

    const response = await request(app)
      .post('/api/mediamtx/stream-event')
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(room.srtStreamActive).toBe(true);
    expect(room.srtConnectedAt).toBeDefined();
  });

  test('handles stream end event', async () => {
    const room = roomManager.createRoom();
    // First set it active
    room.srtStreamActive = true;
    room.srtConnectedAt = new Date().toISOString();

    const payload = {
      path: `room/${room.id}`,
      event: 'publish_end'
    };

    const response = await request(app)
      .post('/api/mediamtx/stream-event')
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(room.srtStreamActive).toBe(false);
    expect(room.srtConnectedAt).toBeNull();
  });
});
