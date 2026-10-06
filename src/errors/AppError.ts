export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly details?: unknown;

  constructor(statusCode: number, message: string, errorCode = 'INTERNAL_ERROR', details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message: string, errorCode = 'BAD_REQUEST', details?: unknown): AppError {
    return new AppError(400, message, errorCode, details);
  }

  static unauthorized(message = 'Authentication required', errorCode = 'UNAUTHORIZED'): AppError {
    return new AppError(401, message, errorCode);
  }

  static forbidden(message = 'Access denied for your role or ownership', errorCode = 'FORBIDDEN'): AppError {
    return new AppError(403, message, errorCode);
  }

  static notFound(message = 'Resource not found', errorCode = 'NOT_FOUND'): AppError {
    return new AppError(404, message, errorCode);
  }

  static conflict(message: string, errorCode = 'CONFLICT', details?: unknown): AppError {
    return new AppError(409, message, errorCode, details);
  }

  static tooManyRequests(message = 'Rate limit exceeded. Please try again later.', errorCode = 'RATE_LIMIT_EXCEEDED'): AppError {
    return new AppError(429, message, errorCode);
  }

  static internal(message = 'Internal server error', errorCode = 'INTERNAL_SERVER_ERROR'): AppError {
    return new AppError(500, message, errorCode);
  }
}
