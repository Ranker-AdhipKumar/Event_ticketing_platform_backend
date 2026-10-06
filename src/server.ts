import { createApp } from './app.js';
import { config } from './config/index.js';
import { db } from './db/index.js';
import { initRedis } from './services/cache.service.js';
import { startEventCompletionCron, stopEventCompletionCron } from './services/cron.service.js';

async function bootstrap() {
  try {
    console.log(`[Server] Starting in ${config.env} mode...`);

    // Initialize Database
    await db.init();
    console.log(`[Database] Connected successfully (${config.db.client} backend).`);

    // Initialize Redis (optional, with graceful fallback)
    if (config.redis.enabled) {
      initRedis();
      console.log(`[Redis] Connection initialized (${config.redis.url}).`);
    } else {
      console.log('[Cache] Using high-performance in-memory cache and rate limiter.');
    }

    // Start background event status sweeper
    startEventCompletionCron(60000);
    console.log('[Cron] Event completion background worker active (interval: 60s).');

    // Create Express app
    const app = createApp();

    const server = app.listen(config.port, () => {
      console.log(`[Server] 🚀 Event Ticketing Platform running on port ${config.port}`);
      console.log(`[API Docs] 📖 Swagger UI available at http://localhost:${config.port}/api/docs`);
      console.log(`[Health] 🩺 Health check available at http://localhost:${config.port}/health`);
    });

    // Graceful Shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n[Server] Received ${signal}. Commencing graceful shutdown...`);
      stopEventCompletionCron();
      server.close(async () => {
        console.log('[Server] HTTP connections closed.');
        await db.close();
        console.log('[Database] Connection closed.');
        process.exit(0);
      });

      // Force terminate after 10s timeout
      setTimeout(() => {
        console.error('[Server] Forced shutdown after timeout.');
        process.exit(1);
      }, 10000).unref();
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('[Server] Fatal startup error:', error);
    process.exit(1);
  }
}

bootstrap();
