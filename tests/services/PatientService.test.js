import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import PatientService from '../../src/services/PatientService.js';
import dbManager from '../../src/database/Database.js';
import claudeService from '../../src/services/ClaudeService.js';

// Mock dependencies
jest.mock('../../src/database/Database.js');
jest.mock('../../src/services/ClaudeService.js');
jest.mock('../../src/utils/logger.js');

describe('PatientService', () => {
  let patientService;
  let mockDbPrepare;
  let mockDbRun;
  let mockDbGet;

  beforeEach(() => {
    patientService = new PatientService();
    
    // Mock database methods
    mockDbRun = jest.fn();
    mockDbGet = jest.fn();
    mockDbPrepare = jest.fn(() => ({
      run: mockDbRun,
      get: mockDbGet,
      all: jest.fn()
    }));
    
    dbManager.prepare = mockDbPrepare;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createRandomPatient', () => {
    test('should create a patient successfully', async () => {
      // Mock Claude API response
      const mockPatientData = {
        name: 'Анна Петрова',
        age: 28,
        gender: 'female',
        background: 'Молодая женщина, работающая в IT сфере. Испытывает стресс от высоких нагрузок.',
        personality_traits: {
          core_traits: ['тревожная', 'перфекционистка', 'интровертная'],
          communication_style: 'осторожный, детальный',
          defense_mechanisms: ['рационализация', 'избегание']
        },
        psychological_profile: {
          presenting_problem: 'Панические атаки на работе',
          symptoms: ['учащенное сердцебиение', 'потливость', 'страх потери контроля'],
          duration: '3 месяца',
          severity: 'moderate'
        },
        therapy_goals: {
          primary: 'Научиться управлять тревожностью',
          secondary: ['улучшить рабочие отношения', 'развить стрессоустойчивость']
        }
      };

      claudeService.sendMessage.mockResolvedValue({
        content: JSON.stringify(mockPatientData),
        usage: { input_tokens: 100, output_tokens: 200 }
      });

      mockDbRun.mockReturnValue({ lastInsertRowid: 1 });
      mockDbGet.mockReturnValue({
        id: 1,
        uuid: 'test-uuid',
        name: 'Анна Петрова',
        age: 28,
        gender: 'female',
        background: mockPatientData.background,
        personality_traits: JSON.stringify(mockPatientData.personality_traits),
        psychological_profile: JSON.stringify(mockPatientData.psychological_profile),
        therapy_goals: JSON.stringify(mockPatientData.therapy_goals),
        presenting_problem: mockPatientData.psychological_profile.presenting_problem
      });

      const result = await patientService.createRandomPatient(123);

      expect(claudeService.sendMessage).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('Создай детального AI-пациента')
          })
        ]),
        null,
        expect.objectContaining({
          userId: 123,
          cacheType: 'system',
          enableCache: false
        })
      );

      expect(mockDbPrepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO patients')
      );

      expect(result).toMatchObject({
        id: 1,
        name: 'Анна Петрова',
        age: 28,
        gender: 'female'
      });
    });

    test('should handle invalid JSON response', async () => {
      claudeService.sendMessage.mockResolvedValue({
        content: 'Invalid JSON response',
        usage: { input_tokens: 100, output_tokens: 50 }
      });

      await expect(patientService.createRandomPatient(123))
        .rejects
        .toThrow('Failed to generate patient data');
    });

    test('should validate patient data', async () => {
      const invalidPatientData = {
        name: 'Test',
        age: 15, // Invalid age
        gender: 'invalid', // Invalid gender
        background: 'Too short' // Too short background
      };

      claudeService.sendMessage.mockResolvedValue({
        content: JSON.stringify(invalidPatientData)
      });

      await expect(patientService.createRandomPatient(123))
        .rejects
        .toThrow();
    });
  });

  describe('validatePatientData', () => {
    test('should validate correct patient data', () => {
      const validData = {
        name: 'John Doe',
        age: 30,
        gender: 'male',
        background: 'A detailed background story that is long enough for validation.',
        personality_traits: { core_traits: ['trait1'] },
        psychological_profile: { presenting_problem: 'Some problem' }
      };

      expect(() => patientService.validatePatientData(validData)).not.toThrow();
    });

    test('should reject missing required fields', () => {
      const invalidData = {
        name: 'John Doe',
        age: 30
        // Missing required fields
      };

      expect(() => patientService.validatePatientData(invalidData))
        .toThrow('Missing required patient fields');
    });

    test('should reject invalid age', () => {
      const invalidData = {
        name: 'John Doe',
        age: 15, // Too young
        gender: 'male',
        background: 'A detailed background story.',
        personality_traits: { core_traits: ['trait1'] },
        psychological_profile: { presenting_problem: 'Some problem' }
      };

      expect(() => patientService.validatePatientData(invalidData))
        .toThrow('Patient age must be between 16 and 90');
    });

    test('should reject invalid gender', () => {
      const invalidData = {
        name: 'John Doe',
        age: 30,
        gender: 'invalid',
        background: 'A detailed background story.',
        personality_traits: { core_traits: ['trait1'] },
        psychological_profile: { presenting_problem: 'Some problem' }
      };

      expect(() => patientService.validatePatientData(invalidData))
        .toThrow('Invalid gender value');
    });
  });

  describe('generateSystemPrompt', () => {
    test('should generate proper system prompt', () => {
      const patientData = {
        name: 'Anna Petrova',
        age: 28,
        gender: 'female',
        background: 'IT worker with stress issues',
        personality_traits: {
          core_traits: ['anxious', 'perfectionist']
        },
        psychological_profile: {
          presenting_problem: 'Panic attacks at work'
        },
        therapy_goals: {
          primary: 'Learn anxiety management'
        }
      };

      const prompt = patientService.generateSystemPrompt(patientData);

      expect(prompt).toContain('Anna Petrova');
      expect(prompt).toContain('28 лет');
      expect(prompt).toContain('женский');
      expect(prompt).toContain('IT worker with stress issues');
      expect(prompt).toContain('Panic attacks at work');
      expect(prompt).toContain('Learn anxiety management');
      expect(prompt).toContain('Отвечай как живой человек');
    });
  });

  describe('getPatientById', () => {
    test('should return patient with parsed JSON fields', () => {
      const mockPatient = {
        id: 1,
        name: 'Test Patient',
        personality_traits: '{"core_traits":["trait1"]}',
        psychological_profile: '{"presenting_problem":"problem"}',
        therapy_goals: '{"primary":"goal"}'
      };

      mockDbGet.mockReturnValue(mockPatient);

      const result = patientService.getPatientById(1);

      expect(result).toMatchObject({
        id: 1,
        name: 'Test Patient',
        personality_traits: { core_traits: ['trait1'] },
        psychological_profile: { presenting_problem: 'problem' },
        therapy_goals: { primary: 'goal' }
      });
    });

    test('should return null for non-existent patient', () => {
      mockDbGet.mockReturnValue(null);

      const result = patientService.getPatientById(999);

      expect(result).toBeNull();
    });
  });

  describe('getUserPatients', () => {
    test('should return list of user patients', () => {
      const mockPatients = [
        {
          id: 1,
          uuid: 'uuid1',
          name: 'Patient 1',
          age: 25,
          gender: 'female',
          presenting_problem: 'Problem 1',
          created_at: '2025-01-01',
          session_count: 3
        },
        {
          id: 2,
          uuid: 'uuid2',
          name: 'Patient 2',
          age: 30,
          gender: 'male',
          presenting_problem: 'Problem 2',
          created_at: '2025-01-02',
          session_count: 1
        }
      ];

      const mockDbAll = jest.fn().mockReturnValue(mockPatients);
      mockDbPrepare.mockReturnValue({ all: mockDbAll });

      const result = patientService.getUserPatients(123, 10, 0);

      expect(mockDbPrepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT')
      );
      expect(mockDbAll).toHaveBeenCalledWith(123, 10, 0);
      expect(result).toEqual(mockPatients);
    });
  });

  describe('deactivatePatient', () => {
    test('should deactivate patient successfully', async () => {
      mockDbRun.mockReturnValue({ changes: 1 });

      const result = await patientService.deactivatePatient(1, 123);

      expect(mockDbPrepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE patients SET is_active = 0')
      );
      expect(mockDbRun).toHaveBeenCalledWith(1, 123);
      expect(result).toBe(true);
    });

    test('should return false if no changes made', async () => {
      mockDbRun.mockReturnValue({ changes: 0 });

      const result = await patientService.deactivatePatient(999, 123);

      expect(result).toBe(false);
    });
  });
});