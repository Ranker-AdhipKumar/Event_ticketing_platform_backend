import { Redis } from 'ioredis';
import { config } from '../config/index.js';

let redisClient: Redis | null = null;
const memoryCache = new Map<string, { value: string; expiresAt: number }>();

export function initRedis(): Redis | null {
  if (!config.redis.enabled) {
    return null;
  }

  try {
    redisClient = new Redis(config.redis.url, {
      maxRetriesPerRequest: 1,
      retryStrategy(times: number) {
        if (times > 3) return null; // Stop retrying after 3 attempts
        return Math.min(times * 100, 2000);
      },
      lazyConnect: true,
    });

    redisClient.on('error', (err: any) => {
      if (config.env !== 'test') {
        console.warn('Redis error (falling back to memory cache):', err.message);
      }
    });

    redisClient.connect().catch(() => {
      // Handled via error listener
    });

    return redisClient;
  } catch {
    return null;
  }
}

export function getRedisClient(): Redis | null {
  return redisClient;
}

export async function getCache<T>(key: string): Promise<T | null> {
  if (redisClient && redisClient.status === 'ready') {
    try {
      const data = await redisClient.get(key);
      if (data) return JSON.parse(data) as T;
    } catch {
      // Fallback to memory
    }
  }

  // Memory cache fallback
  const record = memoryCache.get(key);
  if (record) {
    if (Date.now() > record.expiresAt) {
      memoryCache.delete(key);
      return null;
    }
    return JSON.parse(record.value) as T;
  }

  return null;
}

export async function setCache(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
  const json = JSON.stringify(value);

  if (redisClient && redisClient.status === 'ready') {
    try {
      await redisClient.setex(key, ttlSeconds, json);
      return;
    } catch {
      // Fallback to memory
    }
  }

  memoryCache.set(key, {
    value: json,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

export async function invalidateCachePattern(pattern: string): Promise<void> {
  if (redisClient && redisClient.status === 'ready') {
    try {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
    } catch {
      // Ignore
    }
  }

  // Invalidate memory cache matching prefix/wildcard
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  for (const key of memoryCache.keys()) {
    if (regex.test(key)) {
      memoryCache.delete(key);
    }
  }
}

export function clearAllMemoryCache(): void {
  memoryCache.clear();
}
