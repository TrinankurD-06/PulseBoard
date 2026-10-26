import pino from 'pino';

/** Creates the process-wide pino logger. Pretty output in development, JSON elsewhere. */
export function createLogger({ name, level = process.env.LOG_LEVEL || 'info' } = {}) {
  const isDev = process.env.NODE_ENV === 'development';
  const isTest = process.env.NODE_ENV === 'test';
  return pino({
    name,
    level: isTest ? 'silent' : level,
    redact: ['req.headers.authorization', 'req.headers.cookie', '*.passwordHash', '*.password'],
    transport: isDev
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
  });
}
