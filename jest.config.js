export default {
  // Test environment
  testEnvironment: 'node',
  
  // ES modules support
  preset: null,
  extensionsToTreatAsEsm: ['.js'],
  globals: {
    'ts-jest': {
      useESM: true
    }
  },
  
  // Module name mapping for ES modules
  moduleNameMapping: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  
  // Transform configuration
  transform: {},
  
  // Test file patterns
  testMatch: [
    '<rootDir>/tests/**/*.test.js',
    '<rootDir>/tests/**/*.spec.js'
  ],
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  
  // Coverage configuration
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  
  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  },
  
  // Files to collect coverage from
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/app.js', // Exclude main entry point
    '!src/config/*.js', // Exclude configuration files
    '!**/node_modules/**',
    '!**/tests/**'
  ],
  
  // Module paths
  modulePaths: ['<rootDir>/src'],
  
  // Test timeout
  testTimeout: 10000,
  
  // Verbose output
  verbose: true,
  
  // Clear mocks between tests
  clearMocks: true,
  
  // Reset modules between tests
  resetModules: true,
  
  // Mock configuration
  mockPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/tests/fixtures/'
  ],
  
  // Test path ignore patterns
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/dist/',
    '<rootDir>/coverage/'
  ],
  
  // Watch plugins for development
  watchPlugins: [
    'jest-watch-typeahead/filename',
    'jest-watch-typeahead/testname'
  ],
  
  // Error handling
  errorOnDeprecated: true,
  
  // Notification configuration
  notify: false,
  notifyMode: 'failure-change',
  
  // Snapshot serializers
  snapshotSerializers: [],
  
  // Maximum worker processes
  maxWorkers: '50%',
  
  // Cache directory
  cacheDirectory: '<rootDir>/.jest-cache'
};