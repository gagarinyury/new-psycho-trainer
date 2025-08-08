import TelegramBot from 'node-telegram-bot-api';
import config from './config/index.js';
import logger from './utils/logger.js';
import dbManager from './database/Database.js';
import commandHandler from './handlers/CommandHandler.js';
import messageHandler from './handlers/MessageHandler.js';
import userService from './services/UserService.js';
import sessionService from './services/SessionService.js';

class PsychoTrainerBot {
  constructor() {
    this.bot = null;
    this.isRunning = false;
    this.restartAttempts = 0;
  }

  async initialize() {
    try {
      logger.info('Initializing PsychoTrainer Bot v3.0...');

      // Initialize database
      await dbManager.initialize();
      logger.info('Database initialized successfully');

      // Initialize Telegram bot
      this.bot = new TelegramBot(config.telegram.token, { 
        polling: {
          interval: 300,
          autoStart: false,
          params: {
            timeout: 10,
            allowed_updates: ['message', 'callback_query']
          }
        }
      });

      // Set up bot event handlers
      this.setupEventHandlers();
      
      // Set up error handlers
      this.setupErrorHandlers();

      // Set up graceful shutdown
      this.setupGracefulShutdown();

      // Set up inactivity callbacks
      this.setupInactivityCallbacks();

      // Set up bot commands menu
      await this.setupBotCommands();

      logger.info('Bot initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize bot', { error: error.message });
      throw error;
    }
  }

  setupEventHandlers() {
    // Handle commands
    this.bot.onText(/^\/\w+/, async (msg) => {
      try {
        await commandHandler.handleCommand(this.bot, msg);
      } catch (error) {
        logger.error('Command handling error', { 
          error: error.message,
          command: msg.text,
          userId: msg.from.id
        });
      }
    });

    // Handle regular messages
    this.bot.on('message', async (msg) => {
      // Skip commands (already handled above)
      if (msg.text && msg.text.startsWith('/')) {
        return;
      }

      // Handle different message types
      if (msg.text) {
        await messageHandler.handleMessage(this.bot, msg);
      } else if (msg.voice) {
        await messageHandler.handleVoiceMessage(this.bot, msg);
      } else if (msg.photo || msg.document) {
        await messageHandler.handleMedia(this.bot, msg);
      }
    });

    // Handle callback queries (for inline keyboards)
    this.bot.on('callback_query', async (query) => {
      try {
        // Route inactivity callbacks to messageHandler
        if (query.data.includes('session') || query.data.includes('continue') || 
            query.data.includes('pause') || query.data.includes('end')) {
          await messageHandler.handleCallbackQuery(this.bot, query);
        } else if (query.data.startsWith('patient_action:')) {
          // Route patient action callbacks to messageHandler
          await messageHandler.handlePatientActionCallback(this.bot, query);
        } else {
          await this.handleCallbackQuery(query);
        }
      } catch (error) {
        logger.error('Callback query error', { 
          error: error.message,
          queryData: query.data,
          userId: query.from.id
        });
      }
    });

    logger.info('Event handlers set up');
  }

  setupInactivityCallbacks() {
    // Set up inactivity warning callback
    sessionService.setInactivityWarningCallback(async (sessionUuid, userId, session) => {
      try {
        // Get user's chat ID
        const user = await userService.getUserById(userId);
        if (!user || !user.telegram_chat_id) {
          logger.error('Cannot send inactivity warning - no chat ID found', { userId, sessionUuid });
          return;
        }

        await messageHandler.handleInactivityWarning(
          this.bot, 
          user.telegram_chat_id, 
          sessionUuid, 
          session
        );
      } catch (error) {
        logger.error('Error in inactivity warning callback', { 
          error: error.message, 
          sessionUuid, 
          userId 
        });
      }
    });

    // Set up inactivity end callback
    sessionService.setInactivityEndCallback(async (sessionUuid, userId, session) => {
      try {
        // Get user's chat ID
        const user = await userService.getUserById(userId);
        if (!user || !user.telegram_chat_id) {
          logger.error('Cannot send inactivity end notification - no chat ID found', { userId, sessionUuid });
          return;
        }

        await messageHandler.handleInactivityEnd(
          this.bot, 
          user.telegram_chat_id, 
          sessionUuid, 
          session
        );
      } catch (error) {
        logger.error('Error in inactivity end callback', { 
          error: error.message, 
          sessionUuid, 
          userId 
        });
      }
    });

    logger.info('Inactivity callbacks set up');
  }

  async setupBotCommands() {
    try {
      const commands = [
        { command: 'start', description: '🏠 Начать работу с ботом' },
        { command: 'new', description: '👤 Создать нового пациента' },
        { command: 'custom', description: '🎨 Создать пациента по описанию' },
        { command: 'patients', description: '👥 Мои пациенты' },
        { command: 'sessions', description: '📋 История сессий' },
        { command: 'stats', description: '📊 Моя статистика' },
        { command: 'settings', description: '⚙️ Настройки бота' },
        { command: 'analyze', description: '🎓 Анализ сессии' },
        { command: 'end', description: '🏁 Завершить сессию' },
        { command: 'info', description: 'ℹ️ Информация о пациенте' },
        { command: 'continue', description: '🔄 Продолжить сессию' },
        { command: 'leaderboard', description: '🏆 Рейтинг терапевтов' },
        { command: 'help', description: '❓ Помощь и команды' }
      ];

      await this.bot.setMyCommands(commands);
      logger.info('Bot commands menu set up', { commandCount: commands.length });
    } catch (error) {
      logger.error('Error setting up bot commands', { error: error.message });
    }
  }

  async handleCallbackQuery(query) {
    const chatId = query.message.chat.id;
    const data = query.data;

    // Handle different callback types
    if (data.startsWith('invite_patient_')) {
      // Handle patient invitation callbacks (handles its own callback acknowledgment)
      await commandHandler.handlePatientInvitation(this.bot, query);
    } else {
      // Acknowledge the callback query for other types
      await this.bot.answerCallbackQuery(query.id);
      
      if (data.startsWith('patient_')) {
        // Handle patient selection callbacks
        const patientId = data.split('_')[1];
        await this.handlePatientSelection(chatId, patientId, query.from.id);
      } else if (data.startsWith('session_')) {
        // Handle session management callbacks
        const action = data.split('_')[1];
        await this.handleSessionAction(chatId, action, query.from.id);
      } else if (data.startsWith('settings_')) {
        // Handle settings callbacks
        await this.handleSettingsCallback(chatId, data, query.from.id);
      } else if (data.startsWith('start_')) {
        // Handle start menu button callbacks
        await this.handleStartCallback(chatId, data, query.from);
      }
    }
  }

  async handlePatientSelection(chatId, patientId, userId) {
    // Implementation for patient selection via inline keyboards
    await this.bot.sendMessage(chatId, `Selected patient ID: ${patientId}`);
  }

  async handleSessionAction(chatId, action, userId) {
    // Implementation for session actions via inline keyboards
    await this.bot.sendMessage(chatId, `Session action: ${action}`);
  }

  async handleStartCallback(chatId, data, user) {
    try {
      if (data === 'start_new_patient') {
        // Эмулируем команду /new
        const fakeMsg = {
          chat: { id: chatId },
          from: user,
          text: '/new'
        };
        await commandHandler.handleCommand(this.bot, fakeMsg);
      } else if (data === 'start_custom_patient') {
        // Эмулируем команду /custom  
        const fakeMsg = {
          chat: { id: chatId },
          from: user,
          text: '/custom'
        };
        await commandHandler.handleCommand(this.bot, fakeMsg);
      }
    } catch (error) {
      logger.error('Error handling start callback', { error: error.message, data, chatId });
    }
  }

  async handleSettingsCallback(chatId, data, telegramUserId) {
    try {
      logger.info('Callback received', { data, telegramUserId, chatId });
      
      // Get user ID from telegram ID
      const user = await userService.getUserByTelegramId(telegramUserId);
      if (!user) {
        logger.error('User not found', { telegramUserId });
        await this.bot.sendMessage(chatId, '❌ Пользователь не найден.');
        return;
      }
      
      const userId = user.id;
      
      if (data === 'settings_close') {
        await this.bot.sendMessage(chatId, '✅ Настройки закрыты. Используйте /help для списка команд.');
        return;
      }
      
      if (data.startsWith('settings_nonverbal_')) {
        const newValue = data.split('_')[2] === 'true';
        const success = await userService.updateNonverbalSetting(userId, newValue);
        
        if (success) {
          const status = newValue ? 'включена' : 'выключена';
          await this.bot.sendMessage(chatId, `✅ Невербалика ${status}!`);
          
          // Refresh settings display
          await commandHandler.handleSettings(this.bot, { chat: { id: chatId } }, userId);
        } else {
          await this.bot.sendMessage(chatId, '❌ Ошибка при обновлении настройки.');
        }
        return;
      }
      
      if (data === 'settings_voice_disabled') {
        await this.bot.sendMessage(chatId, 
          '🚧 Голосовое общение находится в разработке.\n\n' +
          'Скоро будет доступна возможность общения с AI-пациентами голосовыми сообщениями!'
        );
        return;
      }
      
      
    } catch (error) {
      logger.error('Error handling settings callback', { 
        error: error.message, 
        data, 
        telegramUserId 
      });
      await this.bot.sendMessage(chatId, '❌ Ошибка при обработке настройки.');
    }
  }

  setupErrorHandlers() {
    // Handle polling errors
    this.bot.on('polling_error', (error) => {
      logger.error('Polling error', { 
        error: error.message,
        code: error.code
      });
      
      // Handle 409 Conflict specifically (multiple instances)
      if (error.code === 'ETELEGRAM' && error.message.includes('409')) {
        logger.warn('Multiple bot instances detected - stopping this instance');
        this.gracefulShutdown();
        return;
      }
      
      // Attempt to restart polling if it's a network issue
      if (error.code === 'EFATAL' || (error.code === 'ETELEGRAM' && !error.message.includes('409'))) {
        // Exponential backoff for restart attempts
        const delay = Math.min(5000 * Math.pow(2, (this.restartAttempts || 0)), 30000);
        this.restartAttempts = (this.restartAttempts || 0) + 1;
        
        setTimeout(() => {
          if (this.isRunning) {
            logger.info('Attempting to restart polling...', { attempt: this.restartAttempts, delay });
            this.restartPolling();
          }
        }, delay);
      }
    });

    // Handle webhook errors (if using webhooks)
    this.bot.on('webhook_error', (error) => {
      logger.error('Webhook error', { error: error.message });
    });

    // Handle general errors
    this.bot.on('error', (error) => {
      logger.error('Bot error', { error: error.message });
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', { 
        reason: reason?.message || reason,
        promise: promise.toString()
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error: error.message });
      this.gracefulShutdown();
    });

    logger.info('Error handlers set up');
  }

  async restartPolling() {
    try {
      // Stop polling gracefully
      if (this.bot.isPolling()) {
        await this.bot.stopPolling();
        logger.info('Polling stopped for restart');
      }
      
      // Wait before restarting
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Check if we should still restart
      if (!this.isRunning) {
        logger.info('Bot shutdown during restart - aborting restart');
        return;
      }
      
      // Restart polling
      await this.bot.startPolling();
      this.restartAttempts = 0; // Reset restart attempts on success
      logger.info('Polling restarted successfully');
    } catch (error) {
      logger.error('Failed to restart polling', { error: error.message });
      // Don't retry immediately on failure
    }
  }

  setupGracefulShutdown() {
    const shutdownSignals = ['SIGTERM', 'SIGINT', 'SIGQUIT'];
    
    shutdownSignals.forEach(signal => {
      process.on(signal, () => {
        logger.info(`Received ${signal}, starting graceful shutdown...`);
        this.gracefulShutdown();
      });
    });

    logger.info('Graceful shutdown handlers set up');
  }

  async gracefulShutdown() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    logger.info('Starting graceful shutdown...');

    try {
      // Stop bot polling
      if (this.bot) {
        await this.bot.stopPolling();
        logger.info('Bot polling stopped');
      }

      // Close database connection
      if (dbManager) {
        await dbManager.close();
        logger.info('Database connection closed');
      }

      logger.info('Graceful shutdown completed');
      process.exit(0);

    } catch (error) {
      logger.error('Error during graceful shutdown', { error: error.message });
      process.exit(1);
    }
  }

  async start() {
    try {
      if (this.isRunning) {
        logger.warn('Bot is already running');
        return;
      }

      await this.initialize();
      
      // Start polling
      this.bot.startPolling();
      this.isRunning = true;

      logger.info('🤖 PsychoTrainer Bot v3.0 started successfully!', {
        nodeEnv: config.app.nodeEnv,
        botUsername: (await this.bot.getMe()).username
      });

      // Log system stats periodically
      this.startSystemMonitoring();

    } catch (error) {
      logger.error('Failed to start bot', { error: error.message });
      throw error;
    }
  }

  startSystemMonitoring() {
    // Log system stats every 10 minutes
    setInterval(async () => {
      try {
        const dbStats = dbManager.getStats();
        const memUsage = process.memoryUsage();
        
        logger.info('System status', {
          memory: {
            rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB'
          },
          database: dbStats,
          uptime: Math.round(process.uptime() / 60) + 'min'
        });
      } catch (error) {
        logger.error('Error collecting system stats', { error: error.message });
      }
    }, 10 * 60 * 1000);
  }

  // Health check endpoint (for monitoring)
  async healthCheck() {
    try {
      const botInfo = await this.bot.getMe();
      const dbHealth = await dbManager.healthCheck();
      
      return {
        status: 'healthy',
        bot: {
          username: botInfo.username,
          running: this.isRunning
        },
        database: {
          connected: dbHealth
        },
        uptime: process.uptime(),
        memory: process.memoryUsage()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }
}

// Create and start bot instance
const bot = new PsychoTrainerBot();

// Handle startup
if (import.meta.url === `file://${process.argv[1]}`) {
  bot.start().catch(error => {
    logger.error('Bot startup failed', { error: error.message });
    process.exit(1);
  });
}

export default bot;