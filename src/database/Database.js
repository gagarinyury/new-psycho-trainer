import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config/index.js';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DatabaseManager {
  constructor() {
    this.db = null;
    this.isInitialized = false;
  }

  async initialize() {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(config.database.path);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Initialize database connection
      this.db = new Database(config.database.path);
      
      // Set optimal pragma settings
      Object.entries(config.database.pragma).forEach(([pragma, value]) => {
        this.db.pragma(`${pragma} = ${value}`);
      });

      // Load and execute schema
      await this.loadSchema();
      
      // Set up cleanup tasks
      this.setupPeriodicCleanup();
      
      this.isInitialized = true;
      logger.info('Database initialized successfully', {
        path: config.database.path,
        pragma: config.database.pragma
      });
      
    } catch (error) {
      logger.error('Failed to initialize database', { error: error.message });
      throw error;
    }
  }

  async loadSchema() {
    try {
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf-8');
      
      // Execute schema statements
      this.db.exec(schema);
      
      logger.info('Database schema loaded successfully');
    } catch (error) {
      logger.error('Failed to load database schema', { error: error.message });
      throw error;
    }
  }

  setupPeriodicCleanup() {
    // Clean expired cache entries every 30 minutes
    setInterval(() => {
      this.cleanExpiredCache();
    }, config.cache.cleanupIntervalMs);

    // Clean old performance metrics weekly
    setInterval(() => {
      this.cleanOldMetrics();
    }, 7 * 24 * 60 * 60 * 1000); // 7 days
  }

  cleanExpiredCache() {
    try {
      const result = this.db.prepare(`
        DELETE FROM claude_cache 
        WHERE expires_at < datetime('now')
      `).run();
      
      if (result.changes > 0) {
        logger.info(`Cleaned ${result.changes} expired cache entries`);
      }
    } catch (error) {
      logger.error('Failed to clean expired cache', { error: error.message });
    }
  }

  cleanOldMetrics() {
    try {
      const result = this.db.prepare(`
        DELETE FROM performance_metrics 
        WHERE recorded_at < datetime('now', '-30 days')
      `).run();
      
      if (result.changes > 0) {
        logger.info(`Cleaned ${result.changes} old performance metrics`);
      }
    } catch (error) {
      logger.error('Failed to clean old metrics', { error: error.message });
    }
  }

  // Transaction wrapper for safe operations
  transaction(fn) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }
    
    const transaction = this.db.transaction(fn);
    return transaction;
  }

  // Prepared statement wrapper with error handling
  prepare(sql) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }
    
    try {
      return this.db.prepare(sql);
    } catch (error) {
      logger.error('Failed to prepare SQL statement', { 
        sql: sql.substring(0, 100), 
        error: error.message 
      });
      throw error;
    }
  }

  // Health check for monitoring
  async healthCheck() {
    try {
      const result = this.db.prepare('SELECT 1 as health').get();
      return result.health === 1;
    } catch (error) {
      logger.error('Database health check failed', { error: error.message });
      return false;
    }
  }

  // Graceful shutdown
  async close() {
    if (this.db) {
      try {
        this.db.close();
        logger.info('Database connection closed');
      } catch (error) {
        logger.error('Error closing database', { error: error.message });
      }
    }
  }

  // Get database statistics
  getStats() {
    if (!this.isInitialized) {
      return null;
    }

    try {
      const stats = {
        users: this.db.prepare('SELECT COUNT(*) as count FROM users').get().count,
        patients: this.db.prepare('SELECT COUNT(*) as count FROM patients WHERE is_active = 1').get().count,
        sessions: this.db.prepare('SELECT COUNT(*) as count FROM sessions').get().count,
        messages: this.db.prepare('SELECT COUNT(*) as count FROM messages').get().count,
        cacheEntries: this.db.prepare('SELECT COUNT(*) as count FROM claude_cache WHERE expires_at > datetime("now")').get().count,
        dbSize: fs.statSync(config.database.path).size
      };
      
      return stats;
    } catch (error) {
      logger.error('Failed to get database stats', { error: error.message });
      return null;
    }
  }
}

// Singleton instance
const dbManager = new DatabaseManager();

export default dbManager;