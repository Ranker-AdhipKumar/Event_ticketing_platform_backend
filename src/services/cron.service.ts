import { db } from '../db/index.js';
import { invalidateCachePattern } from './cache.service.js';
import { config } from '../config/index.js';

let intervalTimer: NodeJS.Timeout | null = null;

export async function sweepExpiredEvents(): Promise<number> {
  try {
    const nowIso = new Date().toISOString();
    // Update all published events whose scheduled datetime is in the past
    const result = await db.execute(
      "UPDATE events SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE status = 'PUBLISHED' AND date <= ?",
      [nowIso]
    );

    if (result.rowCount > 0) {
      if (config.env !== 'test') {
        console.log(`[CronService] ⏰ Auto-completed ${result.rowCount} past event(s).`);
      }
      await invalidateCachePattern('events:*');
    }
    return result.rowCount;
  } catch (err: any) {
    if (config.env !== 'test') {
      console.error('[CronService] Error running event completion sweep:', err.message);
    }
    return 0;
  }
}

export function startEventCompletionCron(intervalMs = 60000): void {
  if (intervalTimer) return;

  // Run initial sweep
  sweepExpiredEvents().catch(() => {});

  intervalTimer = setInterval(() => {
    sweepExpiredEvents().catch(() => {});
  }, intervalMs);

  intervalTimer.unref(); // Allow node process to exit cleanly without waiting for this timer
}

export function stopEventCompletionCron(): void {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
}
