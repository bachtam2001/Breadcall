const axios = require('axios');

/**
 * MediaMTX HTTP API Client
 *
 * Provides wrapper methods for MediaMTX path management operations.
 * API documentation: https://github.com/bluenviron/mediamtx/tree/main/docs
 */
class MediaMTXClient {
  /**
   * Create a MediaMTXClient instance
   * @param {string} baseUrl - Base URL for MediaMTX HTTP API (default: http://mediamtx:9997)
   */
  constructor(baseUrl = 'http://mediamtx:9997') {
    this.baseUrl = baseUrl;
    this.api = axios.create({
      baseURL: baseUrl,
      timeout: 5000
    });
  }

  /**
   * Add a new path configuration to MediaMTX
   * @param {Object} config - Path configuration
   * @param {string} config.path - Path name (e.g., 'room/ABC123')
   * @param {string} [config.sourceUrl] - Source URL for pull mode (e.g., 'srt://host:port?mode=caller&streamid=xyz')
   * @returns {Promise<Object>} - API response data
   */
  async addPath(config) {
    const response = await this.api.post('/v2/paths/add', config);
    return response.data;
  }

  /**
   * Stop/kick an active path
   * @param {string} pathName - Path name to stop (e.g., 'room/ABC123')
   * @returns {Promise<Object>} - API response data
   */
  async stopPath(pathName) {
    const response = await this.api.post('/v2/paths/kick', {
      path: pathName
    });
    return response.data;
  }

  /**
   * Get status of a specific path
   * @param {string} pathName - Path name to query
   * @returns {Promise<Object>} - Path status data
   */
  async getPathStatus(pathName) {
    const response = await this.api.get(`/v2/paths/get/${encodeURIComponent(pathName)}`);
    return response.data;
  }

  /**
   * List all active paths
   * @returns {Promise<Array>} - Array of path objects
   */
  async listPaths() {
    const response = await this.api.get('/v2/paths/list');
    return response.data.items || [];
  }

  /**
   * Check if MediaMTX HTTP API is available
   * @returns {Promise<boolean>} - True if API is reachable
   */
  async isAvailable() {
    try {
      await this.api.get('/v2/paths/list');
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = MediaMTXClient;
