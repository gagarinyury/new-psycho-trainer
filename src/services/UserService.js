import dbManager from '../database/Database.js';
import logger from '../utils/logger.js';

class UserService {
  async registerUser(telegramUser) {
    try {
      const { id: telegramId, username, first_name, last_name, language_code } = telegramUser;

      // Check if user already exists
      const existingUser = await dbManager.get(`
        SELECT id FROM users WHERE telegram_id = ?
      `, [telegramId]);

      if (existingUser) {
        // Update last activity
        await this.updateLastActivity(existingUser.id);
        return existingUser.id;
      }

      // Create new user
      const result = await dbManager.run(`
        INSERT INTO users (telegram_id, username, first_name, last_name, language_code)
        VALUES (?, ?, ?, ?, ?)
      `, [telegramId, username || null, first_name || null, last_name || null, language_code || 'ru']);

      const userId = result.lastID;

      // Initialize user stats
      await this.initializeUserStats(userId);

      logger.info('New user registered', { 
        userId, 
        telegramId, 
        username: username || 'unknown'
      });

      return userId;

    } catch (error) {
      logger.error('Error registering user', { 
        error: error.message, 
        telegramId: telegramUser.id 
      });
      throw error;
    }
  }

  async initializeUserStats(userId) {
    try {
      const defaultSkillAreas = {
        active_listening: 0,
        empathy: 0,
        questioning_techniques: 0,
        intervention_skills: 0,
        boundary_setting: 0,
        crisis_management: 0
      };

      const defaultAchievements = [];

      await dbManager.run(`
        INSERT INTO user_stats (user_id, skill_areas, achievements)
        VALUES (?, ?, ?)
      `, [userId, JSON.stringify(defaultSkillAreas), JSON.stringify(defaultAchievements)]);

    } catch (error) {
      logger.error('Error initializing user stats', { error: error.message, userId });
    }
  }

  async getUserByTelegramId(telegramId) {
    try {
      const user = await dbManager.get(`
        SELECT * FROM users WHERE telegram_id = ? AND is_active = 1
      `, [telegramId]);

      if (user) {
        await this.updateLastActivity(user.id);
      }

      return user;
    } catch (error) {
      logger.error('Error fetching user', { error: error.message, telegramId });
      return null;
    }
  }

  async getUserById(userId) {
    try {
      return await dbManager.get(`
        SELECT * FROM users WHERE id = ? AND is_active = 1
      `, [userId]);
    } catch (error) {
      logger.error('Error fetching user by ID', { error: error.message, userId });
      return null;
    }
  }

  async updateLastActivity(userId) {
    try {
      await dbManager.run(`
        UPDATE users 
        SET last_activity = datetime('now') 
        WHERE id = ?
      `, [userId]);
    } catch (error) {
      logger.error('Error updating last activity', { error: error.message, userId });
    }
  }

  async getUserNonverbalSetting(userId) {
    try {
      const user = await dbManager.get(`
        SELECT show_nonverbal FROM users WHERE id = ? AND is_active = 1
      `, [userId]);
      
      return user ? Boolean(user.show_nonverbal) : true; // default to true
    } catch (error) {
      logger.error('Error fetching nonverbal setting', { error: error.message, userId });
      return true; // default to true on error
    }
  }

  async updateNonverbalSetting(userId, showNonverbal) {
    try {
      const result = await dbManager.run(`
        UPDATE users 
        SET show_nonverbal = ? 
        WHERE id = ?
      `, [showNonverbal ? 1 : 0, userId]);
      
      return result.changes > 0;
    } catch (error) {
      logger.error('Error updating nonverbal setting', { error: error.message, userId });
      return false;
    }
  }

  async getUserVoiceSetting(userId) {
    try {
      const user = await dbManager.get(`
        SELECT voice_enabled FROM users WHERE id = ? AND is_active = 1
      `, [userId]);
      
      return user ? Boolean(user.voice_enabled) : false; // default to false
    } catch (error) {
      logger.error('Error fetching voice setting', { error: error.message, userId });
      return false; // default to false on error
    }
  }

  async updateVoiceSetting(userId, voiceEnabled) {
    try {
      const result = await dbManager.run(`
        UPDATE users 
        SET voice_enabled = ? 
        WHERE id = ?
      `, [voiceEnabled ? 1 : 0, userId]);
      
      return result.changes > 0;
    } catch (error) {
      logger.error('Error updating voice setting', { error: error.message, userId });
      return false;
    }
  }

  async getUserSettings(userId) {
    try {
      const user = await dbManager.get(`
        SELECT show_nonverbal, voice_enabled, language_code 
        FROM users WHERE id = ? AND is_active = 1
      `, [userId]);
      
      if (!user) {
        return {
          show_nonverbal: true,
          voice_enabled: false,
          language_code: 'ru'
        };
      }
      
      return {
        show_nonverbal: Boolean(user.show_nonverbal),
        voice_enabled: Boolean(user.voice_enabled),
        language_code: user.language_code || 'ru'
      };
    } catch (error) {
      logger.error('Error fetching user settings', { error: error.message, userId });
      return {
        show_nonverbal: true,
        voice_enabled: false,
        language_code: 'ru'
      };
    }
  }

  async getUserStats(userId) {
    try {
      const stats = await dbManager.get(`
        SELECT * FROM user_stats WHERE user_id = ?
      `, [userId]);

      if (!stats) {
        await this.initializeUserStats(userId);
        return this.getUserStats(userId);
      }

      return {
        ...stats,
        skill_areas: JSON.parse(stats.skill_areas),
        achievements: JSON.parse(stats.achievements),
        favorite_patient_types: stats.favorite_patient_types ? 
          JSON.parse(stats.favorite_patient_types) : []
      };
    } catch (error) {
      logger.error('Error fetching user stats', { error: error.message, userId });
      return null;
    }
  }

  async updateUserStats(userId, sessionData) {
    try {
      const currentStats = await this.getUserStats(userId);
      if (!currentStats) {
        return false;
      }

      // Calculate new stats
      const newTotalSessions = currentStats.total_sessions + 1;
      const newCompletedSessions = sessionData.completed ? 
        currentStats.completed_sessions + 1 : currentStats.completed_sessions;
      
      const newTotalTime = currentStats.total_session_time_minutes + 
        (sessionData.duration || 0);

      const newAverageRating = sessionData.rating ? 
        ((currentStats.average_session_rating * currentStats.completed_sessions) + sessionData.rating) / 
        newCompletedSessions : currentStats.average_session_rating;

      // Update skill areas based on session analysis
      const updatedSkillAreas = this.updateSkillAreas(
        currentStats.skill_areas, 
        sessionData.analysis
      );

      // Check for new achievements
      const updatedAchievements = this.checkAchievements(
        currentStats, 
        { 
          total_sessions: newTotalSessions,
          completed_sessions: newCompletedSessions,
          average_rating: newAverageRating 
        }
      );

      // Update database
      await dbManager.run(`
        UPDATE user_stats 
        SET total_sessions = ?, completed_sessions = ?, total_session_time_minutes = ?,
            average_session_rating = ?, skill_areas = ?, achievements = ?,
            last_updated = datetime('now')
        WHERE user_id = ?
      `, [newTotalSessions, newCompletedSessions, newTotalTime, newAverageRating, 
         JSON.stringify(updatedSkillAreas), JSON.stringify(updatedAchievements), userId]);

      logger.info('User stats updated', { 
        userId, 
        totalSessions: newTotalSessions,
        averageRating: newAverageRating
      });

      return true;

    } catch (error) {
      logger.error('Error updating user stats', { error: error.message, userId });
      return false;
    }
  }

  updateSkillAreas(currentSkills, analysis) {
    if (!analysis || !analysis.specific_feedback) {
      return currentSkills;
    }

    const skillMapping = {
      rapport_building: 'empathy',
      intervention_quality: 'intervention_skills',
      therapeutic_technique: 'questioning_techniques',
      ethical_considerations: 'boundary_setting'
    };

    const updatedSkills = { ...currentSkills };

    // Increment skills based on positive feedback
    Object.entries(skillMapping).forEach(([feedbackKey, skillKey]) => {
      if (analysis.specific_feedback[feedbackKey] && 
          analysis.specific_feedback[feedbackKey].includes('хорошо')) {
        updatedSkills[skillKey] = Math.min(updatedSkills[skillKey] + 1, 100);
      }
    });

    return updatedSkills;
  }

  checkAchievements(currentStats, newStats) {
    const achievements = [...currentStats.achievements];
    
    const achievementRules = [
      {
        id: 'first_session',
        name: 'Первая сессия',
        description: 'Завершить первую терапевтическую сессию',
        condition: () => newStats.completed_sessions >= 1
      },
      {
        id: 'session_master',
        name: 'Мастер сессий',
        description: 'Завершить 10 сессий',
        condition: () => newStats.completed_sessions >= 10
      },
      {
        id: 'session_expert',
        name: 'Эксперт сессий',
        description: 'Завершить 50 сессий',
        condition: () => newStats.completed_sessions >= 50
      },
      {
        id: 'high_performer',
        name: 'Высокие результаты',
        description: 'Средний рейтинг выше 8.0',
        condition: () => newStats.average_rating >= 8.0 && newStats.completed_sessions >= 5
      },
      {
        id: 'consistent_performer',
        name: 'Стабильные результаты',
        description: 'Средний рейтинг выше 7.0 за 20 сессий',
        condition: () => newStats.average_rating >= 7.0 && newStats.completed_sessions >= 20
      }
    ];

    achievementRules.forEach(rule => {
      const hasAchievement = achievements.some(a => a.id === rule.id);
      if (!hasAchievement && rule.condition()) {
        achievements.push({
          id: rule.id,
          name: rule.name,
          description: rule.description,
          earned_at: new Date().toISOString()
        });
      }
    });

    return achievements;
  }

  async getLeaderboard(limit = 10) {
    try {
      const leaderboard = await dbManager.all(`
        SELECT 
          u.first_name, u.username,
          us.total_sessions, us.completed_sessions, us.average_session_rating,
          us.total_session_time_minutes
        FROM users u
        JOIN user_stats us ON u.id = us.user_id
        WHERE u.is_active = 1 AND us.completed_sessions > 0
        ORDER BY us.average_session_rating DESC, us.completed_sessions DESC
        LIMIT ?
      `, [limit]);

      return leaderboard.map((user, index) => ({
        rank: index + 1,
        name: user.first_name || user.username || 'Anonymous',
        stats: {
          total_sessions: user.total_sessions,
          completed_sessions: user.completed_sessions,
          average_rating: parseFloat(user.average_session_rating.toFixed(2)),
          total_time_hours: Math.round(user.total_session_time_minutes / 60)
        }
      }));

    } catch (error) {
      logger.error('Error fetching leaderboard', { error: error.message });
      return [];
    }
  }

  async deactivateUser(userId) {
    try {
      const result = await dbManager.run(`
        UPDATE users 
        SET is_active = 0 
        WHERE id = ?
      `, [userId]);

      return result.changes > 0;
    } catch (error) {
      logger.error('Error deactivating user', { error: error.message, userId });
      return false;
    }
  }


  async updateUserSetting(userId, settingName, value) {
    try {
      const allowedSettings = ['show_nonverbal', 'voice_enabled'];
      if (!allowedSettings.includes(settingName)) {
        throw new Error(`Invalid setting: ${settingName}`);
      }

      const result = await dbManager.run(`
        UPDATE users 
        SET ${settingName} = ? 
        WHERE id = ?
      `, [value ? 1 : 0, userId]);

      logger.info('User setting updated', { userId, settingName, value });
      return result.changes > 0;
    } catch (error) {
      logger.error('Error updating user setting', { 
        error: error.message, 
        userId, 
        settingName, 
        value 
      });
      return false;
    }
  }

}

const userService = new UserService();
export default userService;