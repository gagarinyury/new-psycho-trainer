import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { combine, timestamp, errors, json, printf, colorize } = winston.format;

const customFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
  
  if (Object.keys(meta).length > 0) {
    log += ` ${JSON.stringify(meta)}`;
  }
  
  if (stack) {
    log += `\n${stack}`;
  }
  
  return log;
});

const logger = winston.createLogger({
  level: config.logging.level,
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    json()
  ),
  defaultMeta: { service: 'psycho-trainer' },
  transports: [
    new winston.transports.File({
      filename: path.join(path.dirname(config.logging.file), 'error.log'),
      level: 'error',
      maxsize: 20 * 1024 * 1024, // 20MB
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: config.logging.file,
      maxsize: 20 * 1024 * 1024, // 20MB
      maxFiles: 5
    })
  ]
});

if (config.app.isDevelopment) {
  logger.add(new winston.transports.Console({
    format: combine(
      colorize(),
      timestamp({ format: 'HH:mm:ss' }),
      customFormat
    )
  }));
}

export default logger;