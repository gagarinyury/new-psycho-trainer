import { randomUUID } from 'crypto';
import dbManager from '../database/Database.js';
import claudeService from './ClaudeService.js';
import patientService from './PatientService.js';
import logger from '../utils/logger.js';

class SessionService {
  constructor() {
    this.activeSessions = new Map(); // In-memory session state
    this.supervisorPrompt = this.buildSupervisorPrompt();
    this.inactivityTimers = new Map(); // Track inactivity timers
    this.inactivityWarnings = new Map(); // Track warning states
    this.INACTIVITY_WARNING_TIME = 5 * 60 * 1000; // 5 minutes
    this.INACTIVITY_END_TIME = 10 * 60 * 1000; // 10 minutes
  }

  buildSupervisorPrompt() {
    return `Ты - опытный супервизор психотерапевтов с 20+ летним стажем. Твоя задача - проанализировать терапевтическую сессию и дать конструктивную обратную связь.

АНАЛИЗИРУЙ:
1. Технические навыки терапевта
2. Качество терапевтических интервенций
3. Установление раппорта с клиентом
4. Соблюдение этических границ
5. Эффективность выбранных техник

ФОРМАТ АНАЛИЗА (JSON):
{
  "overall_rating": число от 1 до 10,
  "strengths": ["сильная сторона 1", "сильная сторона 2"],
  "areas_for_improvement": ["область для улучшения 1", "область для улучшения 2"],
  "specific_feedback": {
    "rapport_building": "комментарий о построении раппорта",
    "intervention_quality": "комментарий о качестве интервенций",
    "therapeutic_technique": "комментарий о терапевтической технике",
    "ethical_considerations": "комментарий об этических аспектах"
  },
  "recommendations": [
    "конкретная рекомендация 1",
    "конкретная рекомендация 2"
  ],
  "key_moments": [
    "важный момент 1 в сессии",
    "важный момент 2 в сессии"
  ]
}

Давай развернутый, но конструктивный анализ. Фокусируйся на обучении и развитии навыков.`;
  }

  async createSession(userId, patientId, options = {}) {
    try {
      const patient = patientService.getPatientById(patientId);
      if (!patient) {
        throw new Error('Patient not found');
      }

      // Check if user has access to this patient
      if (patient.created_by !== userId) {
        throw new Error('Access denied to this patient');
      }

      const sessionUuid = randomUUID();
      
      const insertSession = dbManager.prepare(`
        INSERT INTO sessions (uuid, user_id, patient_id, status, started_at)
        VALUES (?, ?, ?, 'active', datetime('now'))
      `);

      const result = insertSession.run(sessionUuid, userId, patientId);
      const sessionId = result.lastInsertRowid;

      // Initialize session state
      this.activeSessions.set(sessionUuid, {
        id: sessionId,
        userId,
        patientId,
        patient,
        messages: options.previousMessages || [],
        startTime: Date.now(),
        lastActivity: Date.now(),
        isNewWeek: options.isNewWeek || false
      });

      // Start inactivity monitoring
      this.startInactivityMonitoring(sessionUuid, userId);

      logger.info('Session created', { 
        sessionId, 
        sessionUuid, 
        userId, 
        patientId,
        isNewWeek: options.isNewWeek || false,
        hasContext: (options.previousMessages || []).length > 0
      });

      return {
        id: sessionId,
        uuid: sessionUuid,
        patient: {
          id: patient.id,
          name: patient.name,
          age: patient.age,
          presenting_problem: patient.presenting_problem
        }
      };

    } catch (error) {
      logger.error('Error creating session', { error: error.message, userId, patientId });
      throw error;
    }
  }

  async sendMessage(sessionUuid, sender, content) {
    try {
      const session = this.activeSessions.get(sessionUuid);
      if (!session) {
        throw new Error('Session not found or inactive');
      }

      // Update activity timestamp
      session.lastActivity = Date.now();
      this.resetInactivityTimer(sessionUuid, session.userId);

      const startTime = Date.now();

      // Save user message
      await this.saveMessage(session.id, sender, content);
      
      // Add to session history
      session.messages.push({
        role: sender === 'therapist' ? 'user' : 'assistant',
        content: content
      });

      let response = null;
      let responseTime = 0;

      if (sender === 'therapist') {
        // Get AI patient response
        const claudeResponse = await claudeService.sendMessage(
          session.messages,
          session.patient.system_prompt,
          { 
            userId: session.userId,
            cacheType: 'conversation',
            enableCache: true,
            sessionId: sessionUuid,
            isNewWeek: session.isNewWeek || false
          }
        );

        response = claudeResponse.content;
        responseTime = Date.now() - startTime;

        // Save AI response
        await this.saveMessage(session.id, 'patient', response, {
          tokensUsed: claudeResponse.usage?.output_tokens || 0,
          responseTime
        });

        // Add to session history
        session.messages.push({
          role: 'assistant',
          content: response
        });
      }

      return {
        response,
        responseTime,
        messageCount: session.messages.length
      };

    } catch (error) {
      logger.error('Error sending message', { error: error.message, sessionUuid, sender });
      throw error;
    }
  }

  async saveMessage(sessionId, sender, content, metadata = {}) {
    try {
      const insertMessage = dbManager.prepare(`
        INSERT INTO messages (session_id, sender, content, tokens_used, response_time_ms)
        VALUES (?, ?, ?, ?, ?)
      `);

      insertMessage.run(
        sessionId,
        sender,
        content,
        metadata.tokensUsed || 0,
        metadata.responseTime || null
      );

    } catch (error) {
      logger.error('Error saving message', { error: error.message, sessionId });
      throw error;
    }
  }

  async endSession(sessionUuid, therapistNotes = null) {
    try {
      const session = this.activeSessions.get(sessionUuid);
      if (!session) {
        throw new Error('Session not found');
      }

      const duration = Math.round((Date.now() - session.startTime) / 1000 / 60); // minutes

      // Update session in database
      const updateSession = dbManager.prepare(`
        UPDATE sessions 
        SET status = 'completed', ended_at = datetime('now'), 
            duration_minutes = ?, therapist_notes = ?
        WHERE id = ?
      `);

      updateSession.run(duration, therapistNotes, session.id);

      // Clear inactivity monitoring and remove from active sessions
      this.clearInactivityTimer(sessionUuid);
      this.clearInactivityWarning(sessionUuid);
      this.activeSessions.delete(sessionUuid);

      logger.info('Session ended', { 
        sessionUuid, 
        duration, 
        messageCount: session.messages.length 
      });

      return {
        sessionId: session.id,
        duration,
        messageCount: session.messages.length
      };

    } catch (error) {
      logger.error('Error ending session', { error: error.message, sessionUuid });
      throw error;
    }
  }

  async analyzeSession(sessionId, userId) {
    try {
      // Get session messages
      const messages = dbManager.prepare(`
        SELECT sender, content, created_at 
        FROM messages 
        WHERE session_id = ? 
        ORDER BY created_at ASC
      `).all(sessionId);

      if (messages.length === 0) {
        throw new Error('No messages found for this session');
      }

      // Get session info
      const sessionInfo = dbManager.prepare(`
        SELECT s.*, p.name as patient_name, p.presenting_problem
        FROM sessions s
        JOIN patients p ON s.patient_id = p.id
        WHERE s.id = ? AND s.user_id = ?
      `).get(sessionId, userId);

      if (!sessionInfo) {
        throw new Error('Session not found or access denied');
      }

      // Format conversation for analysis
      const conversation = messages.map(msg => 
        `${msg.sender === 'therapist' ? 'Терапевт' : 'Клиент'}: ${msg.content}`
      ).join('\n\n');

      const analysisPrompt = `Проанализируй эту терапевтическую сессию:

ИНФОРМАЦИЯ О КЛИЕНТЕ:
- Имя: ${sessionInfo.patient_name}
- Основная проблема: ${sessionInfo.presenting_problem}
- Длительность сессии: ${sessionInfo.duration_minutes} минут

ДИАЛОГ:
${conversation}

${this.supervisorPrompt}`;

      const analysis = await claudeService.sendMessage(
        [{ role: 'user', content: analysisPrompt }],
        null,
        { 
          userId, 
          cacheType: 'analysis',
          enableCache: true
        }
      );

      // Parse analysis JSON (handle extra text after JSON)
      let analysisData;
      try {
        let jsonContent = analysis.content.trim();
        
        // Find JSON boundaries
        const jsonStart = jsonContent.indexOf('{');
        const jsonEnd = jsonContent.lastIndexOf('}') + 1;
        
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
          jsonContent = jsonContent.substring(jsonStart, jsonEnd);
        }
        
        analysisData = JSON.parse(jsonContent);
      } catch (parseError) {
        logger.error('Failed to parse analysis JSON', { 
          error: parseError.message,
          content: analysis.content.substring(0, 500) + '...'
        });
        
        // Fallback analysis
        analysisData = {
          overall_rating: 7,
          strengths: ['Сессия проведена профессионально'],
          areas_for_improvement: ['Анализ временно недоступен'],
          specific_feedback: {
            rapport_building: 'Анализ в процессе обработки',
            intervention_quality: 'Анализ в процессе обработки',
            therapeutic_technique: 'Анализ в процессе обработки',
            ethical_considerations: 'Анализ в процессе обработки'
          },
          recommendations: ['Продолжайте развивать терапевтические навыки'],
          key_moments: ['Успешное проведение сессии']
        };
      }

      // Save analysis to database
      await this.saveAnalysis(sessionId, 'supervisor', analysisData);

      logger.info('Session analysis completed', { sessionId, rating: analysisData.overall_rating });

      return analysisData;

    } catch (error) {
      logger.error('Error analyzing session', { error: error.message, sessionId });
      throw error;
    }
  }

  async saveAnalysis(sessionId, analysisType, analysisData) {
    try {
      const insertAnalysis = dbManager.prepare(`
        INSERT INTO session_analyses 
        (session_id, analysis_type, content, recommendations, rating, strengths, areas_for_improvement)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      insertAnalysis.run(
        sessionId,
        analysisType,
        JSON.stringify(analysisData),
        JSON.stringify(analysisData.recommendations || []),
        analysisData.overall_rating || null,
        JSON.stringify(analysisData.strengths || []),
        JSON.stringify(analysisData.areas_for_improvement || [])
      );

    } catch (error) {
      logger.error('Error saving analysis', { error: error.message, sessionId });
      throw error;
    }
  }

  getActiveSession(userId) {
    for (const [uuid, session] of this.activeSessions.entries()) {
      if (session.userId === userId) {
        return { uuid, ...session };
      }
    }
    return null;
  }

  getSessionHistory(userId, limit = 10, offset = 0) {
    try {
      const sessions = dbManager.prepare(`
        SELECT 
          s.id, s.uuid, s.status, s.started_at, s.ended_at, s.duration_minutes, s.message_count,
          p.name as patient_name, p.presenting_problem,
          sa.rating, sa.analysis_type
        FROM sessions s
        JOIN patients p ON s.patient_id = p.id
        LEFT JOIN session_analyses sa ON s.id = sa.session_id AND sa.analysis_type = 'supervisor'
        WHERE s.user_id = ?
        ORDER BY s.started_at DESC
        LIMIT ? OFFSET ?
      `).all(userId, limit, offset);

      return sessions;
    } catch (error) {
      logger.error('Error fetching session history', { error: error.message, userId });
      return [];
    }
  }

  getSessionDetails(sessionId, userId) {
    try {
      const session = dbManager.prepare(`
        SELECT 
          s.*, 
          p.name as patient_name, p.age, p.gender, p.presenting_problem,
          p.personality_traits, p.psychological_profile
        FROM sessions s
        JOIN patients p ON s.patient_id = p.id
        WHERE s.id = ? AND s.user_id = ?
      `).get(sessionId, userId);

      if (!session) {
        return null;
      }

      const messages = dbManager.prepare(`
        SELECT sender, content, created_at, tokens_used, response_time_ms
        FROM messages 
        WHERE session_id = ? 
        ORDER BY created_at ASC
      `).all(sessionId);

      const analysis = dbManager.prepare(`
        SELECT content, rating, strengths, areas_for_improvement, recommendations, created_at
        FROM session_analyses 
        WHERE session_id = ? AND analysis_type = 'supervisor'
        ORDER BY created_at DESC
        LIMIT 1
      `).get(sessionId);

      return {
        session: {
          ...session,
          personality_traits: JSON.parse(session.personality_traits),
          psychological_profile: JSON.parse(session.psychological_profile)
        },
        messages,
        analysis: analysis ? {
          ...analysis,
          content: JSON.parse(analysis.content),
          strengths: JSON.parse(analysis.strengths),
          areas_for_improvement: JSON.parse(analysis.areas_for_improvement),
          recommendations: JSON.parse(analysis.recommendations)
        } : null
      };

    } catch (error) {
      logger.error('Error fetching session details', { error: error.message, sessionId });
      return null;
    }
  }

  // Start inactivity monitoring for a session
  startInactivityMonitoring(sessionUuid, userId) {
    // Clear any existing timers
    this.clearInactivityTimer(sessionUuid);

    // Set warning timer
    const warningTimer = setTimeout(() => {
      this.handleInactivityWarning(sessionUuid, userId);
    }, this.INACTIVITY_WARNING_TIME);

    // Set end timer
    const endTimer = setTimeout(() => {
      this.handleInactivityEnd(sessionUuid, userId);
    }, this.INACTIVITY_END_TIME);

    this.inactivityTimers.set(sessionUuid, { warningTimer, endTimer });
  }

  // Reset inactivity timer when user is active
  resetInactivityTimer(sessionUuid, userId) {
    this.clearInactivityTimer(sessionUuid);
    this.clearInactivityWarning(sessionUuid);
    this.startInactivityMonitoring(sessionUuid, userId);
  }

  // Clear inactivity timers
  clearInactivityTimer(sessionUuid) {
    const timers = this.inactivityTimers.get(sessionUuid);
    if (timers) {
      clearTimeout(timers.warningTimer);
      clearTimeout(timers.endTimer);
      this.inactivityTimers.delete(sessionUuid);
    }
  }

  // Clear inactivity warning state
  clearInactivityWarning(sessionUuid) {
    this.inactivityWarnings.delete(sessionUuid);
  }

  // Handle inactivity warning (5 minutes)
  async handleInactivityWarning(sessionUuid, userId) {
    try {
      const session = this.activeSessions.get(sessionUuid);
      if (!session) return;

      // Mark warning as sent
      this.inactivityWarnings.set(sessionUuid, {
        warningSent: true,
        warningTime: Date.now()
      });

      // Trigger warning callback if set
      if (this.onInactivityWarning) {
        await this.onInactivityWarning(sessionUuid, userId, session);
      }

      logger.info('Inactivity warning triggered', { sessionUuid, userId });
    } catch (error) {
      logger.error('Error handling inactivity warning', { error: error.message, sessionUuid });
    }
  }

  // Handle inactivity end (10 minutes)
  async handleInactivityEnd(sessionUuid, userId) {
    try {
      const session = this.activeSessions.get(sessionUuid);
      if (!session) return;

      // End session due to inactivity
      await this.endSession(sessionUuid, 'Session ended due to inactivity');

      // Trigger end callback if set
      if (this.onInactivityEnd) {
        await this.onInactivityEnd(sessionUuid, userId, session);
      }

      logger.info('Session ended due to inactivity', { sessionUuid, userId });
    } catch (error) {
      logger.error('Error handling inactivity end', { error: error.message, sessionUuid });
    }
  }

  // Set callback for inactivity warning
  setInactivityWarningCallback(callback) {
    this.onInactivityWarning = callback;
  }

  // Set callback for inactivity end
  setInactivityEndCallback(callback) {
    this.onInactivityEnd = callback;
  }

  // Handle continue session callback
  async handleContinueSession(sessionUuid) {
    const session = this.activeSessions.get(sessionUuid);
    if (session) {
      session.lastActivity = Date.now();
      this.resetInactivityTimer(sessionUuid, session.userId);
      this.clearInactivityWarning(sessionUuid);
      logger.info('Session continued by user', { sessionUuid });
      return true;
    }
    return false;
  }

  // Handle pause session callback
  async handlePauseSession(sessionUuid, pauseDuration = 15 * 60 * 1000) { // 15 minutes default
    const session = this.activeSessions.get(sessionUuid);
    if (session) {
      session.lastActivity = Date.now();
      this.clearInactivityTimer(sessionUuid);
      this.clearInactivityWarning(sessionUuid);
      
      // Set extended timer for pause
      const pauseTimer = setTimeout(() => {
        this.handleInactivityWarning(sessionUuid, session.userId);
      }, pauseDuration);

      this.inactivityTimers.set(sessionUuid, { pauseTimer });
      logger.info('Session paused by user', { sessionUuid, pauseDuration });
      return true;
    }
    return false;
  }

  // Cleanup inactive sessions periodically
  cleanupInactiveSessions() {
    const now = Date.now();
    const maxInactiveTime = 2 * 60 * 60 * 1000; // 2 hours

    for (const [uuid, session] of this.activeSessions.entries()) {
      if (now - session.startTime > maxInactiveTime) {
        logger.info('Cleaning up inactive session', { sessionUuid: uuid });
        this.clearInactivityTimer(uuid);
        this.activeSessions.delete(uuid);
        
        // Mark session as cancelled in database
        dbManager.prepare(`
          UPDATE sessions 
          SET status = 'cancelled', ended_at = datetime('now')
          WHERE id = ?
        `).run(session.id);
      }
    }
  }

  // Start new week session with previous context
  async startNewWeekSession(userId, patientId, previousSessionId) {
    try {
      // Load previous session messages for context
      const previousSession = dbManager.prepare(`
        SELECT uuid FROM sessions 
        WHERE id = ? AND user_id = ?
      `).get(previousSessionId, userId);

      if (!previousSession) {
        throw new Error('Previous session not found');
      }

      const previousMessages = await claudeService.loadConversationFromDB(previousSession.uuid);

      // Create new session with previous context
      const newSession = await this.createSession(userId, patientId, { 
        isNewWeek: true,
        previousMessages: previousMessages
      });

      logger.info('New week session started', { 
        sessionId: newSession.id,
        sessionUuid: newSession.uuid,
        userId, 
        patientId,
        previousSessionId,
        contextMessages: previousMessages.length
      });

      return newSession;
      
    } catch (error) {
      logger.error('Error starting new week session', { 
        error: error.message, 
        userId, 
        patientId, 
        previousSessionId 
      });
      throw error;
    }
  }

  // Continue existing session (technical restore)
  async continueSession(userId, sessionId) {
    try {
      // Load session from database
      const sessionData = dbManager.prepare(`
        SELECT s.*, p.* FROM sessions s
        JOIN patients p ON s.patient_id = p.id
        WHERE s.id = ? AND s.user_id = ?
      `).get(sessionId, userId);

      if (!sessionData) {
        throw new Error('Session not found or access denied');
      }

      // Load conversation history
      const messages = await claudeService.loadConversationFromDB(sessionData.uuid);

      const sessionUuid = sessionData.uuid;
      const activeSession = {
        id: sessionData.id,
        uuid: sessionUuid,
        userId,
        patientId: sessionData.patient_id,
        patient: {
          id: sessionData.patient_id,
          name: sessionData.name,
          system_prompt: sessionData.system_prompt
        },
        messages: messages,
        startTime: new Date(sessionData.started_at).getTime(),
        lastActivity: Date.now(),
        isNewWeek: false // Same session continuation
      };

      this.activeSessions.set(sessionUuid, activeSession);
      this.startInactivityMonitoring(sessionUuid, userId);

      logger.info('Session continued', { 
        sessionId, 
        sessionUuid, 
        userId, 
        messageCount: messages.length 
      });

      return {
        id: sessionData.id,
        uuid: sessionUuid,
        patient: {
          id: sessionData.patient_id,
          name: sessionData.name,
          age: sessionData.age,
          presenting_problem: sessionData.presenting_problem
        }
      };
      
    } catch (error) {
      logger.error('Error continuing session', { error: error.message, userId, sessionId });
      throw error;
    }
  }
}

const sessionService = new SessionService();

// Setup periodic cleanup
setInterval(() => {
  sessionService.cleanupInactiveSessions();
}, 30 * 60 * 1000); // Every 30 minutes

export default sessionService;