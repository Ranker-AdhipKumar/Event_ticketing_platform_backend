import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError.js';
import type { UserRole } from '../types/index.js';

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(AppError.unauthorized('Authentication required to access this resource'));
    }

    if (!roles.includes(req.user.role)) {
      return next(
        AppError.forbidden(
          `Forbidden: User role '${req.user.role}' is not authorized. Required: ${roles.join(' or ')}`,
          'INSUFFICIENT_PERMISSIONS'
        )
      );
    }

    next();
  };
}
