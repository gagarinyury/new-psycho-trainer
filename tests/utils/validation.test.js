import { describe, test, expect } from '@jest/globals';
import {
  userSchema,
  patientCreationSchema,
  messageSchema,
  validateAndSanitize,
  ValidationError,
  sanitizeInput,
  isValidTelegramId,
  isValidUUID,
  validateRateLimit,
  validateContentSafety,
  validateSessionState
} from '../../src/utils/validation.js';

describe('Validation Utils', () => {
  describe('userSchema', () => {
    test('should validate correct user data', () => {
      const validUser = {
        telegram_id: 123456789,
        username: 'testuser',
        first_name: 'John',
        last_name: 'Doe',
        language_code: 'en'
      };

      const result = validateAndSanitize(validUser, userSchema);
      expect(result).toMatchObject(validUser);
    });

    test('should reject invalid telegram_id', () => {
      const invalidUser = {
        telegram_id: 'invalid',
        username: 'testuser'
      };

      expect(() => validateAndSanitize(invalidUser, userSchema))
        .toThrow(ValidationError);
    });

    test('should accept null optional fields', () => {
      const validUser = {
        telegram_id: 123456789,
        username: null,
        first_name: null,
        last_name: null
      };

      const result = validateAndSanitize(validUser, userSchema);
      expect(result.telegram_id).toBe(123456789);
      expect(result.language_code).toBe('ru'); // default value
    });
  });

  describe('patientCreationSchema', () => {
    test('should validate correct patient data', () => {
      const validPatient = {
        name: 'Anna Petrova',
        age: 28,
        gender: 'female',
        background: 'A detailed background story that meets minimum length requirements for validation purposes.',
        presenting_problem: 'Panic attacks at work causing significant distress',
        personality_traits: {
          core_traits: ['anxious', 'perfectionist'],
          communication_style: 'cautious'
        },
        psychological_profile: {
          presenting_problem: 'Anxiety disorder',
          symptoms: ['panic attacks', 'sweating']
        }
      };

      const result = validateAndSanitize(validPatient, patientCreationSchema);
      expect(result).toMatchObject(validPatient);
    });

    test('should reject invalid age', () => {
      const invalidPatient = {
        name: 'Test Patient',
        age: 15, // too young
        gender: 'female',
        background: 'Background story that is long enough for validation.',
        presenting_problem: 'Some problem',
        personality_traits: {},
        psychological_profile: {}
      };

      expect(() => validateAndSanitize(invalidPatient, patientCreationSchema))
        .toThrow(ValidationError);
    });

    test('should reject invalid gender', () => {
      const invalidPatient = {
        name: 'Test Patient',
        age: 25,
        gender: 'invalid',
        background: 'Background story that is long enough for validation.',
        presenting_problem: 'Some problem',
        personality_traits: {},
        psychological_profile: {}
      };

      expect(() => validateAndSanitize(invalidPatient, patientCreationSchema))
        .toThrow(ValidationError);
    });

    test('should reject short background', () => {
      const invalidPatient = {
        name: 'Test Patient',
        age: 25,
        gender: 'female',
        background: 'Too short', // less than 50 characters
        presenting_problem: 'Some problem',
        personality_traits: {},
        psychological_profile: {}
      };

      expect(() => validateAndSanitize(invalidPatient, patientCreationSchema))
        .toThrow(ValidationError);
    });
  });

  describe('messageSchema', () => {
    test('should validate correct message', () => {
      const validMessage = {
        content: 'Hello, how are you feeling today?',
        sender: 'therapist'
      };

      const result = validateAndSanitize(validMessage, messageSchema);
      expect(result).toMatchObject(validMessage);
    });

    test('should reject empty content', () => {
      const invalidMessage = {
        content: '',
        sender: 'therapist'
      };

      expect(() => validateAndSanitize(invalidMessage, messageSchema))
        .toThrow(ValidationError);
    });

    test('should reject invalid sender', () => {
      const invalidMessage = {
        content: 'Test message',
        sender: 'invalid'
      };

      expect(() => validateAndSanitize(invalidMessage, messageSchema))
        .toThrow(ValidationError);
    });

    test('should reject too long content', () => {
      const invalidMessage = {
        content: 'x'.repeat(1001), // too long
        sender: 'therapist'
      };

      expect(() => validateAndSanitize(invalidMessage, messageSchema))
        .toThrow(ValidationError);
    });
  });

  describe('sanitizeInput', () => {
    test('should remove dangerous characters', () => {
      const input = '<script>alert("xss")</script>';
      const result = sanitizeInput(input);
      expect(result).toBe('scriptalert(xss)/script');
    });

    test('should trim whitespace', () => {
      const input = '  hello world  ';
      const result = sanitizeInput(input);
      expect(result).toBe('hello world');
    });

    test('should limit length', () => {
      const input = 'x'.repeat(1500);
      const result = sanitizeInput(input);
      expect(result.length).toBe(1000);
    });

    test('should handle non-string input', () => {
      expect(sanitizeInput(123)).toBe(123);
      expect(sanitizeInput(null)).toBe(null);
      expect(sanitizeInput(undefined)).toBe(undefined);
    });
  });

  describe('isValidTelegramId', () => {
    test('should validate correct Telegram IDs', () => {
      expect(isValidTelegramId(123456789)).toBe(true);
      expect(isValidTelegramId(1)).toBe(true);
      expect(isValidTelegramId(9999999999)).toBe(true);
    });

    test('should reject invalid Telegram IDs', () => {
      expect(isValidTelegramId(0)).toBe(false);
      expect(isValidTelegramId(-1)).toBe(false);
      expect(isValidTelegramId(10000000000)).toBe(false);
      expect(isValidTelegramId('123')).toBe(false);
      expect(isValidTelegramId(123.45)).toBe(false);
    });
  });

  describe('isValidUUID', () => {
    test('should validate correct UUIDs', () => {
      const validUUIDs = [
        '550e8400-e29b-4d4b-a716-446655440000',
        '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        '6ba7b811-9dad-11d1-80b4-00c04fd430c8'
      ];

      validUUIDs.forEach(uuid => {
        expect(isValidUUID(uuid)).toBe(true);
      });
    });

    test('should reject invalid UUIDs', () => {
      const invalidUUIDs = [
        'invalid-uuid',
        '550e8400-e29b-4d4b-a716',
        '550e8400-e29b-4d4b-a716-446655440000-extra',
        '550e8400-e29b-5d4b-a716-446655440000', // wrong version
        'gggggggg-e29b-4d4b-a716-446655440000'  // invalid characters
      ];

      invalidUUIDs.forEach(uuid => {
        expect(isValidUUID(uuid)).toBe(false);
      });
    });
  });

  describe('validateRateLimit', () => {
    test('should allow requests within limit', () => {
      const now = Date.now();
      const requests = [now - 30000, now - 20000, now - 10000]; // 3 requests in last minute
      
      const result = validateRateLimit(requests, 60000, 5);
      expect(result).toBe(true);
    });

    test('should reject requests over limit', () => {
      const now = Date.now();
      const requests = [
        now - 50000, now - 40000, now - 30000, 
        now - 20000, now - 10000, now - 5000
      ]; // 6 requests in last minute
      
      const result = validateRateLimit(requests, 60000, 5);
      expect(result).toBe(false);
    });

    test('should ignore old requests outside window', () => {
      const now = Date.now();
      const requests = [
        now - 120000, now - 90000, // outside window
        now - 30000, now - 20000   // inside window
      ];
      
      const result = validateRateLimit(requests, 60000, 5);
      expect(result).toBe(true);
    });
  });

  describe('validateContentSafety', () => {
    test('should allow safe content', () => {
      const safeContent = 'Hello, how are you feeling today?';
      expect(validateContentSafety(safeContent)).toBe(true);
    });

    test('should detect dangerous script tags', () => {
      const dangerousContent = '<script>alert("xss")</script>';
      expect(validateContentSafety(dangerousContent)).toBe(false);
    });

    test('should detect javascript URLs', () => {
      const dangerousContent = 'javascript:alert("xss")';
      expect(validateContentSafety(dangerousContent)).toBe(false);
    });

    test('should detect event handlers', () => {
      const dangerousContent = '<img onload="alert(1)">';
      expect(validateContentSafety(dangerousContent)).toBe(false);
    });

    test('should detect eval attempts', () => {
      const dangerousContent = 'eval(maliciousCode)';
      expect(validateContentSafety(dangerousContent)).toBe(false);
    });
  });

  describe('validateSessionState', () => {
    test('should validate correct session state', () => {
      const validSession = {
        id: 1,
        userId: 123,
        patientId: 456,
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there' }
        ],
        startTime: Date.now()
      };

      expect(() => validateSessionState(validSession)).not.toThrow();
    });

    test('should reject missing required fields', () => {
      const invalidSession = {
        id: 1,
        userId: 123
        // missing patientId, messages, startTime
      };

      expect(() => validateSessionState(invalidSession))
        .toThrow(ValidationError);
    });

    test('should reject invalid messages array', () => {
      const invalidSession = {
        id: 1,
        userId: 123,
        patientId: 456,
        messages: 'not an array',
        startTime: Date.now()
      };

      expect(() => validateSessionState(invalidSession))
        .toThrow('Session messages must be an array');
    });

    test('should reject invalid start time', () => {
      const invalidSession = {
        id: 1,
        userId: 123,
        patientId: 456,
        messages: [],
        startTime: 'invalid'
      };

      expect(() => validateSessionState(invalidSession))
        .toThrow('Invalid session start time');
    });
  });

  describe('ValidationError', () => {
    test('should create error with message and details', () => {
      const details = [{ field: 'name', message: 'Required' }];
      const error = new ValidationError('Validation failed', details);

      expect(error.message).toBe('Validation failed');
      expect(error.name).toBe('ValidationError');
      expect(error.details).toEqual(details);
    });

    test('should create error without details', () => {
      const error = new ValidationError('Simple validation error');

      expect(error.message).toBe('Simple validation error');
      expect(error.details).toBeNull();
    });
  });
});