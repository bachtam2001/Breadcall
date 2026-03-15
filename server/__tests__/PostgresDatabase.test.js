const { Pool } = require('pg');

// Mock the pg package
jest.mock('pg');

const Database = require('../src/database');

describe('PostgresDatabase', () => {
  let db;
  let mockPool;
  let mockClient;

  beforeEach(() => {
    mockClient = {
      release: jest.fn().mockResolvedValue(),
      query: jest.fn()
    };

    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: jest.fn(),
      end: jest.fn().mockResolvedValue()
    };

    Pool.mockImplementation(() => mockPool);
    db = new Database();
  });

  afterEach(async () => {
    await db.shutdown();
  });

  describe('initialize', () => {
    it('should connect to PostgreSQL successfully', async () => {
      process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';

      await db.initialize();

      expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
        connectionString: 'postgres://test:test@localhost:5432/test',
        min: 2,
        max: 10
      }));
      expect(mockPool.connect).toHaveBeenCalledTimes(1);
    });

    it('should retry connection on failure', async () => {
      // Mock pool.connect to fail twice, then succeed
      mockPool.connect
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(mockClient);

      process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';

      await expect(db.initialize()).resolves.not.toThrow();
      expect(mockPool.connect).toHaveBeenCalledTimes(3);
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      // Initialize database before query tests
      process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
      await db.initialize();
    });

    it('should execute parameterized query and return rows', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 1, name: 'test' }] });

      const result = await db.query('SELECT * FROM users WHERE id = $1', [1]);

      expect(mockPool.query).toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', [1]);
      expect(result).toEqual([{ id: 1, name: 'test' }]);
    });
  });

  describe('queryOne', () => {
    beforeEach(async () => {
      // Initialize database before queryOne tests
      process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
      await db.initialize();
    });

    it('should return first row or null', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 1, name: 'test' }] });

      const result = await db.queryOne('SELECT * FROM users WHERE id = $1', [1]);

      expect(result).toEqual({ id: 1, name: 'test' });
    });

    it('should return null when no rows found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await db.queryOne('SELECT * FROM users WHERE id = $1', [999]);

      expect(result).toBeNull();
    });
  });
});
