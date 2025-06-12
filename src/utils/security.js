import crypto from 'crypto';
import config from '../config/index.js';
import logger from './logger.js';

class SecurityManager {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.keyLength = 32;
    this.ivLength = 16;
    this.tagLength = 16;
  }

  // Generate a secure random key
  generateKey() {
    return crypto.randomBytes(this.keyLength);
  }

  // Generate a secure random IV
  generateIV() {
    return crypto.randomBytes(this.ivLength);
  }

  // Encrypt sensitive data
  encrypt(data, key = null) {
    try {
      const encryptionKey = key || Buffer.from(config.database.encryptionKey, 'utf-8');
      const iv = this.generateIV();
      
      const cipher = crypto.createCipher(this.algorithm, encryptionKey);
      cipher.setAAD(Buffer.from('psycho-trainer-v3', 'utf-8'));
      
      let encrypted = cipher.update(data, 'utf-8', 'hex');
      encrypted += cipher.final('hex');
      
      const tag = cipher.getAuthTag();
      
      // Combine IV, tag, and encrypted data
      const result = iv.toString('hex') + tag.toString('hex') + encrypted;
      
      return result;
      
    } catch (error) {
      logger.error('Encryption failed', { error: error.message });
      throw new Error('Encryption failed');
    }
  }

  // Decrypt sensitive data
  decrypt(encryptedData, key = null) {
    try {
      const decryptionKey = key || Buffer.from(config.database.encryptionKey, 'utf-8');
      
      // Extract IV, tag, and encrypted content
      const iv = Buffer.from(encryptedData.slice(0, this.ivLength * 2), 'hex');
      const tag = Buffer.from(encryptedData.slice(this.ivLength * 2, (this.ivLength + this.tagLength) * 2), 'hex');
      const encrypted = encryptedData.slice((this.ivLength + this.tagLength) * 2);
      
      const decipher = crypto.createDecipher(this.algorithm, decryptionKey);
      decipher.setAAD(Buffer.from('psycho-trainer-v3', 'utf-8'));
      decipher.setAuthTag(tag);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
      decrypted += decipher.final('utf-8');
      
      return decrypted;
      
    } catch (error) {
      logger.error('Decryption failed', { error: error.message });
      throw new Error('Decryption failed');
    }
  }

  // Hash sensitive data (one-way)
  hash(data, salt = null) {
    try {
      const hashSalt = salt || crypto.randomBytes(16);
      const hash = crypto.pbkdf2Sync(data, hashSalt, 100000, 64, 'sha512');
      
      return {
        hash: hash.toString('hex'),
        salt: hashSalt.toString('hex')
      };
    } catch (error) {
      logger.error('Hashing failed', { error: error.message });
      throw new Error('Hashing failed');
    }
  }

  // Verify hashed data
  verifyHash(data, hash, salt) {
    try {
      const hashSalt = Buffer.from(salt, 'hex');
      const computedHash = crypto.pbkdf2Sync(data, hashSalt, 100000, 64, 'sha512');
      
      return computedHash.toString('hex') === hash;
    } catch (error) {
      logger.error('Hash verification failed', { error: error.message });
      return false;
    }
  }

  // Generate secure session token
  generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  // Generate secure API key
  generateApiKey() {
    const timestamp = Date.now().toString();
    const random = crypto.randomBytes(16).toString('hex');
    return `pt3_${timestamp}_${random}`;
  }

  // Sanitize SQL input to prevent injection
  sanitizeSQLInput(input) {
    if (typeof input !== 'string') {
      return input;
    }
    
    return input
      .replace(/['";\\]/g, '') // Remove dangerous SQL characters
      .replace(/--/g, '') // Remove SQL comments
      .replace(/\/\*/g, '') // Remove block comments start
      .replace(/\*\//g, '') // Remove block comments end
      .trim();
  }

  // Rate limiting with sliding window
  class RateLimiter {
    constructor(windowMs = 60000, maxRequests = 100) {
      this.windowMs = windowMs;
      this.maxRequests = maxRequests;
      this.requests = new Map();
    }

    isAllowed(identifier) {
      const now = Date.now();
      const userRequests = this.requests.get(identifier) || [];
      
      // Remove old requests outside the window
      const validRequests = userRequests.filter(timestamp => now - timestamp < this.windowMs);
      
      if (validRequests.length >= this.maxRequests) {
        return false;
      }
      
      validRequests.push(now);
      this.requests.set(identifier, validRequests);
      
      return true;
    }

    cleanup() {
      const now = Date.now();
      for (const [identifier, requests] of this.requests.entries()) {
        const validRequests = requests.filter(timestamp => now - timestamp < this.windowMs);
        if (validRequests.length === 0) {
          this.requests.delete(identifier);
        } else {
          this.requests.set(identifier, validRequests);
        }
      }
    }
  }

  // Create rate limiter instance
  createRateLimiter(windowMs, maxRequests) {
    return new this.RateLimiter(windowMs, maxRequests);
  }

  // Secure random number generation
  secureRandom(min = 0, max = 100) {
    const range = max - min + 1;
    const bytesNeeded = Math.ceil(Math.log2(range) / 8);
    const maxValid = Math.floor(256 ** bytesNeeded / range) * range - 1;
    
    let randomBytes;
    let randomValue;
    
    do {
      randomBytes = crypto.randomBytes(bytesNeeded);
      randomValue = 0;
      for (let i = 0; i < bytesNeeded; i++) {
        randomValue = randomValue * 256 + randomBytes[i];
      }
    } while (randomValue > maxValid);
    
    return min + (randomValue % range);
  }

  // Input sanitization for different contexts
  sanitizeInput(input, context = 'general') {
    if (typeof input !== 'string') {
      return input;
    }

    let sanitized = input.trim();

    switch (context) {
      case 'sql':
        sanitized = this.sanitizeSQLInput(sanitized);
        break;
      
      case 'html':
        sanitized = sanitized
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#x27;')
          .replace(/&/g, '&amp;');
        break;
      
      case 'javascript':
        sanitized = sanitized
          .replace(/[<>\"']/g, '')
          .replace(/javascript:/gi, '')
          .replace(/on\w+=/gi, '');
        break;
      
      case 'filename':
        sanitized = sanitized
          .replace(/[^a-zA-Z0-9.-]/g, '_')
          .replace(/\.+/g, '.')
          .substring(0, 255);
        break;
      
      default:
        sanitized = sanitized
          .replace(/[<>\"'&]/g, '')
          .substring(0, 1000);
    }

    return sanitized;
  }

  // Content Security Policy headers
  getCSPHeader() {
    return {
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "connect-src 'self' https://api.anthropic.com",
        "font-src 'self'",
        "object-src 'none'",
        "media-src 'self'",
        "frame-src 'none'"
      ].join('; ')
    };
  }

  // Security headers
  getSecurityHeaders() {
    return {
      ...this.getCSPHeader(),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    };
  }

  // Audit logging
  auditLog(action, userId, details = {}) {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      action,
      userId,
      userAgent: details.userAgent || 'unknown',
      ip: details.ip || 'unknown',
      details: details.data || {},
      severity: details.severity || 'info'
    };

    logger.info('Security audit', auditEntry);
    
    // In production, this could also write to a separate audit log file
    // or send to a SIEM system
    return auditEntry;
  }

  // Check for suspicious patterns in user input
  detectSuspiciousActivity(input, userId) {
    const suspiciousPatterns = [
      /union\s+select/i,
      /drop\s+table/i,
      /<script/i,
      /javascript:/i,
      /eval\s*\(/i,
      /document\.cookie/i,
      /window\.location/i,
      /alert\s*\(/i
    ];

    const found = suspiciousPatterns.find(pattern => pattern.test(input));
    
    if (found) {
      this.auditLog('suspicious_input_detected', userId, {
        pattern: found.toString(),
        input: input.substring(0, 100),
        severity: 'warning'
      });
      
      return true;
    }
    
    return false;
  }
}

// Singleton instance
const securityManager = new SecurityManager();

export default securityManager;