import crypto from 'crypto';
import { db } from '../db/index.js';
import { config } from '../config/index.js';
import { AppError } from '../errors/AppError.js';
import { invalidateCachePattern } from './cache.service.js';
import { emailService } from './email.service.js';
import type { Booking, EventItem, PaginatedResult, User } from '../types/index.js';
import type { CreateBookingInput, ListBookingsQuery } from '../schemas/booking.schema.js';

export interface BookingWithEvent extends Booking {
  event: Pick<EventItem, 'title' | 'date' | 'venue' | 'city' | 'status'>;
}

export interface BookingWithUser extends Booking {
  attendee: Pick<User, 'name' | 'email'>;
}

export class BookingService {
  static async createBooking(
    userId: string,
    input: CreateBookingInput
  ): Promise<{ booking: Booking; remainingSeats: number }> {
    const event = await db.queryOne<EventItem>('SELECT * FROM events WHERE id = ?', [input.eventId]);

    if (!event) {
      throw AppError.notFound('Event not found', 'EVENT_NOT_FOUND');
    }

    if (event.status !== 'PUBLISHED') {
      throw AppError.badRequest(
        `Event is not open for bookings (status: ${event.status})`,
        'EVENT_NOT_ACTIVE'
      );
    }

    if (new Date(event.date).getTime() <= Date.now()) {
      throw AppError.badRequest(
        'Cannot book tickets for an event that has already started or ended',
        'EVENT_ALREADY_STARTED'
      );
    }

    if (event.available_seats < input.ticketQuantity) {
      throw AppError.conflict(
        `Insufficient capacity. Only ${event.available_seats} seat(s) remaining for this event.`,
        'INSUFFICIENT_CAPACITY',
        { available_seats: event.available_seats, requested_quantity: input.ticketQuantity }
      );
    }

    const bookingId = crypto.randomUUID();
    const totalPrice = Number((Number(event.ticket_price) * input.ticketQuantity).toFixed(2));

    // Atomic execution with concurrency lock
    const { booking, remainingSeats, event: updatedEvent } = await db.bookTicketsAtomic({
      bookingId,
      eventId: input.eventId,
      userId,
      quantity: input.ticketQuantity,
      totalPrice,
    });

    // Invalidate cached event listings
    await invalidateCachePattern('events:*');

    // Asynchronously send booking confirmation email
    db.queryOne<User>('SELECT email, name FROM users WHERE id = ?', [userId])
      .then((user) => {
        if (user) {
          emailService.sendBookingConfirmation(booking, updatedEvent, user);
        }
      })
      .catch(() => {});

    return { booking, remainingSeats };
  }

  static async cancelBooking(
    bookingId: string,
    userId: string
  ): Promise<{ booking: Booking; restoredSeats: number }> {
    const result = await db.cancelBookingAtomic({
      bookingId,
      userId,
      cancellationWindowHours: config.cancellationWindowHours,
    });

    // Invalidate cached event listings
    await invalidateCachePattern('events:*');

    // Asynchronously send booking cancellation email
    db.queryOne<User>('SELECT email, name FROM users WHERE id = ?', [userId])
      .then((user) => {
        if (user) {
          emailService.sendBookingCancellation(result.booking, result.event, user);
        }
      })
      .catch(() => {});

    return {
      booking: result.booking,
      restoredSeats: result.restoredSeats,
    };
  }

  static async getUserBookings(
    userId: string,
    query: ListBookingsQuery
  ): Promise<PaginatedResult<BookingWithEvent>> {
    const conditions = ['b.user_id = ?'];
    const params: unknown[] = [userId];

    if (query.status) {
      conditions.push('b.status = ?');
      params.push(query.status);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countSql = `SELECT COUNT(*) as total FROM bookings b ${whereClause}`;
    const countRow = await db.queryOne<{ total: number }>(countSql, params);
    const total = Number(countRow?.total || 0);

    const limit = query.limit || 10;
    const page = query.page || 1;
    const offset = (page - 1) * limit;

    const selectSql = `
      SELECT 
        b.id, b.event_id, b.user_id, b.ticket_quantity, b.total_price, b.status, b.created_at, b.updated_at,
        e.title as event_title, e.date as event_date, e.venue as event_venue, e.city as event_city, e.status as event_status
      FROM bookings b
      JOIN events e ON b.event_id = e.id
      ${whereClause}
      ORDER BY b.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const rows = await db.query<any>(selectSql, [...params, limit, offset]);

    const formatted: BookingWithEvent[] = rows.map((r) => ({
      id: r.id,
      event_id: r.event_id,
      user_id: r.user_id,
      ticket_quantity: r.ticket_quantity,
      total_price: Number(r.total_price),
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      event: {
        title: r.event_title,
        date: r.event_date,
        venue: r.event_venue,
        city: r.event_city,
        status: r.event_status,
      },
    }));

    return {
      data: formatted,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  static async getEventBookingsForOrganizer(
    eventId: string,
    organizerId: string,
    query: ListBookingsQuery
  ): Promise<PaginatedResult<BookingWithUser>> {
    const event = await db.queryOne<EventItem>('SELECT * FROM events WHERE id = ?', [eventId]);

    if (!event) {
      throw AppError.notFound('Event not found', 'EVENT_NOT_FOUND');
    }

    if (event.organizer_id !== organizerId) {
      throw AppError.forbidden(
        'You can only view bookings for events you own',
        'FORBIDDEN_EVENT_ACCESS'
      );
    }

    const conditions = ['b.event_id = ?'];
    const params: unknown[] = [eventId];

    if (query.status) {
      conditions.push('b.status = ?');
      params.push(query.status);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countSql = `SELECT COUNT(*) as total FROM bookings b ${whereClause}`;
    const countRow = await db.queryOne<{ total: number }>(countSql, params);
    const total = Number(countRow?.total || 0);

    const limit = query.limit || 10;
    const page = query.page || 1;
    const offset = (page - 1) * limit;

    const selectSql = `
      SELECT 
        b.id, b.event_id, b.user_id, b.ticket_quantity, b.total_price, b.status, b.created_at, b.updated_at,
        u.name as attendee_name, u.email as attendee_email
      FROM bookings b
      JOIN users u ON b.user_id = u.id
      ${whereClause}
      ORDER BY b.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const rows = await db.query<any>(selectSql, [...params, limit, offset]);

    const formatted: BookingWithUser[] = rows.map((r) => ({
      id: r.id,
      event_id: r.event_id,
      user_id: r.user_id,
      ticket_quantity: r.ticket_quantity,
      total_price: Number(r.total_price),
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      attendee: {
        name: r.attendee_name,
        email: r.attendee_email,
      },
    }));

    return {
      data: formatted,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }
}
