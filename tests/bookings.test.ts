process.env.NODE_ENV = 'test';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { emailService } from '../src/services/email.service.js';

const app = createApp();

let organizerToken: string;
let attendeeToken: string;
let eventId: string;
let bookingId: string;

describe('Booking Lifecycle & Cancellation Cascade', () => {
  before(async () => {
    await db.init();
    await db.cleanDb();
    emailService.clearOutbox();

    const orgRes = await request(app).post('/api/auth/register').send({
      email: 'booking.org@example.com',
      password: 'Password123',
      name: 'Concert Host',
      role: 'ORGANIZER',
    });
    organizerToken = orgRes.body.data.accessToken;

    const attRes = await request(app).post('/api/auth/register').send({
      email: 'booking.att@example.com',
      password: 'Password123',
      name: 'Music Lover',
      role: 'ATTENDEE',
    });
    attendeeToken = attRes.body.data.accessToken;

    // Create an event with 10 seats scheduled 5 days from now
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const eventRes = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        title: 'Jazz Night',
        description: 'Smooth jazz evening in the heart of downtown.',
        category: 'Concert',
        city: 'Chicago',
        venue: 'The Blue Note',
        date: futureDate,
        ticketPrice: 50.0,
        totalCapacity: 10,
      });

    eventId = eventRes.body.data.id;
  });

  after(async () => {
    await db.close();
  });

  test('POST /api/bookings - Attendee successfully books 2 tickets', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${attendeeToken}`)
      .send({
        eventId,
        ticketQuantity: 2,
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.booking.ticket_quantity, 2);
    assert.equal(Number(res.body.data.booking.total_price), 100.0);
    assert.equal(res.body.data.remainingSeats, 8);

    bookingId = res.body.data.booking.id;

    // Verify confirmation email was queued
    assert.ok(
      emailService.outbox.some((e) => e.to === 'booking.att@example.com' && e.subject.includes('Jazz Night'))
    );
  });

  test('POST /api/bookings - Organizer is forbidden from booking tickets (403)', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        eventId,
        ticketQuantity: 1,
      });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'INSUFFICIENT_PERMISSIONS');
  });

  test('GET /api/bookings - Attendee views personal booking history', async () => {
    const res = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${attendeeToken}`);

    assert.equal(res.status, 200);
    assert.ok(res.body.data.some((b: any) => b.id === bookingId));
    assert.equal(res.body.data[0].event.title, 'Jazz Night');
  });

  test('GET /api/events/:id/bookings - Organizer views bookings against their event', async () => {
    const res = await request(app)
      .get(`/api/events/${eventId}/bookings`)
      .set('Authorization', `Bearer ${organizerToken}`);

    assert.equal(res.status, 200);
    assert.ok(res.body.data.some((b: any) => b.id === bookingId));
    assert.equal(res.body.data[0].attendee.email, 'booking.att@example.com');
  });

  test('POST /api/bookings/:id/cancel - Attendee cancels booking and restores capacity', async () => {
    const res = await request(app)
      .post(`/api/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${attendeeToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.booking.status, 'CANCELLED');
    assert.equal(res.body.data.restoredSeats, 2);

    // Verify capacity was restored in event table
    const eventRes = await request(app).get(`/api/events/${eventId}`);
    assert.equal(eventRes.body.data.available_seats, 10);
  });

  test('POST /api/events/:id/cancel - Organizer cancels event and cascades refund', async () => {
    // Book a new ticket first
    const bookRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${attendeeToken}`)
      .send({
        eventId,
        ticketQuantity: 3,
      });

    const activeBookingId = bookRes.body.data.booking.id;

    // Organizer cancels event
    const cancelRes = await request(app)
      .post(`/api/events/${eventId}/cancel`)
      .set('Authorization', `Bearer ${organizerToken}`);

    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.body.data.status, 'CANCELLED');
    assert.equal(cancelRes.body.refundedBookingsCount, 1);

    // Verify booking is now marked REFUNDED
    const bookingRow = await db.queryOne<any>('SELECT status FROM bookings WHERE id = ?', [
      activeBookingId,
    ]);
    assert.equal(bookingRow.status, 'REFUNDED');
  });

  test('POST /api/bookings - Rejects booking for cancelled event (400 Bad Request)', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${attendeeToken}`)
      .send({
        eventId,
        ticketQuantity: 1,
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'EVENT_NOT_ACTIVE');
  });
});
