process.env.NODE_ENV = 'test';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/db/index.js';

const app = createApp();

describe('High-Concurrency Race Condition & Overbooking Prevention', () => {
  before(async () => {
    await db.init();
    await db.cleanDb();
  });

  after(async () => {
    await db.close();
  });

  test('CONCURRENCY RACE: 50 simultaneous parallel requests competing for the last 5 seats', async () => {
    const runId = Date.now();

    // 1. Create Organizer
    const orgRes = await request(app).post('/api/auth/register').send({
      email: `race.org.${runId}@example.com`,
      password: 'Password123',
      name: 'Race Organizer',
      role: 'ORGANIZER',
    });
    const organizerToken = orgRes.body.data.accessToken;

    // 2. Create high-demand event with strictly 5 seats remaining
    const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const eventRes = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        title: 'Exclusive Ultra VIP Concert',
        description: 'Only 5 seats exist in the entire venue.',
        category: 'Concert',
        city: 'Tokyo',
        venue: 'Dome VIP Room',
        date: futureDate,
        ticketPrice: 500.0,
        totalCapacity: 5,
      });

    const eventId = eventRes.body.data.id;
    assert.equal(eventRes.body.data.available_seats, 5);

    // 3. Register 50 distinct attendee users to avoid per-user rate limit contention
    const attendeeTokens: string[] = [];
    const NUM_COMPETITORS = 50;

    for (let i = 1; i <= NUM_COMPETITORS; i++) {
      const attRes = await request(app).post('/api/auth/register').send({
        email: `competitor_${runId}_${i}@example.com`,
        password: 'Password123',
        name: `Competitor ${i}`,
        role: 'ATTENDEE',
      });
      attendeeTokens.push(attRes.body.data.accessToken);
    }

    console.log(`[Concurrency Test] 🚀 Firing ${NUM_COMPETITORS} concurrent booking requests simultaneously...`);

    // 4. Fire 50 simultaneous booking requests in parallel
    const bookingPromises = attendeeTokens.map((token) =>
      request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${token}`)
        .send({
          eventId,
          ticketQuantity: 1,
        })
    );

    const responses = await Promise.all(bookingPromises);

    // 5. Analyze HTTP Response codes
    let successCount = 0;
    let conflictCount = 0;
    let otherCount = 0;

    for (const res of responses) {
      if (res.status === 201) {
        successCount++;
      } else if (res.status === 409) {
        conflictCount++;
        assert.ok(
          res.body.error.code === 'INSUFFICIENT_CAPACITY' ||
          res.body.error.code === 'CONCURRENT_BOOKING_CONFLICT'
        );
      } else {
        otherCount++;
        console.warn(`Unexpected response status ${res.status}:`, res.body);
      }
    }

    console.log(`[Concurrency Results] Successes (201): ${successCount}`);
    console.log(`[Concurrency Results] Conflicts (409): ${conflictCount}`);
    console.log(`[Concurrency Results] Other: ${otherCount}`);

    // 6. Strict Assertions: Exactly 5 bookings must succeed, and exactly 45 must be rejected
    assert.equal(successCount, 5, 'Exactly 5 booking requests must succeed');
    assert.equal(conflictCount, 45, 'Exactly 45 booking requests must be rejected with 409 Conflict');
    assert.equal(otherCount, 0, 'No unexpected error codes allowed');

    // 7. Verify Database Integrity
    const updatedEventRes = await request(app).get(`/api/events/${eventId}`);
    assert.equal(
      updatedEventRes.body.data.available_seats,
      0,
      'Event available seats must be exactly 0 (no negative capacity, no under-allocation)'
    );

    const dbBookings = await db.query<any>(
      "SELECT COUNT(*) as count FROM bookings WHERE event_id = ? AND status = 'CONFIRMED'",
      [eventId]
    );
    assert.equal(
      Number(dbBookings[0].count),
      5,
      'Database must contain exactly 5 confirmed booking records for this event'
    );
  });
});
