import type { Request, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { AppError } from '../errors/AppError.js';
import { getRedisClient } from '../services/cache.service.js';

interface MemoryRateLimitRecord {
  timestamps: number[];
}

const memoryStore = new Map<string, MemoryRateLimitRecord>();

// Cleanup stale memory records periodically (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of memoryStore.entries()) {
    record.timestamps = record.timestamps.filter((t) => now - t < config.bookingRateLimit.windowMs);
    if (record.timestamps.length === 0) {
      memoryStore.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

export function bookingRateLimiter(req: Request, res: Response, next: NextFunction): void {
  // Rate limit key: user ID if authenticated, or client IP
  const identifier = req.user?.userId || req.ip || 'anonymous';
  const key = `ratelimit:booking:${identifier}`;
  const limit = config.bookingRateLimit.max;
  const windowMs = config.bookingRateLimit.windowMs;
  const now = Date.now();

  const redis = getRedisClient();

  if (redis && redis.status === 'ready') {
    // Redis sliding window using ZSET
    const clearBefore = now - windowMs;
    redis
      .pipeline()
      .zremrangebyscore(key, 0, clearBefore)
      .zadd(key, now, `${now}-${Math.random()}`)
      .zcard(key)
      .expire(key, Math.ceil(windowMs / 1000))
      .exec()
      .then((results: [Error | null, unknown][] | null) => {
        if (!results) return next();
        const count = results[2][1] as number;
        const remaining = Math.max(0, limit - count);

        res.setHeader('X-RateLimit-Limit', limit);
        res.setHeader('X-RateLimit-Remaining', remaining);
        res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));

        if (count > limit) {
          res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
          return next(
            AppError.tooManyRequests(
              `Booking rate limit exceeded. Maximum ${limit} booking attempts per minute allowed.`,
              'BOOKING_RATE_LIMIT_EXCEEDED'
            )
          );
        }
        next();
      })
      .catch(() => {
        // Fallback to memory store if Redis operation fails
        handleMemoryRateLimit(key, limit, windowMs, now, res, next);
      });
  } else {
    handleMemoryRateLimit(key, limit, windowMs, now, res, next);
  }
}

function handleMemoryRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number,
  res: Response,
  next: NextFunction
): void {
  let record = memoryStore.get(key);
  if (!record) {
    record = { timestamps: [] };
    memoryStore.set(key, record);
  }

  // Filter timestamps within the current sliding window
  record.timestamps = record.timestamps.filter((t) => now - t < windowMs);

  const count = record.timestamps.length + 1;
  const remaining = Math.max(0, limit - count);

  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));

  if (count > limit) {
    res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
    return next(
      AppError.tooManyRequests(
        `Booking rate limit exceeded. Maximum ${limit} booking attempts per minute allowed.`,
        'BOOKING_RATE_LIMIT_EXCEEDED'
      )
    );
  }

  record.timestamps.push(now);
  next();
}

export function resetRateLimits(): void {
  memoryStore.clear();
}
