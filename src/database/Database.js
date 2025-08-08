import sqlite3 from 'sqlite3';
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
    return new Promise((resolve, reject) => {
      try {
        // Ensure data directory exists
        const dataDir = path.dirname(config.database.path);
        if (!fs.existsSync(dataDir)) {
          fs.mkdirSync(dataDir, { recursive: true });
        }

        // Initialize database connection
        this.db = new sqlite3.Database(config.database.path, (err) => {
          if (err) {
            logger.error('Failed to open database', { error: err.message });
            return reject(err);
          }

          // Set optimal pragma settings
          this.setPragmas()
            .then(() => this.loadSchema())
            .then(() => {
              this.setupPeriodicCleanup();
              this.isInitialized = true;
              logger.info('Database initialized successfully', {
                path: config.database.path
              });
              resolve();
            })
            .catch(reject);
        });
      } catch (error) {
        logger.error('Failed to initialize database', { error: error.message });
        reject(error);
      }
    });
  }

  async setPragmas() {
    const pragmas = config.database?.pragma || {
      journal_mode: 'WAL',
      cache_size: 1000,
      temp_store: 'memory',
      synchronous: 'NORMAL'
    };

    for (const [pragma, value] of Object.entries(pragmas)) {
      await this.run(`PRAGMA ${pragma} = ${value}`);
    }
  }

  async loadSchema() {
    try {
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf-8');
      
      // Execute schema statements
      await this.exec(schema);
      
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
    }, 30 * 60 * 1000);

    // Clean old performance metrics weekly
    setInterval(() => {
      this.cleanOldMetrics();
    }, 7 * 24 * 60 * 60 * 1000); // 7 days
  }

  async cleanExpiredCache() {
    try {
      const result = await this.run(`
        DELETE FROM claude_cache 
        WHERE expires_at < datetime('now')
      `);
      
      if (result.changes > 0) {
        logger.info(`Cleaned ${result.changes} expired cache entries`);
      }
    } catch (error) {
      logger.error('Failed to clean expired cache', { error: error.message });
    }
  }

  async cleanOldMetrics() {
    try {
      const result = await this.run(`
        DELETE FROM performance_metrics 
        WHERE recorded_at < datetime('now', '-30 days')
      `);
      
      if (result.changes > 0) {
        logger.info(`Cleaned ${result.changes} old performance metrics`);
      }
    } catch (error) {
      logger.error('Failed to clean old metrics', { error: error.message });
    }
  }

  // Promise wrapper for sqlite3 run method
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized && !sql.includes('PRAGMA')) {
        return reject(new Error('Database not initialized'));
      }

      this.db.run(sql, params, function(err) {
        if (err) {
          logger.error('Failed to execute SQL', { 
            sql: sql.substring(0, 100), 
            error: err.message 
          });
          return reject(err);
        }
        resolve({ changes: this.changes, lastID: this.lastID });
      });
    });
  }

  // Promise wrapper for sqlite3 get method
  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        return reject(new Error('Database not initialized'));
      }

      this.db.get(sql, params, (err, row) => {
        if (err) {
          logger.error('Failed to execute SQL', { 
            sql: sql.substring(0, 100), 
            error: err.message 
          });
          return reject(err);
        }
        resolve(row);
      });
    });
  }

  // Promise wrapper for sqlite3 all method
  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        return reject(new Error('Database not initialized'));
      }

      this.db.all(sql, params, (err, rows) => {
        if (err) {
          logger.error('Failed to execute SQL', { 
            sql: sql.substring(0, 100), 
            error: err.message 
          });
          return reject(err);
        }
        resolve(rows);
      });
    });
  }

  // Promise wrapper for sqlite3 exec method
  exec(sql) {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err) => {
        if (err) {
          logger.error('Failed to execute SQL', { 
            sql: sql.substring(0, 100), 
            error: err.message 
          });
          return reject(err);
        }
        resolve();
      });
    });
  }

  // Health check for monitoring
  async healthCheck() {
    try {
      const result = await this.get('SELECT 1 as health');
      return result?.health === 1;
    } catch (error) {
      logger.error('Database health check failed', { error: error.message });
      return false;
    }
  }

  // Graceful shutdown
  async close() {
    if (this.db) {
      return new Promise((resolve) => {
        this.db.close((err) => {
          if (err) {
            logger.error('Error closing database', { error: err.message });
          } else {
            logger.info('Database connection closed');
          }
          resolve();
        });
      });
    }
  }

  // Get database statistics
  async getStats() {
    if (!this.isInitialized) {
      return null;
    }

    try {
      const [users, patients, sessions, messages, cacheEntries] = await Promise.all([
        this.get('SELECT COUNT(*) as count FROM users').then(r => r?.count || 0),
        this.get('SELECT COUNT(*) as count FROM patients WHERE is_active = 1').then(r => r?.count || 0),
        this.get('SELECT COUNT(*) as count FROM sessions').then(r => r?.count || 0),
        this.get('SELECT COUNT(*) as count FROM messages').then(r => r?.count || 0),
        this.get('SELECT COUNT(*) as count FROM claude_cache WHERE expires_at > datetime("now")').then(r => r?.count || 0)
      ]);

      const stats = {
        users,
        patients,
        sessions,
        messages,
        cacheEntries,
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