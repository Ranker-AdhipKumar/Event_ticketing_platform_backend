import crypto from 'crypto';
import { db } from '../db/index.js';
import { AppError } from '../errors/AppError.js';
import { getCache, setCache, invalidateCachePattern } from './cache.service.js';
import { emailService } from './email.service.js';
import type {
  EventItem,
  PaginatedResult,
  SalesSummary,
  Booking,
  User,
} from '../types/index.js';
import type {
  CreateEventInput,
  UpdateEventInput,
  ListEventsQuery,
} from '../schemas/event.schema.js';

export class EventService {
  static async listEvents(query: ListEventsQuery): Promise<PaginatedResult<EventItem>> {
    const cacheKey = `events:list:${crypto
      .createHash('md5')
      .update(JSON.stringify(query))
      .digest('hex')}`;

    const cached = await getCache<PaginatedResult<EventItem>>(cacheKey);
    if (cached) {
      return cached;
    }

    const conditions: string[] = [];
    const params: unknown[] = [];

    // Filter by status (default to PUBLISHED for public listings if not specified)
    if (query.status) {
      conditions.push('status = ?');
      params.push(query.status);
    } else {
      conditions.push("status = 'PUBLISHED'");
    }

    if (query.category) {
      conditions.push('LOWER(category) = LOWER(?)');
      params.push(query.category);
    }

    if (query.city) {
      conditions.push('LOWER(city) = LOWER(?)');
      params.push(query.city);
    }

    if (query.minPrice !== undefined) {
      conditions.push('ticket_price >= ?');
      params.push(query.minPrice);
    }

    if (query.maxPrice !== undefined) {
      conditions.push('ticket_price <= ?');
      params.push(query.maxPrice);
    }

    if (query.startDate) {
      conditions.push('date >= ?');
      params.push(query.startDate);
    }

    if (query.endDate) {
      conditions.push('date <= ?');
      params.push(query.endDate);
    }

    if (query.search) {
      conditions.push('(LOWER(title) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?))');
      const searchPattern = `%${query.search}%`;
      params.push(searchPattern, searchPattern);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Total count
    const countSql = `SELECT COUNT(*) as total FROM events ${whereClause}`;
    const countRow = await db.queryOne<{ total: number }>(countSql, params);
    const total = Number(countRow?.total || 0);

    const limit = query.limit || 10;
    const page = query.page || 1;
    const offset = (page - 1) * limit;

    const selectSql = `
      SELECT * FROM events 
      ${whereClause} 
      ORDER BY date ASC 
      LIMIT ? OFFSET ?
    `;

    const events = await db.query<EventItem>(selectSql, [...params, limit, offset]);

    const result: PaginatedResult<EventItem> = {
      data: events,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };

    // Cache results for 60 seconds
    await setCache(cacheKey, result, 60);

    return result;
  }

  static async searchEvents(
    searchTerm: string,
    page = 1,
    limit = 10
  ): Promise<PaginatedResult<EventItem>> {
    return this.listEvents({
      search: searchTerm,
      page,
      limit,
    });
  }

  static async getEventById(id: string): Promise<EventItem> {
    const event = await db.queryOne<EventItem>('SELECT * FROM events WHERE id = ?', [id]);
    if (!event) {
      throw AppError.notFound('Event not found', 'EVENT_NOT_FOUND');
    }
    return event;
  }

  static async createEvent(organizerId: string, input: CreateEventInput): Promise<EventItem> {
    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT INTO events (
        id, organizer_id, title, description, category, city, venue, 
        date, ticket_price, total_capacity, available_seats, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PUBLISHED', ?, ?)`,
      [
        eventId,
        organizerId,
        input.title,
        input.description,
        input.category,
        input.city,
        input.venue,
        input.date,
        input.ticketPrice,
        input.totalCapacity,
        input.totalCapacity, // initially available seats = total capacity
        now,
        now,
      ]
    );

    await invalidateCachePattern('events:*');

    return this.getEventById(eventId);
  }

  static async updateEvent(
    eventId: string,
    organizerId: string,
    input: UpdateEventInput
  ): Promise<EventItem> {
    const event = await this.getEventById(eventId);

    if (event.organizer_id !== organizerId) {
      throw AppError.forbidden('You can only update events that you own', 'FORBIDDEN_EVENT_ACCESS');
    }

    if (event.status === 'CANCELLED' || event.status === 'COMPLETED') {
      throw AppError.badRequest(
        `Cannot update event because it is already ${event.status.toLowerCase()}`,
        'CANNOT_MODIFY_INACTIVE_EVENT'
      );
    }

    if (new Date(event.date).getTime() <= Date.now()) {
      throw AppError.badRequest(
        'Cannot update an event that has already started or ended',
        'EVENT_ALREADY_STARTED'
      );
    }

    const updates: string[] = [];
    const params: unknown[] = [];

    if (input.title !== undefined) {
      updates.push('title = ?');
      params.push(input.title);
    }
    if (input.description !== undefined) {
      updates.push('description = ?');
      params.push(input.description);
    }
    if (input.category !== undefined) {
      updates.push('category = ?');
      params.push(input.category);
    }
    if (input.city !== undefined) {
      updates.push('city = ?');
      params.push(input.city);
    }
    if (input.venue !== undefined) {
      updates.push('venue = ?');
      params.push(input.venue);
    }
    if (input.date !== undefined) {
      updates.push('date = ?');
      params.push(input.date);
    }
    if (input.ticketPrice !== undefined) {
      updates.push('ticket_price = ?');
      params.push(input.ticketPrice);
    }

    if (input.totalCapacity !== undefined) {
      const ticketsSold = event.total_capacity - event.available_seats;
      if (input.totalCapacity < ticketsSold) {
        throw AppError.badRequest(
          `Cannot reduce total capacity to ${input.totalCapacity} because ${ticketsSold} tickets have already been booked.`,
          'CAPACITY_LESS_THAN_SOLD'
        );
      }
      const newAvailable = input.totalCapacity - ticketsSold;
      updates.push('total_capacity = ?');
      params.push(input.totalCapacity);
      updates.push('available_seats = ?');
      params.push(newAvailable);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(eventId);

    const sql = `UPDATE events SET ${updates.join(', ')} WHERE id = ?`;
    await db.execute(sql, params);

    await invalidateCachePattern('events:*');

    return this.getEventById(eventId);
  }

  static async deleteEvent(eventId: string, organizerId: string): Promise<void> {
    const event = await this.getEventById(eventId);

    if (event.organizer_id !== organizerId) {
      throw AppError.forbidden('You can only delete events that you own', 'FORBIDDEN_EVENT_ACCESS');
    }

    // Check if any confirmed bookings exist
    const activeBooking = await db.queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM bookings WHERE event_id = ? AND status = 'CONFIRMED'",
      [eventId]
    );

    if (activeBooking && Number(activeBooking.count) > 0) {
      throw AppError.badRequest(
        'Cannot delete an event with active bookings. Cancel the event instead to process refunds.',
        'EVENT_HAS_ACTIVE_BOOKINGS'
      );
    }

    await db.execute('DELETE FROM events WHERE id = ?', [eventId]);
    await invalidateCachePattern('events:*');
  }

  static async cancelEvent(
    eventId: string,
    organizerId: string
  ): Promise<{ event: EventItem; refundedCount: number }> {
    const result = await db.cancelEventAtomic({ eventId, organizerId });

    await invalidateCachePattern('events:*');

    // Notify affected attendees asynchronously
    for (const booking of result.refundedBookings) {
      db.queryOne<User>('SELECT email FROM users WHERE id = ?', [booking.user_id])
        .then((user) => {
          if (user) {
            emailService.sendEventCancellationRefund(booking, result.event, user.email);
          }
        })
        .catch(() => {});
    }

    return {
      event: result.event,
      refundedCount: result.refundedBookings.length,
    };
  }

  static async getOrganizerSalesSummary(
    organizerId: string,
    eventId: string
  ): Promise<SalesSummary> {
    const event = await this.getEventById(eventId);

    if (event.organizer_id !== organizerId) {
      throw AppError.forbidden(
        'You can only view sales summary for events you own',
        'FORBIDDEN_EVENT_ACCESS'
      );
    }

    const bookings = await db.query<Booking>('SELECT * FROM bookings WHERE event_id = ?', [eventId]);

    let confirmedCount = 0;
    let refundedCount = 0;
    let cancelledCount = 0;
    let ticketsSold = 0;
    let totalRevenue = 0;

    for (const b of bookings) {
      if (b.status === 'CONFIRMED') {
        confirmedCount++;
        ticketsSold += b.ticket_quantity;
        totalRevenue += Number(b.total_price);
      } else if (b.status === 'REFUNDED') {
        refundedCount++;
      } else if (b.status === 'CANCELLED') {
        cancelledCount++;
      }
    }

    return {
      eventId: event.id,
      title: event.title,
      status: event.status,
      ticketPrice: Number(event.ticket_price),
      totalCapacity: event.total_capacity,
      availableSeats: event.available_seats,
      ticketsSold,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      activeBookingsCount: confirmedCount,
      refundedBookingsCount: refundedCount,
      cancelledBookingsCount: cancelledCount,
    };
  }

  static async getOrganizerEvents(
    organizerId: string,
    page = 1,
    limit = 10
  ): Promise<PaginatedResult<EventItem>> {
    const countRow = await db.queryOne<{ total: number }>(
      'SELECT COUNT(*) as total FROM events WHERE organizer_id = ?',
      [organizerId]
    );
    const total = Number(countRow?.total || 0);

    const offset = (page - 1) * limit;
    const events = await db.query<EventItem>(
      'SELECT * FROM events WHERE organizer_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [organizerId, limit, offset]
    );

    return {
      data: events,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }
}
