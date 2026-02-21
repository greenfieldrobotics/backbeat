export default {
  testEnvironment: 'node',
  transform: {},
  maxWorkers: 1,
  testTimeout: 30000,
  verbose: true,
  testMatch: ['**/tests/**/*.test.js'],
  globalSetup: './tests/setup/globalSetup.js',
  globalTeardown: './tests/setup/globalTeardown.js',
};
