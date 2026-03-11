module.exports = {
  verbose: true,
  forceExit: true,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  testTimeout: 10000,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'server/src/**/*.js',
    '!server/src/index.js'
  ],
  testMatch: [
    '**/__tests__/**/*.test.js'
  ],
  // Project-based configuration for server and client tests
  projects: [
    {
      displayName: 'server',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/server/__tests__/**/*.test.js'],
      setupFilesAfterEnv: ['<rootDir>/server/__tests__/setup.js'],
      collectCoverageFrom: [
        'server/src/**/*.js',
        '!server/src/index.js'
      ]
    },
    {
      displayName: 'client',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/client/__tests__/**/*.test.js'],
      setupFilesAfterEnv: ['<rootDir>/client/__tests__/setup.js'],
      testPathIgnorePatterns: ['<rootDir>/client/__tests__/setup.js']
    }
  ]
};
