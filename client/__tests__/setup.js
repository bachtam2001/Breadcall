// Client test setup for jsdom environment

// Clear all mocks after each test
afterEach(() => {
  jest.clearAllMocks();
  jest.clearAllTimers();
});

// Mock CustomEvent for jsdom
if (typeof global.CustomEvent === 'undefined') {
  global.CustomEvent = class CustomEvent {
    constructor(type, params) {
      this.type = type;
      this.detail = params?.detail || null;
    }
  };
}

// Mock setImmediate for jsdom (Node.js only)
if (typeof global.setImmediate === 'undefined') {
  // Use process.nextTick for microtask scheduling
  global.setImmediate = (fn, ...args) => {
    if (typeof process !== 'undefined' && process.nextTick) {
      return process.nextTick(() => fn(...args));
    }
    return setTimeout(() => fn(...args), 0);
  };
}

// Mock console to keep test output clean (optional - comment out to see logs)
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
