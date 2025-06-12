import { jest } from '@jest/globals';

// Global test setup
global.jest = jest;

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.TELEGRAM_BOT_TOKEN = 'test_bot_token';
process.env.ANTHROPIC_API_KEY = 'test_api_key';
process.env.DATABASE_ENCRYPTION_KEY = 'test_encryption_key_32_chars_!!';
process.env.SESSION_SECRET = 'test_session_secret_for_testing_purposes';
process.env.DATABASE_PATH = ':memory:';

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

// Mock Date.now for consistent testing
const mockNow = 1641024000000; // 2022-01-01 00:00:00 UTC
Date.now = jest.fn(() => mockNow);

// Setup cleanup after each test
afterEach(() => {
  jest.clearAllMocks();
});

// Global error handler for unhandled rejections in tests
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Global timeout for async operations
jest.setTimeout(10000);

// Mock crypto for consistent UUIDs in tests
const mockUuid = 'test-uuid-1234-5678-9abc-def123456789';
jest.mock('uuid', () => ({
  v4: jest.fn(() => mockUuid)
}));

// Export test utilities
export const testUtils = {
  mockNow,
  mockUuid,
  
  // Helper to create mock user
  createMockUser: (overrides = {}) => ({
    id: 1,
    telegram_id: 123456789,
    username: 'testuser',
    first_name: 'Test',
    last_name: 'User',
    language_code: 'ru',
    is_active: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_activity: new Date().toISOString(),
    ...overrides
  }),
  
  // Helper to create mock patient
  createMockPatient: (overrides = {}) => ({
    id: 1,
    uuid: mockUuid,
    created_by: 1,
    name: 'Test Patient',
    age: 30,
    gender: 'female',
    background: 'Test background story for the patient.',
    personality_traits: JSON.stringify({
      core_traits: ['anxious', 'perfectionist'],
      communication_style: 'cautious'
    }),
    psychological_profile: JSON.stringify({
      presenting_problem: 'Test problem',
      symptoms: ['symptom1', 'symptom2']
    }),
    presenting_problem: 'Test problem',
    therapy_goals: JSON.stringify({
      primary: 'Test goal'
    }),
    system_prompt: 'Test system prompt',
    is_active: 1,
    created_at: new Date().toISOString(),
    ...overrides
  }),
  
  // Helper to create mock session
  createMockSession: (overrides = {}) => ({
    id: 1,
    uuid: mockUuid,
    user_id: 1,
    patient_id: 1,
    status: 'active',
    started_at: new Date().toISOString(),
    ended_at: null,
    duration_minutes: null,
    message_count: 0,
    therapist_notes: null,
    ...overrides
  }),
  
  // Helper to create mock message
  createMockMessage: (overrides = {}) => ({
    id: 1,
    session_id: 1,
    sender: 'therapist',
    content: 'Test message content',
    message_type: 'text',
    tokens_used: 0,
    response_time_ms: null,
    created_at: new Date().toISOString(),
    ...overrides
  }),
  
  // Helper to create mock Claude response
  createMockClaudeResponse: (overrides = {}) => ({
    content: 'Test Claude response',
    usage: {
      input_tokens: 100,
      output_tokens: 50
    },
    model: 'claude-3-5-sonnet-20241022',
    fromCache: false,
    responseTime: 1000,
    ...overrides
  }),
  
  // Helper to wait for async operations
  waitFor: (ms = 100) => new Promise(resolve => setTimeout(resolve, ms)),
  
  // Helper to suppress console output in tests
  suppressConsole: () => {
    const originalConsole = { ...console };
    global.console = {
      ...console,
      log: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };
    return () => {
      global.console = originalConsole;
    };
  }
};

export default testUtils;