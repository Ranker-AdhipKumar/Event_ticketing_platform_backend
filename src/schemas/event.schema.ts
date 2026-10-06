import { z } from 'zod';

export const createEventSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(255),
  description: z.string().trim().min(10, 'Description must be at least 10 characters'),
  category: z.string().trim().min(2, 'Category is required').max(100),
  city: z.string().trim().min(2, 'City is required').max(100),
  venue: z.string().trim().min(2, 'Venue is required').max(255),
  date: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), { message: 'Date must be a valid ISO 8601 string' })
    .refine((val) => new Date(val).getTime() > Date.now(), {
      message: 'Event date must be in the future',
    }),
  ticketPrice: z.number().min(0, 'Ticket price must be 0 or greater'),
  totalCapacity: z.number().int().min(1, 'Total capacity must be at least 1 seat'),
});

export const updateEventSchema = z
  .object({
    title: z.string().trim().min(3).max(255).optional(),
    description: z.string().trim().min(10).optional(),
    category: z.string().trim().min(2).max(100).optional(),
    city: z.string().trim().min(2).max(100).optional(),
    venue: z.string().trim().min(2).max(255).optional(),
    date: z
      .string()
      .refine((val) => !isNaN(Date.parse(val)), { message: 'Date must be a valid ISO 8601 string' })
      .refine((val) => new Date(val).getTime() > Date.now(), {
        message: 'Event date must be in the future',
      })
      .optional(),
    ticketPrice: z.number().min(0).optional(),
    totalCapacity: z.number().int().min(1).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided to update',
  });

export const listEventsQuerySchema = z.object({
  category: z.string().trim().optional(),
  city: z.string().trim().optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  startDate: z.string().refine((val) => !val || !isNaN(Date.parse(val)), { message: 'Invalid start date' }).optional(),
  endDate: z.string().refine((val) => !val || !isNaN(Date.parse(val)), { message: 'Invalid end date' }).optional(),
  status: z.enum(['PUBLISHED', 'CANCELLED', 'COMPLETED']).optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
