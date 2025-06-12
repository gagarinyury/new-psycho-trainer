import { randomUUID } from 'crypto';
import dbManager from '../database/Database.js';
import claudeService from './ClaudeService.js';
import userService from './UserService.js';
import logger from '../utils/logger.js';

class PatientService {
  constructor() {
    // Промт теперь генерируется динамически для каждого пациента
  }

  buildPatientGenerationPrompt() {
    // Add timestamp and strong randomization to prevent caching
    const timestamp = Date.now();
    const randomSeed = Math.random() * timestamp;
    const randomElements = [
      `Создай пациента ${Math.random() > 0.5 ? 'мужского' : 'женского'} пола`,
      `Возраст: ${16 + Math.floor(Math.random() * 74)} лет`,
      `Временная метка для уникальности: ${timestamp}`,
      `Случайное число: ${Math.floor(randomSeed % 50000)}`
    ];
    
    return `Ты - эксперт психолог и создатель реалистичных клинических случаев для обучения терапевтов.

ЗАДАЧА: Создай УНИКАЛЬНОГО детального AI-пациента для терапевтической практики.

ВАЖНО: Каждый пациент должен быть РАЗНЫМ! Используй разнообразие:
- Разные имена (русские и международные)
- Разные возрасты, полы, профессии  
- Разные психологические проблемы
- Разные культурные контексты

${randomElements.join('. ')}

ТРЕБОВАНИЯ:
1. Пациент должен быть реалистичным и многогранным
2. Проблемы должны быть типичными для психотерапевтической практики
3. Личность должна быть последовательной и правдоподобной
4. Включи защитные механизмы и способы взаимодействия
5. ОБЯЗАТЕЛЬНО используй разнообразные имена и характеристики

ФОРМАТ ОТВЕТА (строго JSON):
{
  "name": "Имя пациента",
  "age": число,
  "gender": "male/female/other",
  "background": "Подробная биография и контекст жизни",
  "personality_traits": {
    "core_traits": ["черта1", "черта2", "черта3"],
    "communication_style": "стиль общения",
    "defense_mechanisms": ["защита1", "защита2"],
    "triggers": ["триггер1", "триггер2"],
    "strengths": ["сила1", "сила2"]
  },
  "psychological_profile": {
    "presenting_problem": "основная проблема",
    "symptoms": ["симптом1", "симптом2"],
    "duration": "длительность проблемы",
    "severity": "mild/moderate/severe",
    "previous_therapy": "опыт предыдущей терапии",
    "motivation_level": "low/medium/high"
  },
  "therapy_goals": {
    "primary": "основная цель",
    "secondary": ["вторичная цель 1", "вторичная цель 2"],
    "client_expectations": "ожидания от терапии"
  },
  "interaction_patterns": {
    "typical_responses": ["типичный ответ 1", "типичный ответ 2"],
    "resistance_patterns": ["паттерн сопротивления 1"],
    "engagement_style": "стиль вовлечения"
  }
}

Создай пациента ТОЛЬКО в этом JSON формате, без дополнительного текста.`;
  }

  async createRandomPatient(userId, customDescription = null) {
    try {
      logger.info('Generating random patient', { userId, hasCustomDescription: !!customDescription });

      // Генерируем новый уникальный промт для каждого пациента
      let prompt = this.buildPatientGenerationPrompt();
      
      if (customDescription) {
        prompt += `\n\nДОПОЛНИТЕЛЬНЫЕ ТРЕБОВАНИЯ: ${customDescription}`;
      }

      const response = await claudeService.sendMessage(
        [{ role: 'user', content: prompt }],
        null,
        { 
          userId: userId || 'system', 
          cacheType: 'system',
          enableCache: false // Don't cache patient generation for uniqueness
        }
      );

      // Parse the JSON response
      let patientData;
      try {
        patientData = JSON.parse(response.content);
      } catch (parseError) {
        logger.error('Failed to parse patient JSON', { 
          error: parseError.message, 
          content: response.content 
        });
        throw new Error('Failed to generate patient data');
      }

      // Validate required fields
      this.validatePatientData(patientData);

      // Generate system prompt for this patient
      const systemPrompt = this.generateSystemPrompt(patientData, userId);

      // Save to database
      const patientUuid = randomUUID();
      const patient = await this.savePatient(patientUuid, userId, patientData, systemPrompt);

      logger.info('Patient created successfully', { 
        patientId: patient.id, 
        uuid: patientUuid,
        name: patientData.name 
      });

      return patient;

    } catch (error) {
      logger.error('Error creating patient', { error: error.message, userId });
      throw error;
    }
  }

  validatePatientData(data) {
    const required = ['name', 'age', 'gender', 'background', 'personality_traits', 'psychological_profile'];
    const missing = required.filter(field => !data[field]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required patient fields: ${missing.join(', ')}`);
    }

    if (data.age < 16 || data.age > 90) {
      throw new Error('Patient age must be between 16 and 90');
    }

    if (!['male', 'female', 'other'].includes(data.gender)) {
      throw new Error('Invalid gender value');
    }
  }

  generateSystemPrompt(patientData, userId) {
    const showNonverbal = userService.getUserNonverbalSetting(userId);
    
    const nonverbalRules = showNonverbal ? `
11. Иногда добавляй краткие невербальные действия в формате *действие*
    Примеры: *вздохнула*, *отвернулась*, *сжала руки*, *долгая пауза*, *напряглась*, 
    *прячет взгляд*, *выпрямила спину*, *говорит тише*, *нервно смеется*
12. Невербалика должна быть естественной и соответствовать твоему эмоциональному состоянию
13. Не переусердствуй с невербаликой - 1-2 действия на ответ максимум` : `
11. Отвечай только словами, без описания действий, жестов или невербального поведения`;

    return `Ты играешь роль клиента на психотерапевтической сессии. Вот твоя личность и ситуация:

ОСНОВНАЯ ИНФОРМАЦИЯ:
- Имя: ${patientData.name}
- Возраст: ${patientData.age} лет
- Пол: ${patientData.gender === 'male' ? 'мужской' : patientData.gender === 'female' ? 'женский' : 'другой'}

БИОГРАФИЯ И КОНТЕКСТ:
${patientData.background}

ЛИЧНОСТНЫЕ ОСОБЕННОСТИ:
${JSON.stringify(patientData.personality_traits, null, 2)}

ПСИХОЛОГИЧЕСКИЙ ПРОФИЛЬ:
${JSON.stringify(patientData.psychological_profile, null, 2)}

ЦЕЛИ ТЕРАПИИ:
${JSON.stringify(patientData.therapy_goals, null, 2)}

ПРАВИЛА ПОВЕДЕНИЯ:
1. Отвечай как живой человек, не как AI
2. Будь естественным и непредсказуемым
3. Используй свои защитные механизмы когда чувствуешь угрозу
4. Показывай эмоции и реакции соответственно своей личности
5. Не давай готовые ответы - исследуй тему постепенно
6. Иногда сопротивляйся или отвлекайся
7. Будь человечным - с противоречиями и сложностями
8. Говори на русском языке
9. Не раскрывай сразу все проблемы - делай это постепенно
10. Реагируй на стиль терапевта и подстраивайся под него${nonverbalRules}

ПЕРВАЯ ВСТРЕЧА:
- Это ваш первый визит к этому терапевту
- Начните сессию с приветствия, которое отражает вашу личность и эмоциональное состояние
- Покажите свое отношение к терапии через первые слова
- Будьте естественным - как бы вы реально зашли к незнакомому психологу

Примеры стилей приветствия:
- Неуверенный: "Здравствуйте... можно войти?"
- Деловой: "Добрый день! Спасибо что приняли"
- Тревожный: "Извините... я впервые у психолога..."
- Скептичный: "Здравствуйте. Надеюсь, это поможет..."

Начинай каждую сессию с того места, где закончилась предыдущая. Если это первая встреча, отвечай приветствием соответствующим твоей личности.`;
  }

  async savePatient(uuid, userId, patientData, systemPrompt) {
    try {
      const insertPatient = dbManager.prepare(`
        INSERT INTO patients 
        (uuid, created_by, name, age, gender, background, personality_traits, 
         psychological_profile, presenting_problem, therapy_goals, system_prompt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = insertPatient.run(
        uuid,
        userId,
        patientData.name,
        patientData.age,
        patientData.gender,
        patientData.background,
        JSON.stringify(patientData.personality_traits),
        JSON.stringify(patientData.psychological_profile),
        patientData.psychological_profile.presenting_problem,
        JSON.stringify(patientData.therapy_goals),
        systemPrompt
      );

      // Fetch the complete patient record
      const patient = this.getPatientById(result.lastInsertRowid);
      return patient;

    } catch (error) {
      logger.error('Error saving patient to database', { error: error.message });
      throw new Error('Failed to save patient');
    }
  }

  getPatientById(patientId) {
    try {
      const patient = dbManager.prepare(`
        SELECT * FROM patients WHERE id = ? AND is_active = 1
      `).get(patientId);

      if (!patient) {
        return null;
      }

      // Parse JSON fields
      return {
        ...patient,
        personality_traits: JSON.parse(patient.personality_traits),
        psychological_profile: JSON.parse(patient.psychological_profile),
        therapy_goals: JSON.parse(patient.therapy_goals)
      };
    } catch (error) {
      logger.error('Error fetching patient', { error: error.message, patientId });
      return null;
    }
  }

  getPatientByUuid(uuid) {
    try {
      const patient = dbManager.prepare(`
        SELECT * FROM patients WHERE uuid = ? AND is_active = 1
      `).get(uuid);

      if (!patient) {
        return null;
      }

      return {
        ...patient,
        personality_traits: JSON.parse(patient.personality_traits),
        psychological_profile: JSON.parse(patient.psychological_profile),
        therapy_goals: JSON.parse(patient.therapy_goals)
      };
    } catch (error) {
      logger.error('Error fetching patient by UUID', { error: error.message, uuid });
      return null;
    }
  }

  getUserPatients(userId, limit = 20, offset = 0) {
    try {
      const patients = dbManager.prepare(`
        SELECT 
          id, uuid, name, age, gender, presenting_problem, 
          created_at, 
          (SELECT COUNT(*) FROM sessions WHERE patient_id = patients.id) as session_count
        FROM patients 
        WHERE created_by = ? AND is_active = 1
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `).all(userId, limit, offset);

      return patients;
    } catch (error) {
      logger.error('Error fetching user patients', { error: error.message, userId });
      return [];
    }
  }

  async deactivatePatient(patientId, userId) {
    try {
      const result = dbManager.prepare(`
        UPDATE patients 
        SET is_active = 0 
        WHERE id = ? AND created_by = ?
      `).run(patientId, userId);

      return result.changes > 0;
    } catch (error) {
      logger.error('Error deactivating patient', { error: error.message, patientId });
      return false;
    }
  }

  getPatientStats(patientId) {
    try {
      const stats = dbManager.prepare(`
        SELECT 
          COUNT(*) as total_sessions,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_sessions,
          AVG(duration_minutes) as avg_session_duration,
          SUM(message_count) as total_messages,
          MAX(started_at) as last_session
        FROM sessions 
        WHERE patient_id = ?
      `).get(patientId);

      return stats;
    } catch (error) {
      logger.error('Error fetching patient stats', { error: error.message, patientId });
      return null;
    }
  }
}

const patientService = new PatientService();
export default patientService;