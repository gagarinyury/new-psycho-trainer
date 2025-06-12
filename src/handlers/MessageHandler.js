import sessionService from '../services/SessionService.js';
import userService from '../services/UserService.js';
import logger from '../utils/logger.js';

class MessageHandler {
  constructor() {
    this.userStates = new Map(); // Track user interaction states
  }

  async handleMessage(bot, msg) {
    const chatId = msg.chat.id;
    const messageText = msg.text;
    const userId = await userService.registerUser(msg.from);

    try {
      // Update user activity
      userService.updateLastActivity(userId);

      // Check for active session
      const activeSession = sessionService.getActiveSession(userId);
      
      if (!activeSession) {
        await this.handleNoActiveSession(bot, chatId);
        return;
      }

      // Handle message in session context
      await this.handleSessionMessage(bot, chatId, userId, activeSession, messageText);

    } catch (error) {
      logger.error('Message handler error', { 
        error: error.message, 
        userId, 
        messageLength: messageText?.length 
      });
      
      await bot.sendMessage(chatId, 
        '❌ Произошла ошибка при обработке сообщения. Попробуйте еще раз.'
      );
    }
  }

  async handleNoActiveSession(bot, chatId) {
    const message = `
❓ *У вас нет активной сессии*

Чтобы начать работу с пациентом:
🆕 /new - Создать случайного пациента
🎨 /custom - Создать пациента по описанию
👥 /patients - Посмотреть существующих пациентов

💡 *Подсказка:* Начните с команды /new для создания вашего первого AI-пациента!
    `;

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  async handleSessionMessage(bot, chatId, userId, activeSession, messageText) {
    try {
      // Validate message
      if (!messageText || messageText.trim().length === 0) {
        await bot.sendMessage(chatId, 
          '💬 Напишите сообщение для передачи пациенту.'
        );
        return;
      }

      if (messageText.length > 1000) {
        await bot.sendMessage(chatId, 
          '📝 Сообщение слишком длинное. Максимум 1000 символов.'
        );
        return;
      }

      // Show typing indicator
      await bot.sendChatAction(chatId, 'typing');

      // Send message to session
      const result = await sessionService.sendMessage(
        activeSession.uuid, 
        'therapist', 
        messageText
      );

      if (result.response) {
        // Format patient response
        const patientMessage = `👤 *${activeSession.patient.name}:*\n${result.response}`;
        
        // Add session info if it's getting long
        if (result.messageCount > 10 && result.messageCount % 5 === 0) {
          const sessionTime = Math.round((Date.now() - activeSession.startTime) / 1000 / 60);
          const infoMessage = `\n\n⏱️ _Сессия идет ${sessionTime} мин | Сообщений: ${result.messageCount}_`;
          await bot.sendMessage(chatId, patientMessage + infoMessage, { parse_mode: 'Markdown' });
        } else {
          await bot.sendMessage(chatId, patientMessage, { parse_mode: 'Markdown' });
        }

        // Log interaction
        logger.info('Session message exchanged', {
          sessionUuid: activeSession.uuid,
          messageCount: result.messageCount,
          responseTime: result.responseTime,
          therapistMessageLength: messageText.length,
          patientResponseLength: result.response.length
        });

        // Show helpful reminders periodically
        await this.showPeriodicReminders(bot, chatId, result.messageCount);

      } else {
        await bot.sendMessage(chatId, 
          '🤔 Пациент задумался... Попробуйте переформулировать вопрос.'
        );
      }

    } catch (error) {
      logger.error('Session message error', { 
        error: error.message, 
        sessionUuid: activeSession.uuid 
      });

      if (error.message.includes('Rate limit')) {
        await bot.sendMessage(chatId, 
          '⏳ Слишком много запросов. Подождите немного перед следующим сообщением.'
        );
      } else if (error.message.includes('API')) {
        await bot.sendMessage(chatId, 
          '🔧 Временные проблемы с AI. Попробуйте через минуту.'
        );
      } else {
        await bot.sendMessage(chatId, 
          '❌ Ошибка при обработке сообщения. Попробуйте еще раз.'
        );
      }
    }
  }

  async showPeriodicReminders(bot, chatId, messageCount) {
    const reminders = {
      5: '💡 *Совет:* Используйте открытые вопросы для исследования проблемы.',
      10: '🎯 *Подсказка:* Попробуйте отразить эмоции пациента.',
      15: '⏰ *Напоминание:* Не забывайте о целях сессии. Завершить: /end',
      20: '🔍 *Совет:* Возможно, стоит подвести промежуточные итоги.',
      25: '⚡ *Подсказка:* Длинная сессия - хорошо, но не забывайте о завершении: /end'
    };

    if (reminders[messageCount]) {
      setTimeout(async () => {
        try {
          await bot.sendMessage(chatId, reminders[messageCount], { 
            parse_mode: 'Markdown' 
          });
        } catch (error) {
          logger.error('Error sending reminder', { error: error.message });
        }
      }, 2000); // Delay to not interrupt conversation flow
    }
  }

  // Handle voice messages (future enhancement)
  async handleVoiceMessage(bot, msg) {
    const chatId = msg.chat.id;
    
    await bot.sendMessage(chatId, 
      '🎙️ Голосовые сообщения пока не поддерживаются.\n\n' +
      'Напишите текстовое сообщение для продолжения сессии.'
    );
  }

  // Handle photos/documents (future enhancement)
  async handleMedia(bot, msg) {
    const chatId = msg.chat.id;
    
    await bot.sendMessage(chatId, 
      '📎 Медиафайлы пока не поддерживаются.\n\n' +
      'Используйте текстовые сообщения для общения с пациентом.'
    );
  }

  // Get user state for complex interactions
  getUserState(userId) {
    return this.userStates.get(userId) || { state: 'idle' };
  }

  // Set user state for complex interactions
  setUserState(userId, state) {
    this.userStates.set(userId, { 
      ...this.getUserState(userId), 
      ...state, 
      updatedAt: Date.now() 
    });
  }

  // Clear user state
  clearUserState(userId) {
    this.userStates.delete(userId);
  }

  // Handle inactivity warning with inline keyboard
  async handleInactivityWarning(bot, chatId, sessionUuid, session) {
    try {
      const warningMessage = `
⚠️ *Предупреждение о неактивности*

Ваша сессия с пациентом *${session.patient.name}* неактивна уже 5 минут.

Что вы хотите сделать?
      `;

      const keyboard = {
        inline_keyboard: [
          [
            { 
              text: '✅ Продолжить сессию', 
              callback_data: `continue_session:${sessionUuid}` 
            }
          ],
          [
            { 
              text: '⏸️ Пауза на 15 мин', 
              callback_data: `pause_session:${sessionUuid}:15` 
            },
            { 
              text: '⏸️ Пауза на 30 мин', 
              callback_data: `pause_session:${sessionUuid}:30` 
            }
          ],
          [
            { 
              text: '🛑 Завершить сессию', 
              callback_data: `end_session:${sessionUuid}` 
            }
          ]
        ]
      };

      await bot.sendMessage(chatId, warningMessage, { 
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });

      logger.info('Inactivity warning sent', { sessionUuid, chatId });

    } catch (error) {
      logger.error('Error sending inactivity warning', { 
        error: error.message, 
        sessionUuid, 
        chatId 
      });
    }
  }

  // Handle session ended due to inactivity
  async handleInactivityEnd(bot, chatId, sessionUuid, session) {
    try {
      const endMessage = `
🕐 *Сессия завершена автоматически*

Ваша сессия с пациентом *${session.patient.name}* была завершена из-за неактивности (более 10 минут).

📊 Статистика сессии:
• Длительность: ${Math.round((Date.now() - session.startTime) / 1000 / 60)} мин
• Сообщений: ${session.messages.length}

💡 Вы можете:
🆕 /new - Начать новую сессию
📋 /sessions - Посмотреть историю сессий
      `;

      await bot.sendMessage(chatId, endMessage, { parse_mode: 'Markdown' });

      logger.info('Inactivity end notification sent', { sessionUuid, chatId });

    } catch (error) {
      logger.error('Error sending inactivity end notification', { 
        error: error.message, 
        sessionUuid, 
        chatId 
      });
    }
  }

  // Handle callback queries from inline keyboards
  async handleCallbackQuery(bot, callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;

    try {
      // Answer callback query immediately
      await bot.answerCallbackQuery(callbackQuery.id);

      // Parse callback data
      const [action, sessionUuid, ...params] = data.split(':');

      switch (action) {
        case 'continue_session':
          await this.handleContinueSessionCallback(bot, chatId, sessionUuid);
          break;

        case 'pause_session':
          const pauseMinutes = parseInt(params[0]) || 15;
          await this.handlePauseSessionCallback(bot, chatId, sessionUuid, pauseMinutes);
          break;

        case 'end_session':
          await this.handleEndSessionCallback(bot, chatId, sessionUuid, userId);
          break;

        default:
          logger.warn('Unknown callback action', { action, sessionUuid });
      }

    } catch (error) {
      logger.error('Error handling callback query', { 
        error: error.message, 
        data, 
        userId 
      });

      await bot.sendMessage(chatId, 
        '❌ Произошла ошибка при обработке действия. Попробуйте еще раз.'
      );
    }
  }

  // Handle continue session callback
  async handleContinueSessionCallback(bot, chatId, sessionUuid) {
    try {
      const success = await sessionService.handleContinueSession(sessionUuid);
      
      if (success) {
        await bot.sendMessage(chatId, 
          '✅ *Сессия продолжена*\n\nВы можете продолжить общение с пациентом.',
          { parse_mode: 'Markdown' }
        );
      } else {
        await bot.sendMessage(chatId, 
          '❌ Сессия не найдена или уже завершена.'
        );
      }

    } catch (error) {
      logger.error('Error continuing session', { error: error.message, sessionUuid });
      await bot.sendMessage(chatId, 
        '❌ Ошибка при продолжении сессии.'
      );
    }
  }

  // Handle pause session callback
  async handlePauseSessionCallback(bot, chatId, sessionUuid, pauseMinutes) {
    try {
      const pauseDuration = pauseMinutes * 60 * 1000; // Convert to milliseconds
      const success = await sessionService.handlePauseSession(sessionUuid, pauseDuration);
      
      if (success) {
        await bot.sendMessage(chatId, 
          `⏸️ *Сессия приостановлена на ${pauseMinutes} минут*\n\n` +
          'Напоминание о продолжении придет автоматически.',
          { parse_mode: 'Markdown' }
        );
      } else {
        await bot.sendMessage(chatId, 
          '❌ Сессия не найдена или уже завершена.'
        );
      }

    } catch (error) {
      logger.error('Error pausing session', { error: error.message, sessionUuid });
      await bot.sendMessage(chatId, 
        '❌ Ошибка при приостановке сессии.'
      );
    }
  }

  // Handle end session callback
  async handleEndSessionCallback(bot, chatId, sessionUuid, userId) {
    try {
      const result = await sessionService.endSession(sessionUuid, 'Ended by user via inactivity warning');
      
      const endMessage = `
🛑 *Сессия завершена*

📊 Статистика:
• Длительность: ${result.duration} мин
• Сообщений: ${result.messageCount}

💡 Доступные действия:
🆕 /new - Начать новую сессию
📊 /analyze ${result.sessionId} - Анализ завершенной сессии
📋 /sessions - История сессий
      `;

      await bot.sendMessage(chatId, endMessage, { parse_mode: 'Markdown' });

    } catch (error) {
      logger.error('Error ending session', { error: error.message, sessionUuid });
      await bot.sendMessage(chatId, 
        '❌ Ошибка при завершении сессии.'
      );
    }
  }

  // Cleanup old user states
  cleanupUserStates() {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes

    for (const [userId, state] of this.userStates.entries()) {
      if (state.updatedAt && now - state.updatedAt > maxAge) {
        this.userStates.delete(userId);
      }
    }
  }
}

const messageHandler = new MessageHandler();

// Cleanup user states periodically
setInterval(() => {
  messageHandler.cleanupUserStates();
}, 10 * 60 * 1000); // Every 10 minutes

export default messageHandler;