import Joi from 'joi';
import logger from './logger.js';

// User validation schemas
export const userSchema = Joi.object({
  telegram_id: Joi.number().integer().positive().required(),
  username: Joi.string().alphanum().min(3).max(32).allow(null),
  first_name: Joi.string().min(1).max(64).allow(null),
  last_name: Joi.string().min(1).max(64).allow(null),
  language_code: Joi.string().length(2).default('ru')
});

// Patient validation schemas
export const patientCreationSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  age: Joi.number().integer().min(16).max(90).required(),
  gender: Joi.string().valid('male', 'female', 'other').required(),
  background: Joi.string().min(50).max(2000).required(),
  presenting_problem: Joi.string().min(10).max(500).required(),
  personality_traits: Joi.object().required(),
  psychological_profile: Joi.object().required(),
  therapy_goals: Joi.object().optional()
});

// Session validation schemas
export const messageSchema = Joi.object({
  content: Joi.string().min(1).max(1000).required(),
  sender: Joi.string().valid('therapist', 'patient').required()
});

export const sessionNotesSchema = Joi.object({
  notes: Joi.string().max(2000).allow('', null)
});

// Configuration validation schemas
export const configSchema = Joi.object({
  telegram: Joi.object({
    token: Joi.string().required()
  }).required(),
  
  anthropic: Joi.object({
    apiKey: Joi.string().required(),
    model: Joi.string().required(),
    maxTokens: Joi.number().integer().min(100).max(8000),
    temperature: Joi.number().min(0).max(1)
  }).required(),
  
  database: Joi.object({
    path: Joi.string().required(),
    encryptionKey: Joi.string().length(32).required()
  }).required(),
  
  security: Joi.object({
    sessionSecret: Joi.string().min(32).required(),
    rateLimit: Joi.object({
      windowMs: Joi.number().integer().positive(),
      maxRequests: Joi.number().integer().positive()
    })
  }).required()
});

// Custom validation helpers
export class ValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

export function validateAndSanitize(data, schema, options = {}) {
  const { error, value } = schema.validate(data, {
    abortEarly: false,
    stripUnknown: true,
    ...options
  });

  if (error) {
    const details = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message,
      value: detail.context?.value
    }));

    logger.warn('Validation failed', { 
      details,
      originalData: JSON.stringify(data).substring(0, 200)
    });

    throw new ValidationError('Validation failed', details);
  }

  return value;
}

// Sanitize user input to prevent injection attacks
export function sanitizeInput(input) {
  if (typeof input !== 'string') {
    return input;
  }

  return input
    .trim()
    .replace(/[<>\"']/g, '') // Remove potentially dangerous characters
    .substring(0, 1000); // Limit length
}

// Validate Telegram user ID format
export function isValidTelegramId(id) {
  return Number.isInteger(id) && id > 0 && id < 10000000000; // Telegram ID constraints
}

// Validate UUID format
export function isValidUUID(uuid) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

// Rate limiting validation
export function validateRateLimit(requests, windowMs, maxRequests) {
  const now = Date.now();
  const validRequests = requests.filter(timestamp => now - timestamp < windowMs);
  return validRequests.length < maxRequests;
}

// Content safety validation
export function validateContentSafety(content) {
  const dangerousPatterns = [
    /script\s*>/i,
    /javascript:/i,
    /on\w+\s*=/i,
    /eval\s*\(/i,
    /expression\s*\(/i
  ];

  return !dangerousPatterns.some(pattern => pattern.test(content));
}

// Session state validation
export function validateSessionState(session) {
  const requiredFields = ['id', 'userId', 'patientId', 'messages', 'startTime'];
  const missingFields = requiredFields.filter(field => !(field in session));
  
  if (missingFields.length > 0) {
    throw new ValidationError(`Missing session fields: ${missingFields.join(', ')}`);
  }

  if (!Array.isArray(session.messages)) {
    throw new ValidationError('Session messages must be an array');
  }

  if (typeof session.startTime !== 'number' || session.startTime <= 0) {
    throw new ValidationError('Invalid session start time');
  }

  return true;
}

// Database record validation
export function validateDatabaseRecord(record, requiredFields = []) {
  if (!record || typeof record !== 'object') {
    throw new ValidationError('Invalid database record');
  }

  const missingFields = requiredFields.filter(field => !(field in record) || record[field] == null);
  
  if (missingFields.length > 0) {
    throw new ValidationError(`Missing required fields: ${missingFields.join(', ')}`);
  }

  return true;
}

// Export validation middleware for Express (if needed)
export function validationMiddleware(schema) {
  return (req, res, next) => {
    try {
      req.body = validateAndSanitize(req.body, schema);
      next();
    } catch (error) {
      if (error instanceof ValidationError) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.details
        });
      } else {
        next(error);
      }
    }
  };
}