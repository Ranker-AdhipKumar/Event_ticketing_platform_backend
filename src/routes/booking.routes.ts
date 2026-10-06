import { Router } from 'express';
import { BookingController } from '../controllers/booking.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { validateBody, validateQuery } from '../middlewares/validate.middleware.js';
import { bookingRateLimiter } from '../middlewares/rateLimiter.middleware.js';
import {
  createBookingSchema,
  listBookingsQuerySchema,
} from '../schemas/booking.schema.js';

const router = Router();

// Attendee booking creation (Rate-limited: 5 attempts/minute, protected by atomic lock)
router.post(
  '/',
  authenticate,
  requireRole('ATTENDEE'),
  bookingRateLimiter,
  validateBody(createBookingSchema),
  BookingController.createBooking
);

// Attendee view personal booking history
router.get(
  '/',
  authenticate,
  requireRole('ATTENDEE'),
  validateQuery(listBookingsQuerySchema),
  BookingController.getMyBookings
);

// Attendee cancel personal booking
router.post(
  '/:id/cancel',
  authenticate,
  requireRole('ATTENDEE'),
  BookingController.cancelBooking
);

export default router;
