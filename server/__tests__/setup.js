// Clear all timers after each test to prevent leakage
afterEach(() => {
  jest.clearAllTimers();
  jest.clearAllMocks();
});

// Suppress console output during tests (optional - comment out to see logs)
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
