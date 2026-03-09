module.exports = {
  testEnvironment: 'node',
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
  setupFilesAfterEnv: ['<rootDir>/server/__tests__/setup.js'],
  testMatch: [
    '**/__tests__/**/*.test.js'
  ]
};
