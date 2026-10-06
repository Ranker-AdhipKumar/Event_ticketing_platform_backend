import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';
import { AppError } from '../errors/AppError.js';
import type { Booking, EventItem, User, RefreshToken } from '../types/index.js';

const { Pool } = pg;

export interface IDatabase {
  init(): Promise<void>;
  close(): Promise<void>;
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = any>(sql: string, params?: unknown[]): Promise<T | null>;
  execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }>;
  bookTicketsAtomic(params: {
    bookingId: string;
    eventId: string;
    userId: string;
    quantity: number;
    totalPrice: number;
  }): Promise<{ booking: Booking; remainingSeats: number; event: EventItem }>;
  cancelBookingAtomic(params: {
    bookingId: string;
    userId: string;
    cancellationWindowHours: number;
  }): Promise<{ booking: Booking; event: EventItem; restoredSeats: number }>;
  cancelEventAtomic(params: {
    eventId: string;
    organizerId: string;
  }): Promise<{ event: EventItem; refundedBookings: Booking[] }>;
  cleanDb(): Promise<void>;
}

function convertToPgPlaceholders(sql: string): string {
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

class SqliteDatabase implements IDatabase {
  private db: DatabaseSync | null = null;
  private dbPath?: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath;
  }

  async init(customPath?: string): Promise<void> {
    const targetPath = customPath || this.dbPath || config.db.sqlitePath;
    this.dbPath = targetPath;

    const dir = path.dirname(targetPath);
    if (targetPath !== ':memory:' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(targetPath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');

    // Load and run schema
    const schemaPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'schema.sql');
    // On Windows, fix leading slash from pathname if needed
    const cleanSchemaPath = process.platform === 'win32' && schemaPath.startsWith('/') 
      ? schemaPath.slice(1) 
      : schemaPath;

    let schemaSql: string;
    try {
      schemaSql = fs.readFileSync(cleanSchemaPath, 'utf8');
    } catch {
      // Fallback relative path
      schemaSql = fs.readFileSync(path.join(process.cwd(), 'src', 'db', 'schema.sql'), 'utf8');
    }
    this.db.exec(schemaSql);
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async cleanDb(): Promise<void> {
    const db = this.getDb();
    db.exec('DELETE FROM refresh_tokens;');
    db.exec('DELETE FROM bookings;');
    db.exec('DELETE FROM events;');
    db.exec('DELETE FROM users;');
  }

  private getDb(): DatabaseSync {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const db = this.getDb();
    const stmt = db.prepare(sql);
    return stmt.all(...(params as any[])) as T[];
  }

  async queryOne<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
    const db = this.getDb();
    const stmt = db.prepare(sql);
    const row = stmt.get(...(params as any[]));
    return (row as T) || null;
  }

  async execute(sql: string, params: unknown[] = []): Promise<{ rowCount: number }> {
    const db = this.getDb();
    const stmt = db.prepare(sql);
    const result = stmt.run(...(params as any[]));
    return { rowCount: Number(result.changes) };
  }

  async bookTicketsAtomic(params: {
    bookingId: string;
    eventId: string;
    userId: string;
    quantity: number;
    totalPrice: number;
  }): Promise<{ booking: Booking; remainingSeats: number; event: EventItem }> {
    const db = this.getDb();

    // In SQLite, BEGIN IMMEDIATE reserves exclusive write lock immediately
    db.exec('BEGIN IMMEDIATE;');
    try {
      const eventStmt = db.prepare('SELECT * FROM events WHERE id = ?');
      const event = eventStmt.get(params.eventId) as unknown as EventItem | undefined;

      if (!event) {
        throw AppError.notFound('Event not found', 'EVENT_NOT_FOUND');
      }

      if (event.status !== 'PUBLISHED') {
        throw AppError.badRequest(
          `Event is not open for bookings (current status: ${event.status})`,
          'EVENT_NOT_ACTIVE'
        );
      }

      const eventDate = new Date(event.date);
      if (eventDate.getTime() <= Date.now()) {
        throw AppError.badRequest(
          'Cannot book tickets for an event that has already started or ended',
          'EVENT_ALREADY_STARTED'
        );
      }

      if (event.available_seats < params.quantity) {
        throw AppError.conflict(
          `Insufficient capacity. Only ${event.available_seats} seat(s) available, but requested ${params.quantity}.`,
          'INSUFFICIENT_CAPACITY',
          { available_seats: event.available_seats, requested_quantity: params.quantity }
        );
      }

      // Decrement available seats atomically
      const updateStmt = db.prepare(
        'UPDATE events SET available_seats = available_seats - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND available_seats >= ?'
      );
      const updateResult = updateStmt.run(params.quantity, params.eventId, params.quantity);

      if (Number(updateResult.changes) === 0) {
        throw AppError.conflict(
          'Failed to reserve seats due to concurrent booking contention. Please try again.',
          'CONCURRENT_BOOKING_CONFLICT'
        );
      }

      // Insert confirmed booking record
      const insertBookingStmt = db.prepare(
        `INSERT INTO bookings (id, event_id, user_id, ticket_quantity, total_price, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'CONFIRMED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      );
      insertBookingStmt.run(
        params.bookingId,
        params.eventId,
        params.userId,
        params.quantity,
        params.totalPrice
      );

      // Fetch the created booking
      const bookingStmt = db.prepare('SELECT * FROM bookings WHERE id = ?');
      const booking = bookingStmt.get(params.bookingId) as unknown as Booking;

      const updatedEvent = eventStmt.get(params.eventId) as unknown as EventItem;

      db.exec('COMMIT;');

      return {
        booking,
        remainingSeats: updatedEvent.available_seats,
        event: updatedEvent,
      };
    } catch (error) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        // Ignore rollback failure if transaction wasn't active
      }
      throw error;
    }
  }

  async cancelBookingAtomic(params: {
    bookingId: string;
    userId: string;
    cancellationWindowHours: number;
  }): Promise<{ booking: Booking; event: EventItem; restoredSeats: number }> {
    const db = this.getDb();
    db.exec('BEGIN IMMEDIATE;');
    try {
      const bookingStmt = db.prepare('SELECT * FROM bookings WHERE id = ? AND user_id = ?');
      const booking = bookingStmt.get(params.bookingId, params.userId) as unknown as Booking | undefined;

      if (!booking) {
        throw AppError.notFound('Booking not found or not owned by user', 'BOOKING_NOT_FOUND');
      }

      if (booking.status !== 'CONFIRMED') {
        throw AppError.badRequest(
          `Booking cannot be cancelled because it is already ${booking.status.toLowerCase()}`,
          'BOOKING_NOT_CONFIRMED'
        );
      }

      const eventStmt = db.prepare('SELECT * FROM events WHERE id = ?');
      const event = eventStmt.get(booking.event_id) as unknown as EventItem | undefined;

      if (!event) {
        throw AppError.notFound('Associated event not found', 'EVENT_NOT_FOUND');
      }

      const eventStartTime = new Date(event.date).getTime();
      const cutoffTime = eventStartTime - params.cancellationWindowHours * 60 * 60 * 1000;
      const now = Date.now();

      if (now > cutoffTime) {
        throw AppError.badRequest(
          `Cancellation window has closed. Bookings may only be cancelled at least ${params.cancellationWindowHours} hours prior to event start.`,
          'CANCELLATION_WINDOW_CLOSED'
        );
      }

      // Mark booking as CANCELLED
      const cancelStmt = db.prepare(
        "UPDATE bookings SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      );
      cancelStmt.run(params.bookingId);

      // Restore seats to event
      const restoreSeatsStmt = db.prepare(
        'UPDATE events SET available_seats = available_seats + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      );
      restoreSeatsStmt.run(booking.ticket_quantity, event.id);

      const updatedBooking = bookingStmt.get(params.bookingId, params.userId) as unknown as Booking;
      const updatedEvent = eventStmt.get(event.id) as unknown as EventItem;

      db.exec('COMMIT;');

      return {
        booking: updatedBooking,
        event: updatedEvent,
        restoredSeats: booking.ticket_quantity,
      };
    } catch (error) {
      try {
        db.exec('ROLLBACK;');
      } catch {}
      throw error;
    }
  }

  async cancelEventAtomic(params: {
    eventId: string;
    organizerId: string;
  }): Promise<{ event: EventItem; refundedBookings: Booking[] }> {
    const db = this.getDb();
    db.exec('BEGIN IMMEDIATE;');
    try {
      const eventStmt = db.prepare('SELECT * FROM events WHERE id = ?');
      const event = eventStmt.get(params.eventId) as unknown as EventItem | undefined;

      if (!event) {
        throw AppError.notFound('Event not found', 'EVENT_NOT_FOUND');
      }

      if (event.organizer_id !== params.organizerId) {
        throw AppError.forbidden('You can only cancel events you own', 'FORBIDDEN_EVENT_ACCESS');
      }

      if (event.status === 'CANCELLED') {
        throw AppError.badRequest('Event is already cancelled', 'EVENT_ALREADY_CANCELLED');
      }

      if (new Date(event.date).getTime() <= Date.now()) {
        throw AppError.badRequest(
          'Cannot cancel an event that has already started or completed',
          'EVENT_ALREADY_STARTED'
        );
      }

      // Set event status to CANCELLED
      const updateEventStmt = db.prepare(
        "UPDATE events SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      );
      updateEventStmt.run(params.eventId);

      // Fetch all confirmed bookings to refund
      const confirmedBookingsStmt = db.prepare(
        "SELECT * FROM bookings WHERE event_id = ? AND status = 'CONFIRMED'"
      );
      const affectedBookings = confirmedBookingsStmt.all(params.eventId) as unknown as Booking[];

      // Cascade refund to all confirmed bookings
      const refundBookingsStmt = db.prepare(
        "UPDATE bookings SET status = 'REFUNDED', updated_at = CURRENT_TIMESTAMP WHERE event_id = ? AND status = 'CONFIRMED'"
      );
      refundBookingsStmt.run(params.eventId);

      const updatedEvent = eventStmt.get(params.eventId) as unknown as EventItem;

      // Fetch the updated bookings now marked as REFUNDED
      const refundedBookingsStmt = db.prepare(
        "SELECT * FROM bookings WHERE event_id = ? AND status = 'REFUNDED'"
      );
      const refundedBookings = refundedBookingsStmt.all(params.eventId) as unknown as Booking[];

      db.exec('COMMIT;');

      return {
        event: updatedEvent,
        refundedBookings,
      };
    } catch (error) {
      try {
        db.exec('ROLLBACK;');
      } catch {}
      throw error;
    }
  }
}

class PostgresDatabase implements IDatabase {
  private pool: pg.Pool | null = null;
  private connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  async init(): Promise<void> {
    this.pool = new Pool({
      connectionString: this.connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    const schemaPath = path.join(process.cwd(), 'src', 'db', 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    const client = await this.pool.connect();
    try {
      await client.query(schemaSql);
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  async cleanDb(): Promise<void> {
    const pool = this.getPool();
    await pool.query('TRUNCATE refresh_tokens, bookings, events, users CASCADE;');
  }

  private getPool(): pg.Pool {
    if (!this.pool) {
      throw new Error('Postgres pool not initialized');
    }
    return this.pool;
  }

  async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const pool = this.getPool();
    const pgSql = convertToPgPlaceholders(sql);
    const result = await pool.query(pgSql, params);
    return result.rows as T[];
  }

  async queryOne<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] || null;
  }

  async execute(sql: string, params: unknown[] = []): Promise<{ rowCount: number }> {
    const pool = this.getPool();
    const pgSql = convertToPgPlaceholders(sql);
    const result = await pool.query(pgSql, params);
    return { rowCount: result.rowCount || 0 };
  }

  async bookTicketsAtomic(params: {
    bookingId: string;
    eventId: string;
    userId: string;
    quantity: number;
    totalPrice: number;
  }): Promise<{ booking: Booking; remainingSeats: number; event: EventItem }> {
    const pool = this.getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Pessimistic Row Lock: FOR UPDATE locks this specific event row against concurrent transactions
      const eventRes = await client.query(
        'SELECT * FROM events WHERE id = $1 FOR UPDATE',
        [params.eventId]
      );

      if (eventRes.rowCount === 0) {
        throw AppError.notFound('Event not found', 'EVENT_NOT_FOUND');
      }

      const event = eventRes.rows[0] as EventItem;

      if (event.status !== 'PUBLISHED') {
        throw AppError.badRequest(
          `Event is not open for bookings (current status: ${event.status})`,
          'EVENT_NOT_ACTIVE'
        );
      }

      const eventDate = new Date(event.date);
      if (eventDate.getTime() <= Date.now()) {
        throw AppError.badRequest(
          'Cannot book tickets for an event that has already started or ended',
          'EVENT_ALREADY_STARTED'
        );
      }

      if (event.available_seats < params.quantity) {
        throw AppError.conflict(
          `Insufficient capacity. Only ${event.available_seats} seat(s) available, but requested ${params.quantity}.`,
          'INSUFFICIENT_CAPACITY',
          { available_seats: event.available_seats, requested_quantity: params.quantity }
        );
      }

      // Decrement seats
      const updateRes = await client.query(
        'UPDATE events SET available_seats = available_seats - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
        [params.quantity, params.eventId]
      );
      const updatedEvent = updateRes.rows[0] as EventItem;

      // Insert booking
      const bookingRes = await client.query(
        `INSERT INTO bookings (id, event_id, user_id, ticket_quantity, total_price, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'CONFIRMED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING *`,
        [params.bookingId, params.eventId, params.userId, params.quantity, params.totalPrice]
      );
      const booking = bookingRes.rows[0] as Booking;

      await client.query('COMMIT');

      return {
        booking,
        remainingSeats: updatedEvent.available_seats,
        event: updatedEvent,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelBookingAtomic(params: {
    bookingId: string;
    userId: string;
    cancellationWindowHours: number;
  }): Promise<{ booking: Booking; event: EventItem; restoredSeats: number }> {
    const pool = this.getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const bookingRes = await client.query(
        'SELECT * FROM bookings WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [params.bookingId, params.userId]
      );

      if (bookingRes.rowCount === 0) {
        throw AppError.notFound('Booking not found or not owned by user', 'BOOKING_NOT_FOUND');
      }

      const booking = bookingRes.rows[0] as Booking;

      if (booking.status !== 'CONFIRMED') {
        throw AppError.badRequest(
          `Booking cannot be cancelled because it is already ${booking.status.toLowerCase()}`,
          'BOOKING_NOT_CONFIRMED'
        );
      }

      const eventRes = await client.query('SELECT * FROM events WHERE id = $1 FOR UPDATE', [
        booking.event_id,
      ]);

      if (eventRes.rowCount === 0) {
        throw AppError.notFound('Associated event not found', 'EVENT_NOT_FOUND');
      }

      const event = eventRes.rows[0] as EventItem;

      const eventStartTime = new Date(event.date).getTime();
      const cutoffTime = eventStartTime - params.cancellationWindowHours * 60 * 60 * 1000;
      const now = Date.now();

      if (now > cutoffTime) {
        throw AppError.badRequest(
          `Cancellation window has closed. Bookings may only be cancelled at least ${params.cancellationWindowHours} hours prior to event start.`,
          'CANCELLATION_WINDOW_CLOSED'
        );
      }

      const updatedBookingRes = await client.query(
        "UPDATE bookings SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *",
        [params.bookingId]
      );
      const updatedBooking = updatedBookingRes.rows[0] as Booking;

      const updatedEventRes = await client.query(
        'UPDATE events SET available_seats = available_seats + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
        [booking.ticket_quantity, event.id]
      );
      const updatedEvent = updatedEventRes.rows[0] as EventItem;

      await client.query('COMMIT');

      return {
        booking: updatedBooking,
        event: updatedEvent,
        restoredSeats: booking.ticket_quantity,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelEventAtomic(params: {
    eventId: string;
    organizerId: string;
  }): Promise<{ event: EventItem; refundedBookings: Booking[] }> {
    const pool = this.getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const eventRes = await client.query('SELECT * FROM events WHERE id = $1 FOR UPDATE', [
        params.eventId,
      ]);

      if (eventRes.rowCount === 0) {
        throw AppError.notFound('Event not found', 'EVENT_NOT_FOUND');
      }

      const event = eventRes.rows[0] as EventItem;

      if (event.organizer_id !== params.organizerId) {
        throw AppError.forbidden('You can only cancel events you own', 'FORBIDDEN_EVENT_ACCESS');
      }

      if (event.status === 'CANCELLED') {
        throw AppError.badRequest('Event is already cancelled', 'EVENT_ALREADY_CANCELLED');
      }

      if (new Date(event.date).getTime() <= Date.now()) {
        throw AppError.badRequest(
          'Cannot cancel an event that has already started or completed',
          'EVENT_ALREADY_STARTED'
        );
      }

      const updatedEventRes = await client.query(
        "UPDATE events SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *",
        [params.eventId]
      );
      const updatedEvent = updatedEventRes.rows[0] as EventItem;

      const refundedBookingsRes = await client.query(
        "UPDATE bookings SET status = 'REFUNDED', updated_at = CURRENT_TIMESTAMP WHERE event_id = $1 AND status = 'CONFIRMED' RETURNING *",
        [params.eventId]
      );
      const refundedBookings = refundedBookingsRes.rows as Booking[];

      await client.query('COMMIT');

      return {
        event: updatedEvent,
        refundedBookings,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

// Factory instantiation
export const db: IDatabase =
  config.db.client === 'postgres'
    ? new PostgresDatabase(config.db.postgresUrl)
    : new SqliteDatabase(config.db.sqlitePath);

export function createTestSqliteDb(memoryPath = ':memory:'): IDatabase {
  return new SqliteDatabase(memoryPath);
}
