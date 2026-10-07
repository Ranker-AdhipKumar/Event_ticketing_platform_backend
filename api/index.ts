import type { Request, Response } from 'express';
import { createApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { seedInitialData } from '../src/services/seed.service.js';

let initialized = false;
const app = createApp();

export default async function handler(req: Request, res: Response) {
  if (!initialized) {
    await db.init();
    await seedInitialData();
    initialized = true;
  }
  return app(req, res);
}
