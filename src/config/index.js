import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    webhook: {
      port: parseInt(process.env.PORT, 10) || 3000,
      url: process.env.WEBHOOK_URL
    }
  },
  
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 2000,
    temperature: 0.7
  },
  
  database: {
    path: process.env.DATABASE_PATH || path.join(__dirname, '../../data/psycho_trainer.db'),
    encryptionKey: process.env.DATABASE_ENCRYPTION_KEY,
    pragma: {
      journal_mode: 'WAL',
      synchronous: 'NORMAL',
      cache_size: -64000,
      temp_store: 'MEMORY',
      mmap_size: 268435456
    }
  },
  
  cache: {
    ttlHours: parseInt(process.env.CACHE_TTL_HOURS, 10) || 24,
    maxEntries: parseInt(process.env.CACHE_MAX_ENTRIES, 10) || 1000,
    cleanupIntervalMs: 30 * 60 * 1000 // 30 minutes
  },
  
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || path.join(__dirname, '../../logs/app.log'),
    maxSize: '20m',
    maxFiles: 5
  },
  
  security: {
    sessionSecret: process.env.SESSION_SECRET,
    rateLimit: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100
    }
  },
  
  app: {
    nodeEnv: process.env.NODE_ENV || 'development',
    isDevelopment: process.env.NODE_ENV === 'development',
    isProduction: process.env.NODE_ENV === 'production'
  }
};

function validateConfig() {
  const required = [
    'TELEGRAM_BOT_TOKEN',
    'ANTHROPIC_API_KEY',
    'DATABASE_ENCRYPTION_KEY',
    'SESSION_SECRET'
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  if (process.env.DATABASE_ENCRYPTION_KEY && process.env.DATABASE_ENCRYPTION_KEY.length !== 32) {
    throw new Error('DATABASE_ENCRYPTION_KEY must be exactly 32 characters long');
  }
}

validateConfig();

export default config;