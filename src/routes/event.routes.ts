import { Router } from 'express';
import { EventController } from '../controllers/event.controller.js';
import { BookingController } from '../controllers/booking.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { validateBody, validateQuery } from '../middlewares/validate.middleware.js';
import {
  createEventSchema,
  updateEventSchema,
  listEventsQuerySchema,
} from '../schemas/event.schema.js';
import { listBookingsQuerySchema } from '../schemas/booking.schema.js';

const router = Router();

// Public routes
router.get('/', validateQuery(listEventsQuerySchema), EventController.listEvents);
router.get('/search', EventController.searchEvents);

// Organizer routes (my events must come before :id to prevent param collision)
router.get(
  '/my-events',
  authenticate,
  requireRole('ORGANIZER'),
  EventController.getMyEvents
);

// Public route to view single event details & capacity
router.get('/:id', EventController.getEventById);

// Organizer CRUD & Management routes
router.post(
  '/',
  authenticate,
  requireRole('ORGANIZER'),
  validateBody(createEventSchema),
  EventController.createEvent
);

router.put(
  '/:id',
  authenticate,
  requireRole('ORGANIZER'),
  validateBody(updateEventSchema),
  EventController.updateEvent
);

router.delete(
  '/:id',
  authenticate,
  requireRole('ORGANIZER'),
  EventController.deleteEvent
);

router.post(
  '/:id/cancel',
  authenticate,
  requireRole('ORGANIZER'),
  EventController.cancelEvent
);

router.get(
  '/:id/summary',
  authenticate,
  requireRole('ORGANIZER'),
  EventController.getSalesSummary
);

router.get(
  '/:id/bookings',
  authenticate,
  requireRole('ORGANIZER'),
  validateQuery(listBookingsQuerySchema),
  BookingController.getEventBookings
);

export default router;
