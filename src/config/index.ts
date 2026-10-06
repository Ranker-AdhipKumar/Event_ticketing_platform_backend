import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  get env() {
    return process.env.NODE_ENV || 'development';
  },
  get port() {
    return parseInt(process.env.PORT || '3000', 10);
  },

  db: {
    get client() {
      return (process.env.DB_CLIENT || 'sqlite').toLowerCase() as 'sqlite' | 'postgres';
    },
    get sqlitePath() {
      return process.env.SQLITE_DB_PATH || path.join(process.cwd(), 'data', 'tickets.db');
    },
    get postgresUrl() {
      return (
        process.env.DATABASE_URL ||
        'postgres://postgres:postgres@localhost:5432/event_ticketing_db'
      );
    },
  },

  jwt: {
    accessSecret:
      process.env.JWT_ACCESS_SECRET ||
      'default_jwt_access_secret_super_secure_32_chars_min!',
    refreshSecret:
      process.env.JWT_REFRESH_SECRET ||
      'default_jwt_refresh_secret_super_secure_32_chars_min!',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRATION || '15m',
    refreshExpiresInDays: 7,
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    get enabled() {
      return process.env.REDIS_ENABLED === 'true';
    },
  },

  bookingRateLimit: {
    windowMs: parseInt(process.env.BOOKING_RATE_LIMIT_WINDOW_MS || '60000', 10),
    max: parseInt(process.env.BOOKING_RATE_LIMIT_MAX || '5', 10),
  },

  cancellationWindowHours: parseInt(process.env.CANCELLATION_WINDOW_HOURS || '24', 10),

  smtp: {
    host: process.env.SMTP_HOST || 'localhost',
    port: parseInt(process.env.SMTP_PORT || '1025', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'no-reply@eventticketing.example.com',
  },
};
