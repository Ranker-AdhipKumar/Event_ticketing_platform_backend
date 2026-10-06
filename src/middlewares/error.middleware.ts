import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError.js';
import { config } from '../config/index.js';

export function errorHandler(
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.errorCode,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }

  // Handle unhandled errors
  if (config.env !== 'test') {
    console.error('Unhandled Server Error:', err);
  }

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal server error occurred',
      ...(config.env === 'development' ? { stack: err.stack } : {}),
    },
  });
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(AppError.notFound(`Endpoint ${req.method} ${req.originalUrl} does not exist`, 'ROUTE_NOT_FOUND'));
}
