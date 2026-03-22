/**
 * MediaMTXClient Unit Tests
 */
const MediaMTXClient = require('../src/MediaMTXClient');
const axios = require('axios');

// Mock axios
jest.mock('axios');

describe('MediaMTXClient', () => {
  let client;
  let mockAxiosInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock axios instance
    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn()
    };

    // Mock axios.create to return our mock instance
    axios.create.mockReturnValue(mockAxiosInstance);

    // Create client instance
    client = new MediaMTXClient();
  });

  describe('constructor', () => {
    test('should create instance with default baseUrl', () => {
      const defaultClient = new MediaMTXClient();

      expect(axios.create).toHaveBeenCalledWith({
        baseURL: 'http://mediamtx:9997',
        timeout: 5000
      });
      expect(defaultClient.baseUrl).toBe('http://mediamtx:9997');
    });

    test('should create instance with custom baseUrl', () => {
      const customUrl = 'http://localhost:9997';
      const customClient = new MediaMTXClient(customUrl);

      expect(axios.create).toHaveBeenCalledWith({
        baseURL: 'http://localhost:9997',
        timeout: 5000
      });
      expect(customClient.baseUrl).toBe('http://localhost:9997');
    });
  });

  describe('addPath', () => {
    test('should send POST request to /v2/paths/add with config', async () => {
      const mockConfig = {
        path: 'room/ABC123',
        sourceUrl: 'srt://remote-server:8890?mode=caller&streamid=mystream'
      };
      const mockResponse = { success: true };

      mockAxiosInstance.post.mockResolvedValue({ data: mockResponse });

      const result = await client.addPath(mockConfig);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/v2/paths/add', mockConfig);
      expect(result).toEqual(mockResponse);
    });

    test('should propagate errors from API', async () => {
      const mockError = new Error('Path already exists');
      mockAxiosInstance.post.mockRejectedValue(mockError);

      await expect(client.addPath({ path: 'room/ABC123' })).rejects.toThrow('Path already exists');
    });
  });

  describe('stopPath', () => {
    test('should send POST request to /v2/paths/kick with path name', async () => {
      const pathName = 'room/ABC123';
      const mockResponse = { success: true };

      mockAxiosInstance.post.mockResolvedValue({ data: mockResponse });

      const result = await client.stopPath(pathName);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/v2/paths/kick', {
        path: pathName
      });
      expect(result).toEqual(mockResponse);
    });

    test('should propagate errors from API', async () => {
      const mockError = new Error('Path not found');
      mockAxiosInstance.post.mockRejectedValue(mockError);

      await expect(client.stopPath('room/ABC123')).rejects.toThrow('Path not found');
    });
  });

  describe('getPathStatus', () => {
    test('should send GET request to /v2/paths/get/:pathName', async () => {
      const pathName = 'room/ABC123';
      const mockStatus = {
        name: 'room/ABC123',
        ready: true,
        source: { type: 'rtspSource' }
      };

      mockAxiosInstance.get.mockResolvedValue({ data: mockStatus });

      const result = await client.getPathStatus(pathName);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(`/v2/paths/get/${encodeURIComponent(pathName)}`);
      expect(result).toEqual(mockStatus);
    });

    test('should handle URL encoding for special characters in path name', async () => {
      const pathName = 'room/ABC 123!';
      mockAxiosInstance.get.mockResolvedValue({ data: {} });

      await client.getPathStatus(pathName);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/v2/paths/get/room%2FABC%20123!');
    });
  });

  describe('listPaths', () => {
    test('should send GET request to /v2/paths/list and return items', async () => {
      const mockPaths = [
        { name: 'room/ABC123', ready: true },
        { name: 'room/XYZ789', ready: false }
      ];

      mockAxiosInstance.get.mockResolvedValue({ data: { items: mockPaths } });

      const result = await client.listPaths();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/v2/paths/list');
      expect(result).toEqual(mockPaths);
    });

    test('should return empty array when items is missing', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: {} });

      const result = await client.listPaths();

      expect(result).toEqual([]);
    });
  });

  describe('isAvailable', () => {
    test('should return true when API is reachable', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: { items: [] } });

      const result = await client.isAvailable();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/v2/paths/list');
      expect(result).toBe(true);
    });

    test('should return false when API is unreachable', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Connection refused'));

      const result = await client.isAvailable();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/v2/paths/list');
      expect(result).toBe(false);
    });

    test('should return false on timeout', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Timeout'));

      const result = await client.isAvailable();

      expect(result).toBe(false);
    });
  });
});
