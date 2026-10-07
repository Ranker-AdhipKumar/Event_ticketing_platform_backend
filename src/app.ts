import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import authRoutes from './routes/auth.routes.js';
import eventRoutes from './routes/event.routes.js';
import bookingRoutes from './routes/booking.routes.js';
import { openApiSpec } from './docs/openapi.js';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware.js';

export function createApp() {
  const app = express();

  // Security headers (allowing Swagger UI CDN inline scripts & styling)
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  // Enable CORS
  app.use(cors({ origin: '*', credentials: true }));

  // JSON and URL-encoded body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'UP',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // OpenAPI Swagger Documentation
  app.get('/api/docs.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(openApiSpec);
  });
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

  // Serve interactive live UI at root / and /demo
  app.use(express.static('src/public'));
  app.use(express.static('dist/public'));
  app.get(['/', '/demo'], (_req, res) => {
    const htmlPath = path.join(process.cwd(), 'src', 'public', 'index.html');
    res.sendFile(htmlPath);
  });

  // Mount API modules
  app.use('/api/auth', authRoutes);
  app.use('/api/events', eventRoutes);
  app.use('/api/bookings', bookingRoutes);

  // 404 and Error Handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
