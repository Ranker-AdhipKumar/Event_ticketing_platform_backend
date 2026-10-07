import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '../db/index.js';
import type { User, EventItem } from '../types/index.js';

export async function seedInitialData(): Promise<void> {
  try {
    const existingEvents = await db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM events'
    );
    if (existingEvents && Number(existingEvents.count) > 0) {
      return; // Already seeded
    }

    const salt = 10;
    const defaultPasswordHash = await bcrypt.hash('Password123', salt);
    const now = new Date().toISOString();

    // 1. Create Default Demo Organizer
    const organizerId = crypto.randomUUID();
    await db.execute(
      `INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'ORGANIZER', ?, ?)`,
      [organizerId, 'organizer@eventdemo.com', defaultPasswordHash, 'Sarah (Event Host)', now, now]
    );

    // 2. Create Default Demo Attendee
    const attendeeId = crypto.randomUUID();
    await db.execute(
      `INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'ATTENDEE', ?, ?)`,
      [attendeeId, 'attendee@eventdemo.com', defaultPasswordHash, 'Alex (Attendee)', now, now]
    );

    // 3. Create Sample Events
    const daysFromNow = (days: number) =>
      new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    const sampleEvents = [
      {
        id: crypto.randomUUID(),
        title: 'Global AI & Cloud Summit 2026',
        description: 'Join industry pioneers exploring agentic AI, distributed systems, and modern cloud architecture.',
        category: 'Conference',
        city: 'San Francisco',
        venue: 'Moscone Center, Hall D',
        date: daysFromNow(14),
        ticketPrice: 199.99,
        totalCapacity: 300,
        availableSeats: 285,
      },
      {
        id: crypto.randomUUID(),
        title: 'Neon Nights Music Festival',
        description: 'An open-air electronic and indie festival featuring leading live sets and immersive visuals.',
        category: 'Concert',
        city: 'New York',
        venue: 'Brooklyn Mirage',
        date: daysFromNow(21),
        ticketPrice: 75.0,
        totalCapacity: 500,
        availableSeats: 410,
      },
      {
        id: crypto.randomUUID(),
        title: 'Distributed Systems & Concurrency Workshop',
        description: 'Hands-on laboratory tackling race conditions, distributed locking, and zero-overbooking architectures.',
        category: 'Workshop',
        city: 'Seattle',
        venue: 'Pike Place Tech Hub',
        date: daysFromNow(7),
        ticketPrice: 49.0,
        totalCapacity: 40,
        availableSeats: 12,
      },
      {
        id: crypto.randomUUID(),
        title: 'VIP Lounge Session (Race Condition Demo)',
        description: 'Special high-demand intimate showcase with strictly 5 seats. Perfect for stress-testing concurrent bookings!',
        category: 'Concert',
        city: 'Austin',
        venue: 'The Red Room VIP',
        date: daysFromNow(10),
        ticketPrice: 120.0,
        totalCapacity: 5,
        availableSeats: 5,
      },
      {
        id: crypto.randomUUID(),
        title: 'Modern Web & Microservices Meetup',
        description: 'Monthly developer community meetup discussing REST APIs, OpenAPI standards, and serverless scalability.',
        category: 'Meetup',
        city: 'Chicago',
        venue: 'The Mart, 8th Floor',
        date: daysFromNow(5),
        ticketPrice: 0.0,
        totalCapacity: 100,
        availableSeats: 94,
      },
    ];

    for (const ev of sampleEvents) {
      await db.execute(
        `INSERT INTO events (
          id, organizer_id, title, description, category, city, venue, 
          date, ticket_price, total_capacity, available_seats, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PUBLISHED', ?, ?)`,
        [
          ev.id,
          organizerId,
          ev.title,
          ev.description,
          ev.category,
          ev.city,
          ev.venue,
          ev.date,
          ev.ticketPrice,
          ev.totalCapacity,
          ev.availableSeats,
          now,
          now,
        ]
      );
    }

    console.log('[Seed] 🌱 Initial demo events and test users populated successfully.');
  } catch (error: any) {
    console.warn('[Seed] Notice on seed execution:', error.message);
  }
}
