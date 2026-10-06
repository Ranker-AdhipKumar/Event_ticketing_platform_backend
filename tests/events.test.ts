process.env.NODE_ENV = 'test';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/db/index.js';

const app = createApp();

let organizerToken: string;
let otherOrganizerToken: string;
let attendeeToken: string;
let createdEventId: string;

describe('Event Management & Discovery Endpoints', () => {
  before(async () => {
    await db.init();
    await db.cleanDb();

    // Register test users
    const orgRes = await request(app).post('/api/auth/register').send({
      email: 'org1@example.com',
      password: 'Password123',
      name: 'Main Organizer',
      role: 'ORGANIZER',
    });
    organizerToken = orgRes.body.data.accessToken;

    const otherOrgRes = await request(app).post('/api/auth/register').send({
      email: 'org2@example.com',
      password: 'Password123',
      name: 'Other Organizer',
      role: 'ORGANIZER',
    });
    otherOrganizerToken = otherOrgRes.body.data.accessToken;

    const attRes = await request(app).post('/api/auth/register').send({
      email: 'att1@example.com',
      password: 'Password123',
      name: 'Attendee Bob',
      role: 'ATTENDEE',
    });
    attendeeToken = attRes.body.data.accessToken;
  });

  after(async () => {
    await db.close();
  });

  test('POST /api/events - Organizer successfully creates an event', async () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const res = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        title: 'Tech Conference 2026',
        description: 'Comprehensive engineering conference covering high scale backends.',
        category: 'Conference',
        city: 'New York',
        venue: 'Javits Center Hall 3',
        date: futureDate,
        ticketPrice: 150.0,
        totalCapacity: 200,
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.title, 'Tech Conference 2026');
    assert.equal(res.body.data.available_seats, 200);
    assert.equal(res.body.data.status, 'PUBLISHED');

    createdEventId = res.body.data.id;
  });

  test('POST /api/events - Attendee is forbidden from creating events (403)', async () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const res = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${attendeeToken}`)
      .send({
        title: 'Unauthorized Event',
        description: 'Attendee should not be allowed to post events.',
        category: 'Workshop',
        city: 'Chicago',
        venue: 'Local Hall',
        date: futureDate,
        ticketPrice: 20.0,
        totalCapacity: 50,
      });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'INSUFFICIENT_PERMISSIONS');
  });

  test('GET /api/events - Public browse and filter events', async () => {
    const res = await request(app).get('/api/events').query({
      category: 'Conference',
      city: 'New York',
      minPrice: 50,
      maxPrice: 200,
      page: 1,
      limit: 10,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.length >= 1);
    assert.equal(res.body.data[0].city, 'New York');
    assert.ok(res.body.pagination);
  });

  test('GET /api/events/search - Full text search query', async () => {
    const res = await request(app).get('/api/events/search').query({
      q: 'engineering',
    });

    assert.equal(res.status, 200);
    assert.ok(res.body.data.length >= 1);
    assert.equal(res.body.data[0].title, 'Tech Conference 2026');
  });

  test('GET /api/events/:id - View details and remaining capacity', async () => {
    const res = await request(app).get(`/api/events/${createdEventId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.id, createdEventId);
    assert.equal(res.body.data.available_seats, 200);
  });

  test('PUT /api/events/:id - Owner organizer can update event', async () => {
    const res = await request(app)
      .put(`/api/events/${createdEventId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        venue: 'Javits Center Grand Ballroom',
        ticketPrice: 175.0,
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.venue, 'Javits Center Grand Ballroom');
    assert.equal(Number(res.body.data.ticket_price), 175.0);
  });

  test('PUT /api/events/:id - Other organizer cannot update event (403 Forbidden)', async () => {
    const res = await request(app)
      .put(`/api/events/${createdEventId}`)
      .set('Authorization', `Bearer ${otherOrganizerToken}`)
      .send({
        venue: 'Hacked Venue',
      });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN_EVENT_ACCESS');
  });

  test('GET /api/events/:id/summary - Organizer views sales summary', async () => {
    const res = await request(app)
      .get(`/api/events/${createdEventId}/summary`)
      .set('Authorization', `Bearer ${organizerToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.eventId, createdEventId);
    assert.equal(res.body.data.totalCapacity, 200);
    assert.equal(res.body.data.ticketsSold, 0);
    assert.equal(res.body.data.totalRevenue, 0);
  });

  test('GET /api/events/my-events - Organizer lists own events', async () => {
    const res = await request(app)
      .get('/api/events/my-events')
      .set('Authorization', `Bearer ${organizerToken}`);

    assert.equal(res.status, 200);
    assert.ok(res.body.data.some((e: any) => e.id === createdEventId));
  });
});
