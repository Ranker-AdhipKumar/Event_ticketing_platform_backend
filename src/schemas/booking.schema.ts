import { z } from 'zod';

export const createBookingSchema = z.object({
  eventId: z.string().min(1, 'eventId is required'),
  ticketQuantity: z
    .number()
    .int('Ticket quantity must be an integer')
    .min(1, 'Must book at least 1 ticket')
    .max(20, 'Cannot book more than 20 tickets in a single transaction'),
});

export const listBookingsQuerySchema = z.object({
  status: z.enum(['CONFIRMED', 'CANCELLED', 'REFUNDED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;
