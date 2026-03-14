const RedisClient = require('../src/RedisClient');

describe('RedisClient', () => {
  let client;

  beforeEach(() => {
    client = new RedisClient();
  });

  afterEach(async () => {
    await client.disconnect();
  });

  test('connects to Redis successfully', async () => {
    const isConnected = await client.connect();
    expect(isConnected).toBe(true);
    expect(client.isReady()).toBe(true);
  });

  test('get and set operations work', async () => {
    await client.connect();
    await client.set('test-key', 'test-value', 60);
    const value = await client.get('test-key');
    expect(value).toBe('test-value');
  });

  test('setJson and getJson operations work', async () => {
    await client.connect();
    const testData = { foo: 'bar', num: 42 };
    await client.setJson('test-json', testData, 60);
    const value = await client.getJson('test-json');
    expect(value).toEqual(testData);
  });

  test('del operation works', async () => {
    await client.connect();
    await client.set('to-delete', 'value', 60);
    await client.del('to-delete');
    const value = await client.get('to-delete');
    expect(value).toBeNull();
  });

  test('returns null for non-existent key', async () => {
    await client.connect();
    const value = await client.get('non-existent-key');
    expect(value).toBeNull();
  });

  test('returns false when not connected', async () => {
    const result = await client.set('key', 'value');
    expect(result).toBe(false);
  });

  test('isReady returns false before connect', () => {
    expect(client.isReady()).toBe(false);
  });
});
