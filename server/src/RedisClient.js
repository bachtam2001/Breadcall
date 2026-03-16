const Redis = require('ioredis');

class RedisClient {
  constructor() {
    this.client = null;
    this.connected = false;
  }

  async connect() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    return new Promise((resolve, reject) => {
      this.client = new Redis(redisUrl, {
        retryStrategy: (times) => Math.min(times * 50, 2000),
        lazyConnect: true
      });

      this.client.on('connect', () => {
        this.connected = true;
        console.log('[RedisClient] Connected to Redis');
        resolve(true);
      });

      this.client.on('error', (err) => {
        console.error('[RedisClient] Redis error:', err.message);
        this.connected = false;
        reject(err);
      });

      this.client.connect().catch(reject);
    });
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.connected = false;
      console.log('[RedisClient] Disconnected from Redis');
    }
  }

  async get(key) {
    if (!this.connected) return null;
    return this.client.get(key);
  }

  async set(key, value, ttlSeconds = null) {
    if (!this.connected) return false;
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
    return true;
  }

  async setJson(key, jsonObject, ttlSeconds = null) {
    const jsonString = JSON.stringify(jsonObject);
    console.log('[RedisClient] setJson called for key:', key, 'connected:', this.connected);
    const result = await this.set(key, jsonString, ttlSeconds);
    console.log('[RedisClient] setJson complete for key:', key);
    return result;
  }

  async getJson(key) {
    const value = await this.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  async del(key) {
    if (!this.connected) return false;
    await this.client.del(key);
    return true;
  }

  async hsetObject(key, object) {
    if (!this.connected) return false;
    const entries = Object.entries(object);
    if (entries.length === 0) return false;
    await this.client.hset(key, entries.flat());
    return true;
  }

  async expire(key, seconds) {
    if (!this.connected) return false;
    await this.client.expire(key, seconds);
    return true;
  }

  async invalidate(pattern) {
    if (!this.connected) return 0;
    let cursor = 0;
    let deletedCount = 0;

    do {
      const result = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = result[0];
      const keys = result[1];

      if (keys.length > 0) {
        const deleted = await this.client.del(...keys);
        deletedCount += deleted;
      }
    } while (cursor !== 0);

    return deletedCount;
  }

  async sadd(key, members) {
    if (!this.connected) return 0;
    if (!Array.isArray(members)) members = [members];
    return await this.client.sadd(key, ...members);
  }

  async srem(key, members) {
    if (!this.connected) return 0;
    if (!Array.isArray(members)) members = [members];
    return await this.client.srem(key, ...members);
  }

  async smembers(key) {
    if (!this.connected) return [];
    return await this.client.smembers(key);
  }

  isReady() {
    return this.connected;
  }
}

module.exports = RedisClient;
