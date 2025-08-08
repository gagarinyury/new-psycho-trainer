import userService from '../services/UserService.js';
import patientService from '../services/PatientService.js';
import sessionService from '../services/SessionService.js';
import logger from '../utils/logger.js';

class CommandHandler {
  constructor() {
    this.commands = {
      '/start': this.handleStart.bind(this),
      '/help': this.handleHelp.bind(this),
      '/new': this.handleNewPatient.bind(this),
      '/custom': this.handleCustomPatient.bind(this),
      '/patients': this.handlePatients.bind(this),
      '/sessions': this.handleSessions.bind(this),
      '/stats': this.handleStats.bind(this),
      '/analyze': this.handleAnalyze.bind(this),
      '/end': this.handleEndSession.bind(this),
      '/info': this.handlePatientInfo.bind(this),
      '/leaderboard': this.handleLeaderboard.bind(this),
      '/continue': this.handleContinueSession.bind(this),
      '/settings': this.handleSettings.bind(this)
    };
  }

  async handleCommand(bot, msg) {
    const chatId = msg.chat.id;
    const command = (msg.text || '').split(' ')[0].toLowerCase();
    const args = (msg.text || '').split(' ').slice(1).join(' ');

    try {
      // Register/get user
      const userId = await userService.registerUser(msg.from);
      
      // Execute command
      if (this.commands[command]) {
        await this.commands[command](bot, msg, userId, args);
      } else {
        await bot.sendMessage(chatId, 
          '❓ Неизвестная команда. Используйте /help для списка доступных команд.'
        );
      }

    } catch (error) {
      logger.error('Command handler error', { 
        error: error.message, 
        command, 
        userId: msg.from.id 
      });
      
      await bot.sendMessage(chatId, 
        '❌ Произошла ошибка. Попробуйте позже или обратитесь к администратору.'
      );
    }
  }

  async handleStart(bot, msg, userId) {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'Коллега';

    const welcomeMessage = `
🎯 *Добро пожаловать в ПсихоТренер v3.0!*

Привет, ${firstName}! Я помогу тебе развить навыки психотерапии через практику с AI-пациентами.

🤖 *Что я умею:*
• Создавать реалистичных AI-пациентов
• Проводить интерактивные терапевтические сессии  
• Анализировать твою работу как AI-супервизор
• Отслеживать прогресс и статистику

📋 *Основные команды:*
/new - Создать случайного пациента
/custom - Создать пациента по описанию
/patients - Мои пациенты
/sessions - История сессий
/stats - Моя статистика
/help - Полный список команд

🚀 *Начни с создания первого пациента командой /new*

💡 *Предложения и обратная связь:*
• Telegram: @YourTerapist
• Идеи для улучшения бота

💰 *Поддержать проект:*
• PayPal: [Благодарность разработчику](https://paypal.me/psyazur)
• Помочь компенсировать токены Claude AI
    `;

    const keyboard = {
      inline_keyboard: [
        [
          {
            text: '🎲 Новый пациент',
            callback_data: 'start_new_patient'
          },
          {
            text: '🎨 Кастом пациент',
            callback_data: 'start_custom_patient'
          }
        ]
      ]
    };

    await bot.sendMessage(chatId, welcomeMessage, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  async handleHelp(bot, msg, userId) {
    const chatId = msg.chat.id;

    const helpMessage = `
📚 *Справка по командам ПсихоТренер v3.0*

🆕 *Создание пациентов:*
/new - Создать случайного AI-пациента
/custom <описание> - Создать пациента по твоему описанию

👥 *Работа с пациентами:*
/patients - Список твоих пациентов
/info - Информация о текущем пациенте
/continue - Продолжить активную сессию

🎭 *Сессии:*
/sessions - История завершенных сессий
/analyze - Получить анализ последней сессии
/end - Завершить текущую сессию

📊 *Статистика:*
/stats - Твоя статистика и прогресс
/leaderboard - Рейтинг терапевтов

ℹ️ *Помощь:*
/settings - Настройки бота
/help - Эта справка
/start - Перезапуск бота

💡 *Советы:*
• Во время сессии просто пиши сообщения - бот автоматически передаст их пациенту
• Завершай сессии командой /end для получения анализа
• Изучай анализы супервизора для улучшения навыков
    `;

    await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
  }

  async handleNewPatient(bot, msg, userId) {
    const chatId = msg.chat.id;

    try {
      await bot.sendMessage(chatId, '🔄 Создаю уникального AI-пациента...');

      const patient = await patientService.createRandomPatient(userId);

      // Extract chief complaint from presenting_problem (not the full diagnosis)
      const chiefComplaint = patient.presenting_problem || patient.psychological_profile?.presenting_problem || 'общие жизненные трудности';

      const secretaryCallMessage = `
📞 *Звонок от Екатерины (секретарь)*

"Добрый день! К вам записан(а) *${patient.name}*, ${patient.age} лет.

При записи жаловался(ась) на: _${chiefComplaint}_

Пациент уже в приемной. Готовы принять?"
      `;

      const keyboard = {
        inline_keyboard: [[
          { text: '📞 Пригласить пациента', callback_data: `invite_patient_${patient.id}` }
        ]]
      };

      await bot.sendMessage(chatId, secretaryCallMessage, { 
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });

      // Patient info will be retrieved from database when button is clicked

      logger.info('Patient created, waiting for invitation', { 
        userId, 
        patientId: patient.id,
        patientName: patient.name,
        patientCreatedBy: patient.created_by,
        callbackData: `invite_patient_${patient.id}`
      });

    } catch (error) {
      logger.error('Error creating new patient', { error: error.message, userId });
      await bot.sendMessage(chatId, 
        '❌ Не удалось создать пациента. Попробуйте позже.'
      );
    }
  }

  async handleCustomPatient(bot, msg, userId, description) {
    const chatId = msg.chat.id;

    // If no description provided, ask for it and set user state
    if (!description || description.trim().length < 10) {
      // Set user state to wait for patient description
      const messageHandler = await import('./MessageHandler.js');
      messageHandler.default.setUserState(userId, { 
        state: 'awaiting_patient_description',
        command: 'custom_patient'
      });

      await bot.sendMessage(chatId, 
        '📝 *Опишите желаемого пациента:*\n\n' +
        '💡 *Примеры:*\n' +
        '• Молодая женщина с паническими атаками\n' +
        '• Подросток с социальной тревожностью\n' +
        '• Мужчина средних лет с депрессией\n\n' +
        '✏️ Напишите ваше описание:'
      , { parse_mode: 'Markdown' });
      return;
    }

    try {
      await bot.sendMessage(chatId, 
        `🔄 Создаю пациента по вашему описанию...\n💭 "${description}"`
      );

      const patient = await patientService.createRandomPatient(userId, description);

      const patientMessage = `
✅ *Кастомный пациент создан!*

👤 *${patient.name}*, ${patient.age} лет
🎭 *Проблема:* ${patient.presenting_problem}

📝 *Характеристика:*
${patient.background.substring(0, 250)}...

🚀 *Готов начать сессию?*
Напишите первое сообщение пациенту.
      `;

      await bot.sendMessage(chatId, patientMessage, { parse_mode: 'Markdown' });

      // Create session automatically
      await sessionService.createSession(userId, patient.id);

    } catch (error) {
      logger.error('Error creating custom patient', { error: error.message, userId });
      await bot.sendMessage(chatId, 
        '❌ Не удалось создать пациента. Попробуйте упростить описание.'
      );
    }
  }

  async handlePatients(bot, msg, userId) {
    const chatId = msg.chat.id;

    try {
      const patients = await patientService.getUserPatients(userId, 10);

      if (patients.length === 0) {
        await bot.sendMessage(chatId, 
          '👥 У вас пока нет созданных пациентов.\n\n' +
          'Создайте первого пациента командой /new'
        );
        return;
      }

      let patientsMessage = '*👥 Ваши пациенты:*\n\n';
      
      patients.forEach((patient, index) => {
        const sessionCount = patient.session_count || 0;
        const createdDate = new Date(patient.created_at).toLocaleDateString('ru-RU');
        
        patientsMessage += `*${patient.id}* - *${patient.name}* (${patient.age} лет)\n`;
        patientsMessage += `   🎭 ${patient.presenting_problem.substring(0, 80)}...\n`;
        patientsMessage += `   📅 ${createdDate} | 🗣️ ${sessionCount} сессий\n\n`;
      });

      patientsMessage += '💡 *Как работать с пациентами:*\n';
      patientsMessage += '• Напишите ID пациента (например: `111`)\n';
      patientsMessage += '• Выберите действие через кнопки:\n';
      patientsMessage += '  - 🆕 Новая встреча (прошла неделя)\n';
      patientsMessage += '  - 🔄 Продолжить/восстановить сессию\n\n';
      patientsMessage += '*Создать нового:* /new или /custom <описание>';

      await bot.sendMessage(chatId, patientsMessage, { parse_mode: 'Markdown' });

    } catch (error) {
      logger.error('Error fetching patients', { error: error.message, userId });
      await bot.sendMessage(chatId, '❌ Ошибка при загрузке списка пациентов.');
    }
  }

  async handleSessions(bot, msg, userId) {
    const chatId = msg.chat.id;

    try {
      const sessions = await sessionService.getSessionHistory(userId, 10);

      if (sessions.length === 0) {
        await bot.sendMessage(chatId, 
          '📋 У вас пока нет завершенных сессий.\n\n' +
          'Создайте пациента командой /new и проведите первую сессию!'
        );
        return;
      }

      let sessionsMessage = '*📋 История сессий:*\n\n';

      sessions.forEach((session, index) => {
        const date = new Date(session.started_at).toLocaleDateString('ru-RU');
        const duration = session.duration_minutes || 0;
        const rating = session.rating ? ` | ⭐ ${session.rating}/10` : '';
        const status = session.status === 'completed' ? '✅' : 
                      session.status === 'active' ? '🔄' : '❌';
        
        sessionsMessage += `${index + 1}. ${status} *${session.patient_name}*\n`;
        sessionsMessage += `   📅 ${date} | ⏱️ ${duration} мин${rating}\n`;
        sessionsMessage += `   🎭 ${session.presenting_problem}\n\n`;
      });

      sessionsMessage += '📊 *Подробная статистика:* /stats';

      await bot.sendMessage(chatId, sessionsMessage, { parse_mode: 'Markdown' });

    } catch (error) {
      logger.error('Error fetching sessions', { error: error.message, userId });
      await bot.sendMessage(chatId, '❌ Ошибка при загрузке истории сессий.');
    }
  }

  async handleStats(bot, msg, userId) {
    const chatId = msg.chat.id;

    try {
      const stats = await userService.getUserStats(userId);
      
      if (!stats) {
        await bot.sendMessage(chatId, '❌ Не удалось загрузить статистику.');
        return;
      }

      const completionRate = stats.total_sessions > 0 ? 
        Math.round((stats.completed_sessions / stats.total_sessions) * 100) : 0;
      
      const avgSessionTime = stats.completed_sessions > 0 ? 
        Math.round(stats.total_session_time_minutes / stats.completed_sessions) : 0;

      let statsMessage = `*📊 Ваша статистика*\n\n`;
      statsMessage += `🎯 *Общие показатели:*\n`;
      statsMessage += `• Всего сессий: ${stats.total_sessions}\n`;
      statsMessage += `• Завершено: ${stats.completed_sessions} (${completionRate}%)\n`;
      statsMessage += `• Средний рейтинг: ${stats.average_session_rating.toFixed(1)}/10\n`;
      statsMessage += `• Среднее время сессии: ${avgSessionTime} мин\n\n`;

      statsMessage += `🎨 *Навыки терапевта:*\n`;
      Object.entries(stats.skill_areas).forEach(([skill, level]) => {
        const skillName = this.getSkillDisplayName(skill);
        const progress = Math.min(Math.round(level / 10), 10);
        const progressBar = '█'.repeat(progress) + '░'.repeat(10 - progress);
        statsMessage += `${skillName}: ${progressBar} ${level}%\n`;
      });

      if (stats.achievements.length > 0) {
        statsMessage += `\n🏆 *Достижения (${stats.achievements.length}):*\n`;
        stats.achievements.slice(-3).forEach(achievement => {
          statsMessage += `• ${achievement.name}\n`;
        });
      }

      statsMessage += `\n📈 *Продолжайте практиковаться!* /new`;

      await bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });

    } catch (error) {
      logger.error('Error fetching user stats', { error: error.message, userId });
      await bot.sendMessage(chatId, '❌ Ошибка при загрузке статистики.');
    }
  }

  getSkillDisplayName(skill) {
    const skillNames = {
      active_listening: 'Активное слушание',
      empathy: 'Эмпатия',
      questioning_techniques: 'Техники вопросов',
      intervention_skills: 'Интервенции',
      boundary_setting: 'Границы',
      crisis_management: 'Кризис-менеджмент'
    };
    return skillNames[skill] || skill;
  }

  async handleAnalyze(bot, msg, userId) {
    const chatId = msg.chat.id;

    try {
      // Get last completed session
      const sessions = await sessionService.getSessionHistory(userId, 1);
      
      if (sessions.length === 0 || sessions[0].status !== 'completed') {
        await bot.sendMessage(chatId, 
          '❌ Нет завершенных сессий для анализа.\n\n' +
          'Завершите сессию командой /end, чтобы получить анализ.'
        );
        return;
      }

      const sessionId = sessions[0].id;
      
      await bot.sendMessage(chatId, 
        '🔍 Анализирую вашу последнюю сессию...\n' +
        '⏱️ Это займет около минуты.'
      );

      const analysis = await sessionService.analyzeSession(sessionId, userId);

      let analysisMessage = `*🎓 Анализ сессии от AI-супервизора*\n\n`;
      analysisMessage += `⭐ *Общий рейтинг:* ${analysis.overall_rating}/10\n\n`;

      if (analysis.strengths && analysis.strengths.length > 0) {
        analysisMessage += `✅ *Сильные стороны:*\n`;
        analysis.strengths.forEach(strength => {
          analysisMessage += `• ${strength}\n`;
        });
        analysisMessage += '\n';
      }

      if (analysis.areas_for_improvement && analysis.areas_for_improvement.length > 0) {
        analysisMessage += `📈 *Области для развития:*\n`;
        analysis.areas_for_improvement.forEach(area => {
          analysisMessage += `• ${area}\n`;
        });
        analysisMessage += '\n';
      }

      if (analysis.recommendations && analysis.recommendations.length > 0) {
        analysisMessage += `💡 *Рекомендации:*\n`;
        analysis.recommendations.forEach(rec => {
          analysisMessage += `• ${rec}\n`;
        });
      }

      await bot.sendMessage(chatId, analysisMessage, { parse_mode: 'Markdown' });

      // Update user stats with analysis
      await userService.updateUserStats(userId, {
        completed: true,
        rating: analysis.overall_rating,
        analysis: analysis
      });

    } catch (error) {
      logger.error('Error analyzing session', { error: error.message, userId });
      await bot.sendMessage(chatId, 
        '❌ Ошибка при анализе сессии. Попробуйте позже.'
      );
    }
  }

  async handleEndSession(bot, msg, userId) {
    const chatId = msg.chat.id;

    try {
      const activeSession = sessionService.getActiveSession(userId);
      
      if (!activeSession) {
        await bot.sendMessage(chatId, 
          '❌ У вас нет активной сессии.\n\n' +
          'Создайте пациента командой /new для начала новой сессии.'
        );
        return;
      }

      await bot.sendMessage(chatId, '⏹️ Завершаю сессию...');

      const result = await sessionService.endSession(activeSession.uuid);
      
      let endMessage = `✅ *Сессия завершена!*\n\n`;
      endMessage += `👤 *Пациент:* ${activeSession.patient.name}\n`;
      endMessage += `⏱️ *Длительность:* ${result.duration} мин\n`;
      endMessage += `💬 *Сообщений:* ${result.messageCount}\n\n`;
      endMessage += `🎓 *Получить анализ:* /analyze\n`;
      endMessage += `🆕 *Новый пациент:* /new`;

      await bot.sendMessage(chatId, endMessage, { parse_mode: 'Markdown' });

    } catch (error) {
      logger.error('Error ending session', { error: error.message, userId });
      await bot.sendMessage(chatId, 
        '❌ Ошибка при завершении сессии.'
      );
    }
  }

  async handlePatientInfo(bot, msg, userId) {
    const chatId = msg.chat.id;

    try {
      const activeSession = sessionService.getActiveSession(userId);
      
      if (!activeSession) {
        await bot.sendMessage(chatId, 
          '❌ Нет активной сессии.\n\nСоздайте пациента командой /new'
        );
        return;
      }

      const patient = activeSession.patient;
      
      let infoMessage = `*ℹ️ Информация о пациенте*\n\n`;
      infoMessage += `👤 *${patient.name}*, ${patient.age} лет\n`;
      infoMessage += `🎭 *Основная проблема:*\n${patient.presenting_problem}\n\n`;
      infoMessage += `📖 *Биография:*\n${patient.background}\n\n`;
      
      const traits = patient.personality_traits;
      if (traits && traits.core_traits) {
        infoMessage += `🧠 *Ключевые черты:*\n`;
        traits.core_traits.forEach(trait => {
          infoMessage += `• ${trait}\n`;
        });
      }

      await bot.sendMessage(chatId, infoMessage, { parse_mode: 'Markdown' });

    } catch (error) {
      logger.error('Error fetching patient info', { error: error.message, userId });
      await bot.sendMessage(chatId, 
        '❌ Ошибка при загрузке информации о пациенте.'
      );
    }
  }

  async handleLeaderboard(bot, msg, userId) {
    const chatId = msg.chat.id;

    try {
      const leaderboard = await userService.getLeaderboard(10);

      if (leaderboard.length === 0) {
        await bot.sendMessage(chatId, 
          '🏆 Рейтинг пока пуст.\n\nБудьте первым, кто завершит сессию!'
        );
        return;
      }

      let leaderboardMessage = '*🏆 Рейтинг терапевтов*\n\n';

      leaderboard.forEach((user, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        leaderboardMessage += `${medal} *${user.name}*\n`;
        leaderboardMessage += `   ⭐ ${user.stats.average_rating} | `;
        leaderboardMessage += `🗣️ ${user.stats.completed_sessions} сессий | `;
        leaderboardMessage += `⏱️ ${user.stats.total_time_hours}ч\n\n`;
      });

      leaderboardMessage += '📈 *Ваша статистика:* /stats';

      await bot.sendMessage(chatId, leaderboardMessage, { parse_mode: 'Markdown' });

    } catch (error) {
      logger.error('Error fetching leaderboard', { error: error.message, userId });
      await bot.sendMessage(chatId, '❌ Ошибка при загрузке рейтинга.');
    }
  }

  async handleContinueSession(bot, msg, userId) {
    const chatId = msg.chat.id;

    try {
      const activeSession = sessionService.getActiveSession(userId);
      
      if (!activeSession) {
        await bot.sendMessage(chatId, 
          '❌ Нет активной сессии для продолжения.\n\n' +
          'Создайте нового пациента командой /new'
        );
        return;
      }

      let continueMessage = `🔄 *Продолжение сессии*\n\n`;
      continueMessage += `👤 *Пациент:* ${activeSession.patient.name}\n`;
      continueMessage += `💬 *Сообщений:* ${activeSession.messages.length}\n`;
      continueMessage += `⏱️ *Время сессии:* ${Math.round((Date.now() - activeSession.startTime) / 1000 / 60)} мин\n\n`;
      continueMessage += `💭 Продолжайте беседу с пациентом...\n`;
      continueMessage += `⏹️ *Завершить:* /end`;

      await bot.sendMessage(chatId, continueMessage, { parse_mode: 'Markdown' });

    } catch (error) {
      logger.error('Error continuing session', { error: error.message, userId });
      await bot.sendMessage(chatId, '❌ Ошибка при продолжении сессии.');
    }
  }

  async handleSettings(bot, msg, userId) {
    const chatId = msg.chat.id;

    try {
      const settings = await userService.getUserSettings(userId);
      
      const nonverbalStatus = settings.show_nonverbal ? '✅ Включена' : '❌ Выключена';
      const voiceStatus = settings.voice_enabled ? '✅ Включено' : '🚧 В разработке';
      
      let settingsMessage = `⚙️ *Настройки ПсихоТренер*\n\n`;
      settingsMessage += `🎭 *Невербалика:* ${nonverbalStatus}\n`;
      settingsMessage += `Отображение действий пациента (*вздохнула*, *отвернулась*)\n\n`;
      settingsMessage += `🎤 *Голосовое общение:* ${voiceStatus}\n`;
      settingsMessage += `Общение с пациентом голосовыми сообщениями\n\n`;
      settingsMessage += `🌐 *Язык:* ${(settings.language_code || 'ru').toUpperCase()}\n\n`;
      settingsMessage += `💡 *Изменить настройки через кнопки ниже*`;

      const keyboard = {
        inline_keyboard: [
          [
            {
              text: settings.show_nonverbal ? '🎭 Выключить невербалику' : '🎭 Включить невербалику',
              callback_data: `settings_nonverbal_${!settings.show_nonverbal}`
            }
          ],
          [
            {
              text: '🎤 Голосовое общение (в разработке)',
              callback_data: 'settings_voice_disabled'
            }
          ],
          [
            {
              text: '🔙 Главное меню',
              callback_data: 'settings_close'
            }
          ]
        ]
      };

      await bot.sendMessage(chatId, settingsMessage, { 
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });

    } catch (error) {
      logger.error('Error showing settings', { error: error.message, userId });
      await bot.sendMessage(chatId, 
        '❌ Ошибка при загрузке настроек.'
      );
    }
  }

  async handlePatientInvitation(bot, callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const telegramId = callbackQuery.from.id;
    const data = callbackQuery.data;
    
    // Get internal userId from telegram ID
    const userId = await userService.registerUser(callbackQuery.from);

    try {
      // Parse callback data: invite_patient_{patientId}
      const patientId = parseInt(data.replace('invite_patient_', ''));
      
      logger.info('Processing patient invitation callback', {
        telegramId,
        userId,
        patientId,
        data,
        parsedPatientId: patientId
      });
      
      // Get patient info from database
      const patient = await patientService.getPatientById(patientId);
      
      logger.info('Patient lookup result', {
        patientId,
        patientFound: !!patient,
        patientCreatedBy: patient?.created_by,
        userId,
        accessAllowed: patient?.created_by === userId
      });
      
      if (!patient || patient.created_by !== userId) {
        logger.warn('Patient invitation rejected', {
          patientId,
          userId,
          reason: !patient ? 'patient_not_found' : 'access_denied',
          patientCreatedBy: patient?.created_by
        });
        
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: 'Пациент больше не доступен. Создайте нового.',
          show_alert: true
        });
        return;
      }

      // Secretary response
      const secretaryResponseMessage = `
📞 *Ответ секретаря:*

"Хорошо, приглашаю пациента! Удачной сессии!"

*Стук в дверь* 🚪

👤 *Пациент заходит...*
      `;

      // Only edit message if content is different
      const currentMessage = callbackQuery.message.text;
      if (currentMessage !== secretaryResponseMessage.trim()) {
        await bot.editMessageText(secretaryResponseMessage, {
          chat_id: chatId,
          message_id: callbackQuery.message.message_id,
          parse_mode: 'Markdown'
        });
      }

      // End any existing active session
      const existingSession = sessionService.getActiveSession(userId);
      if (existingSession) {
        await sessionService.endSession(existingSession.uuid, 'Автоматически завершена при создании нового пациента');
        logger.info('Previous session ended automatically', { 
          userId, 
          sessionUuid: existingSession.uuid 
        });
      }

      // Create session
      const session = await sessionService.createSession(userId, patient.id);
      
      // Patient enters and gives their first greeting
      // This will trigger the patient's natural first response based on their personality
      const firstMessage = await sessionService.sendMessage(session.uuid, 'therapist', 'Здравствуйте, проходите, пожалуйста.');
      
      await bot.sendMessage(chatId, `👤 **${patient.name}:** ${firstMessage.response}`, {
        parse_mode: 'Markdown'
      });

      // Patient data retrieved from database, no cleanup needed

      // Answer callback query
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: 'Сессия началась!'
      });

      logger.info('Patient invited and session started', { 
        userId, 
        patientId: patient.id, 
        sessionId: session.id 
      });

    } catch (error) {
      logger.error('Error handling patient invitation', { error: error.message, userId, data });
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: 'Ошибка при приглашении пациента',
        show_alert: true
      });
    }
  }
}

const commandHandler = new CommandHandler();
export default commandHandler;