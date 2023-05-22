const { defaults } = require('jest-config');

module.exports = {
  collectCoverageFrom: ['src/**'],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  coveragePathIgnorePatterns: [
    ...defaults.coveragePathIgnorePatterns,
    '__generated__',
    'index',
  ],
  modulePathIgnorePatterns: ['dist/', 'lib/'],
  preset: 'ts-jest',
  setupFilesAfterEnv: ['jest-extended'],
  testEnvironment: 'node',
};
