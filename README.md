# 🎟️ Event Ticketing Platform Backend API

A high-performance, concurrency-resilient, production-grade RESTful backend service for event discovery, ticket booking, and organizer management. Built with **TypeScript**, **Node.js (Express)**, **ACID Transactions & Pessimistic Locking (PostgreSQL & SQLite)**, **JWT Authentication with Refresh Token Rotation**, and **Redis Caching & Sliding-Window Rate Limiting**.

---

### 🌐 Permanent Live Deployment Links
- 🚀 **Live Interactive Demo**: [https://eventticketingplatformbackend.vercel.app/](https://eventticketingplatformbackend.vercel.app/)
- 📖 **Live Swagger / OpenAPI Documentation**: [https://eventticketingplatformbackend.vercel.app/api/docs](https://eventticketingplatformbackend.vercel.app/api/docs)
- 📄 **Machine-Readable OpenAPI JSON**: [https://eventticketingplatformbackend.vercel.app/api/docs.json](https://eventticketingplatformbackend.vercel.app/api/docs.json)
- 🩺 **Health Check Endpoint**: [https://eventticketingplatformbackend.vercel.app/health](https://eventticketingplatformbackend.vercel.app/health)

---

## 📑 Table of Contents
1. [Live Demo & Interactive Features](#-permanent-live-deployment-links)
2. [Architecture Overview](#-architecture-overview)
3. [Data Model & Database Schema](#-data-model--database-schema)
4. [Concurrency Control & Overbooking Prevention](#-concurrency-control--overbooking-prevention)
5. [Conflict & Error Handling Strategy](#-conflict--error-handling-strategy)
6. [API Specification & Endpoints](#-api-specification--endpoints)
7. [Security Guidelines](#-security-guidelines)
8. [Bonus Challenges Implemented](#-bonus-challenges-implemented)
9. [Testing & Race Condition Verification](#-testing--race-condition-verification)
10. [Deployment Guide (Vercel, Docker, Railway, Render)](#-deployment-guide)

---

## 🏛 Architecture Overview

```
                          ┌──────────────────────┐
                          │   HTTP / REST API    │
                          │   Express + Helmet   │
                          └──────────┬───────────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         │                           │                           │
         ▼                           ▼                           ▼
┌──────────────────┐       ┌──────────────────┐        ┌───────────────────┐
│   Auth Module    │       │   Event Module   │        │  Booking Module   │
│ - Bcrypt Hashing │       │ - Search & Filter│        │ - Rate Limiter    │
│ - JWT Access     │       │ - Sales Summary  │        │ - Atomic Decrement│
│ - Refresh Family │       │ - Cascade Cancel │        │ - Cancellation    │
└────────┬─────────┘       └────────┬─────────┘        └─────────┬─────────┘
         │                          │                            │
         ▼                          ▼                            ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                   ACID Storage Layer (PostgreSQL / SQLite)              │
│       - Row-Level Locking (SELECT ... FOR UPDATE / BEGIN IMMEDIATE)       │
│       - CHECK constraints (available_seats >= 0, ticket_quantity > 0)    │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Dual-Engine DB Support**: Zero-configuration, lightning-fast execution via Node's native `DatabaseSync` (`SQLite WAL`) for local development and unit tests, alongside production-ready pooled `PostgreSQL 16` connectivity.
- **Strict Concurrency Protection**: High-contention race conditions on the last available seats are resolved via database-level serialization and atomic row-level locks.
- **Refresh Token Rotation**: Protects user sessions with cryptographic token families and automated reuse detection.
- **Interactive OpenAPI 3.0 Documentation**: Live Swagger UI served at `/api/docs` and machine-readable JSON at `/api/docs.json`.

---

## 🗄 Data Model & Database Schema

The relational schema enforces referential integrity, check constraints, and performance indexes.

### Relational Schema Diagram

```
┌─────────────────────────┐           ┌─────────────────────────────────┐
│          users          │           │             events              │
├─────────────────────────┤           ├─────────────────────────────────┤
│ id (PK)                 │ 1       * │ id (PK)                         │
│ email (UNIQUE)          ├──────────►│ organizer_id (FK -> users.id)   │
│ password_hash           │           │ title                           │
│ name                    │           │ description                     │
│ role (ATTENDEE/ORG)     │           │ category                        │
│ created_at, updated_at  │           │ city, venue                     │
└───────────┬─────────────┘           │ date                            │
            │                         │ ticket_price (CHECK >= 0)       │
            │ 1                       │ total_capacity (CHECK > 0)      │
            │                         │ available_seats (CHECK >= 0)    │
            │                         │ status (PUBLISHED/CANCELLED...) │
            │ *                       └────────────────┬────────────────┘
┌───────────▼─────────────┐                            │ 1
│     refresh_tokens      │                            │
├─────────────────────────┤                            │
│ id (PK)                 │                            │
│ user_id (FK -> users)   │                            │ *
│ token_hash (UNIQUE)     │                   ┌────────▼────────────────┐
│ family (UUID)           │                   │        bookings         │
│ is_revoked (BOOLEAN)    │                   ├─────────────────────────┤
│ expires_at              │                   │ id (PK)                 │
└─────────────────────────┘                   │ event_id (FK -> events) │
                                              │ user_id (FK -> users)   │
                                              │ ticket_quantity (> 0)   │
                                              │ total_price             │
                                              │ status (CONFIRMED...)   │
                                              └─────────────────────────┘
```

### Table Definitions & Key Indexes
1. **`users`**:
   - `id VARCHAR(36) PRIMARY KEY`
   - `email VARCHAR(255) UNIQUE NOT NULL`
   - `password_hash VARCHAR(255) NOT NULL`
   - `name VARCHAR(255) NOT NULL`
   - `role VARCHAR(20) NOT NULL CHECK (role IN ('ATTENDEE', 'ORGANIZER'))`
   - Indexes: `idx_users_email`, `idx_users_role`

2. **`events`**:
   - `id VARCHAR(36) PRIMARY KEY`
   - `organizer_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE`
   - `title VARCHAR(255) NOT NULL`, `description TEXT NOT NULL`
   - `category VARCHAR(100) NOT NULL`, `city VARCHAR(100) NOT NULL`, `venue VARCHAR(255) NOT NULL`
   - `date TIMESTAMP NOT NULL`
   - `ticket_price NUMERIC(10,2) NOT NULL CHECK (ticket_price >= 0)`
   - `total_capacity INTEGER NOT NULL CHECK (total_capacity > 0)`
   - `available_seats INTEGER NOT NULL CHECK (available_seats >= 0)`
   - `status VARCHAR(50) NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED', 'CANCELLED', 'COMPLETED'))`
   - Indexes: `idx_events_organizer`, `idx_events_category`, `idx_events_city`, `idx_events_date`, `idx_events_price`, `idx_events_status`, `idx_events_composite_search`

3. **`bookings`**:
   - `id VARCHAR(36) PRIMARY KEY`
   - `event_id VARCHAR(36) NOT NULL REFERENCES events(id) ON DELETE RESTRICT`
   - `user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE`
   - `ticket_quantity INTEGER NOT NULL CHECK (ticket_quantity > 0)`
   - `total_price NUMERIC(10,2) NOT NULL CHECK (total_price >= 0)`
   - `status VARCHAR(50) NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED', 'CANCELLED', 'REFUNDED'))`
   - Indexes: `idx_bookings_user`, `idx_bookings_event`, `idx_bookings_status`, `idx_bookings_created`

4. **`refresh_tokens`**:
   - `id VARCHAR(36) PRIMARY KEY`
   - `user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE`
   - `token_hash VARCHAR(255) UNIQUE NOT NULL`
   - `family VARCHAR(36) NOT NULL` (UUID)
   - `is_revoked INTEGER NOT NULL DEFAULT 0`
   - Indexes: `idx_refresh_tokens_hash`, `idx_refresh_tokens_user`, `idx_refresh_tokens_family`

---

## ⚡ Concurrency Control & Overbooking Prevention

### The Problem: Race Conditions in Ticketing
When 2 attendees simultaneously attempt to book the last remaining seat:
1. Request A reads `available_seats = 1`.
2. Request B reads `available_seats = 1`.
3. Request A passes validation and updates `available_seats = 0`.
4. Request B passes validation and updates `available_seats = -1` (or 0), and inserts a second booking.
**Result**: 2 tickets issued for 1 seat (**Overbooking**).

### Our Solution: Two-Layer Defense-in-Depth

#### 1. In PostgreSQL (Pessimistic Row-Level Lock)
Every booking operation begins an explicit ACID transaction:
```sql
BEGIN;

-- Locks ONLY the specific event row from any concurrent writer until transaction commits
SELECT * FROM events 
WHERE id = $1 
FOR UPDATE;

-- Strict In-Transaction Checks:
-- 1. Event exists and status == 'PUBLISHED'
-- 2. Event start date > NOW()
-- 3. available_seats >= requested_quantity

-- If validation passes:
UPDATE events 
SET available_seats = available_seats - $quantity, updated_at = CURRENT_TIMESTAMP
WHERE id = $eventId;

INSERT INTO bookings (id, event_id, user_id, ticket_quantity, total_price, status, created_at, updated_at)
VALUES ($bookingId, $eventId, $userId, $quantity, $totalPrice, 'CONFIRMED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

COMMIT;
```

#### 2. In SQLite (Immediate Reserved Transaction + Atomic Conditional Decrement)
SQLite executes write transactions via `BEGIN IMMEDIATE`:
```sql
BEGIN IMMEDIATE;

-- Atomic update statement with strict precondition guard:
UPDATE events 
SET available_seats = available_seats - ? 
WHERE id = ? 
  AND available_seats >= ? 
  AND status = 'PUBLISHED';
```
If two requests execute concurrently, only the one whose decrement condition (`available_seats >= requested_quantity`) holds will return `changes = 1`. The second request receives `changes = 0`, is rolled back immediately, and returns an HTTP `409 Conflict` with error code `INSUFFICIENT_CAPACITY`.

#### 3. Database Invariant Check Constraint
The database schema defines `available_seats INTEGER NOT NULL CHECK (available_seats >= 0)`. Even if application-level logic were bypassed, the database engine physically rejects any operation that would result in a negative seat count.

---

## 🛡 Conflict & Error Handling Strategy

All error responses strictly adhere to a consistent JSON format:
```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_CAPACITY",
    "message": "Insufficient capacity. Only 1 seat(s) available, but requested 2.",
    "details": {
      "available_seats": 1,
      "requested_quantity": 2
    }
  }
}
```

### Standard Error Code Registry

| HTTP Status | Error Code | Description / Scenario |
| :--- | :--- | :--- |
| **400 Bad Request** | `VALIDATION_ERROR` | Request payload failed Zod schema validation (e.g. invalid email, weak password). |
| **400 Bad Request** | `EVENT_NOT_ACTIVE` | Attempted to book tickets for an event that is `CANCELLED` or `COMPLETED`. |
| **400 Bad Request** | `EVENT_ALREADY_STARTED`| Attempted to book, modify, or cancel an event that has already occurred. |
| **400 Bad Request** | `CANCELLATION_WINDOW_CLOSED`| Attendee attempted to cancel booking within 24 hours of event start. |
| **401 Unauthorized** | `INVALID_CREDENTIALS` | Incorrect email or password. |
| **401 Unauthorized** | `TOKEN_EXPIRED` | JWT access token expired. |
| **401 Unauthorized** | `TOKEN_REUSE_DETECTED`| Replay attack detected: already-used refresh token was re-submitted. |
| **403 Forbidden** | `INSUFFICIENT_PERMISSIONS` | Attendee attempted to create an event, or organizer attempted to book a ticket. |
| **403 Forbidden** | `FORBIDDEN_EVENT_ACCESS` | Organizer attempted to modify, delete, or view reports of another organizer's event. |
| **404 Not Found** | `EVENT_NOT_FOUND` / `BOOKING_NOT_FOUND` | Resource ID does not exist in database. |
| **409 Conflict** | `INSUFFICIENT_CAPACITY` | Not enough seats remaining to fulfill booking request. |
| **409 Conflict** | `EMAIL_ALREADY_EXISTS` | User registration with an already-registered email. |
| **429 Too Many Requests**| `BOOKING_RATE_LIMIT_EXCEEDED`| Exceeded 5 booking attempts per minute. Includes `Retry-After` header. |

---

## 📡 API Specification & Endpoints

### 1. Authentication (`/api/auth`)

#### `POST /api/auth/register`
- **Access**: Public
- **Body**:
```json
{
  "email": "organizer@example.com",
  "password": "Password123",
  "name": "Jane Organizer",
  "role": "ORGANIZER"
}
```
- **Response (201 Created)**:
```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "user": { "id": "uuid", "email": "organizer@example.com", "name": "Jane Organizer", "role": "ORGANIZER" },
    "accessToken": "eyJhbGciOi...",
    "refreshToken": "7c9e01..."
  }
}
```

#### `POST /api/auth/login`
- **Access**: Public
- **Body**: `{ "email": "organizer@example.com", "password": "Password123" }`
- **Response (200 OK)**: Returns user profile and fresh token pair.

#### `POST /api/auth/refresh`
- **Access**: Public
- **Body**: `{ "refreshToken": "7c9e01..." }`
- **Response (200 OK)**: Returns new `accessToken` and rotated `refreshToken`.

#### `POST /api/auth/logout`
- **Access**: Public
- **Body**: `{ "refreshToken": "7c9e01..." }`
- **Response (200 OK)**: Revokes active token family.

#### `GET /api/auth/me`
- **Access**: Authenticated (`Bearer <token>`)
- **Response (200 OK)**: Returns current authenticated user profile.

---

### 2. Events (`/api/events`)

#### `GET /api/events`
- **Access**: Public
- **Query Parameters**:
  - `category` (string, e.g. `Concert`)
  - `city` (string, e.g. `New York`)
  - `minPrice` (number), `maxPrice` (number)
  - `startDate`, `endDate` (ISO 8601 strings)
  - `search` (keyword search)
  - `page` (default: 1), `limit` (default: 10)
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "id": "e30528ef-3b10-4d56-b072-4d1e2e0ab03b",
      "organizer_id": "...",
      "title": "Summer Jazz Fest",
      "category": "Concert",
      "city": "Chicago",
      "venue": "Millennium Park",
      "date": "2026-08-15T18:00:00.000Z",
      "ticket_price": 45.00,
      "total_capacity": 500,
      "available_seats": 420,
      "status": "PUBLISHED"
    }
  ],
  "pagination": { "total": 1, "page": 1, "limit": 10, "totalPages": 1 }
}
```

#### `GET /api/events/search`
- **Access**: Public
- **Query Parameters**: `q` (keyword query), `page`, `limit`.

#### `GET /api/events/:id`
- **Access**: Public
- **Response (200 OK)**: Detailed view of event and remaining capacity.

#### `POST /api/events`
- **Access**: Organizer Only (`Bearer <token>`)
- **Body**:
```json
{
  "title": "AI Builders Summit",
  "description": "Deep-dive workshops into production agentic systems.",
  "category": "Conference",
  "city": "San Francisco",
  "venue": "Moscone Center",
  "date": "2026-11-10T09:00:00.000Z",
  "ticketPrice": 250.00,
  "totalCapacity": 300
}
```
- **Response (201 Created)**: Created event object with `available_seats = 300` and `status = 'PUBLISHED'`.

#### `PUT /api/events/:id`
- **Access**: Organizer (Owner Only)
- **Body**: Partial update of title, description, venue, price, capacity.
- **Rule**: If decreasing capacity, cannot reduce below tickets already sold. Cannot modify completed/cancelled events.

#### `DELETE /api/events/:id`
- **Access**: Organizer (Owner Only)
- **Rule**: Rejects deletion if active confirmed bookings exist (must cancel event to cascade refunds first).

#### `POST /api/events/:id/cancel`
- **Access**: Organizer (Owner Only)
- **Action**: Atomically sets event status to `CANCELLED`, cascades `REFUNDED` status to all confirmed bookings, releases seats, and dispatches refund email alerts to attendees.

#### `GET /api/events/:id/summary`
- **Access**: Organizer (Owner Only)
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "eventId": "e30528ef...",
    "title": "AI Builders Summit",
    "status": "PUBLISHED",
    "ticketPrice": 250.00,
    "totalCapacity": 300,
    "availableSeats": 250,
    "ticketsSold": 50,
    "totalRevenue": 12500.00,
    "activeBookingsCount": 25,
    "refundedBookingsCount": 0,
    "cancelledBookingsCount": 2
  }
}
```

#### `GET /api/events/:id/bookings`
- **Access**: Organizer (Owner Only)
- **Response (200 OK)**: List of all bookings made against this event with attendee names and emails.

---

### 3. Bookings (`/api/bookings`)

#### `POST /api/bookings`
- **Access**: Attendee Only (`Bearer <token>`)
- **Protection**: Concurrency-safe atomic transaction + 5 bookings/min rate limiter.
- **Body**:
```json
{
  "eventId": "e30528ef-3b10-4d56-b072-4d1e2e0ab03b",
  "ticketQuantity": 2
}
```
- **Response (201 Created)**:
```json
{
  "success": true,
  "message": "Ticket(s) booked successfully",
  "data": {
    "booking": {
      "id": "b83ef1...",
      "event_id": "e30528ef...",
      "user_id": "...",
      "ticket_quantity": 2,
      "total_price": 90.00,
      "status": "CONFIRMED",
      "created_at": "2026-10-06T19:00:00.000Z"
    },
    "remainingSeats": 418
  }
}
```

#### `GET /api/bookings`
- **Access**: Attendee Only (`Bearer <token>`)
- **Response (200 OK)**: Returns attendee's booking history joined with event details.

#### `POST /api/bookings/:id/cancel`
- **Access**: Attendee (Owner Only)
- **Rule**: Permitted only if the event start time is at least 24 hours in the future (`CANCELLATION_WINDOW_HOURS`). Restores booked seats back to event capacity.

---

## 🔒 Security Guidelines

1. **Password Hashing**:
   - `bcryptjs` with 10 salt rounds. Passwords are never stored or logged in plain text.
2. **Access Token & Refresh Token Rotation**:
   - Access tokens are short-lived (15 minutes).
   - Refresh tokens are long-lived (7 days) and stored as SHA-256 hashes.
   - **Reuse Detection**: Each refresh token belongs to a session family. If a previously-used token is submitted (e.g. captured by an attacker), the entire token family is immediately revoked, terminating all sessions for that lineage.
3. **Role-Based Access Control (RBAC)**:
   - Authorization middleware strictly validates roles (`ATTENDEE` vs `ORGANIZER`).
   - Organizers cannot book tickets; attendees cannot create or manage events.
4. **Ownership Verification**:
   - Organizers can only modify, cancel, or inspect reports for events matching `organizer_id == req.user.userId`.
5. **Rate Limiting**:
   - Sliding-window rate limiter prevents automated bots from hoarding tickets (maximum 5 booking attempts per minute per user/IP).
6. **Input Sanitization & Validation**:
   - Strict Zod schemas sanitize all incoming payloads; malformed inputs fail fast with 400 Bad Request before reaching database or business logic.
7. **Security Headers**:
   - `Helmet` is configured to sanitize headers, guard against XSS, clickjacking, and MIME-sniffing.

---

## 🌟 Bonus Challenges Implemented

| Bonus Feature | Implementation Details |
| :--- | :--- |
| **1. Booking Rate Limiting** | Sliding-window limiter (5 attempts/min) using Redis ZSET when available, with transparent in-memory fallback. Returns `X-RateLimit-*` and `Retry-After` headers. |
| **2. Email Confirmation** | Automated booking confirmation and cancellation/refund notification emails. Supports MailHog SMTP and retains an inspectable in-memory outbox for testing. |
| **3. Automated Cron Worker** | Background worker (`cron.service.ts`) evaluates every 60s and transitions expired events from `PUBLISHED` to `COMPLETED`. |
| **4. Redis Caching & Invalidation** | Public `GET /api/events` responses cached with dynamic TTLs. Instantly invalidated on any organizer event mutation (`create`, `update`, `cancel`, `delete`). |
| **5. Refresh Token Rotation & Revocation** | Cryptographic session rotation with family-level revocation upon replay attack detection. |
| **6. Indexed Search** | Case-insensitive multi-field search endpoint (`/api/events/search?q=...`) over event title and description with composite indexes. |

---

## 🧪 Testing & Race Condition Verification

The test suite covers unit, integration, RBAC, cascade rules, and high-concurrency race condition testing.

### Running Tests
```bash
# Run all 25 integration and unit tests
npm test

# Run dedicated concurrency race condition test
npm run test:concurrency
```

### Concurrency Race Test Details
Located in `tests/concurrency.test.ts`:
- **Scenario**: An exclusive VIP concert is created with **strictly 5 seats** available.
- **Load**: 50 distinct attendee users fire simultaneous booking requests for 1 ticket each using `Promise.all()`.
- **Result**:
  - Exactly **5 requests succeed** with HTTP `201 Created`.
  - Exactly **45 requests receive HTTP `409 Conflict`** with error code `INSUFFICIENT_CAPACITY`.
  - Final database `available_seats` is **exactly 0**.
  - Confirmed bookings in database is **exactly 5**.
  - **Zero overbooking occurred.**

---

## 🚀 Deployment Guide

### Option 1: Vercel Serverless (Permanently Live — Zero Sleep)
The live deployment is hosted permanently on Vercel:
- **Live Demo & Dashboard**: [https://eventticketingplatformbackend.vercel.app/](https://eventticketingplatformbackend.vercel.app/)
- **Live Interactive Swagger UI**: [https://eventticketingplatformbackend.vercel.app/api/docs](https://eventticketingplatformbackend.vercel.app/api/docs)
- **Live Health Check**: [https://eventticketingplatformbackend.vercel.app/health](https://eventticketingplatformbackend.vercel.app/health)

Serverless functions on Vercel remain permanently live 24/7/365 with zero idling or sleep shutdowns.

### Option 2: Docker & Docker Compose (Local & VPS)
```bash
# 1. Clone repository and navigate to backend directory
cd D:\Antigravity\Event_ticketing_platform_backend

# 2. Start all services (API, PostgreSQL, Redis, MailHog)
docker-compose up --build -d

# 3. Access endpoints
# API & Swagger UI: http://localhost:3000/api/docs
# MailHog Web UI:   http://localhost:8025
```

### Option 3: Render.com Deployment
1. Create a free **PostgreSQL Database** on Render.
2. Create a new **Web Service** on Render and link your Git repository.
3. Set Environment Variables:
   - `NODE_ENV`: `production`
   - `DB_CLIENT`: `postgres`
   - `DATABASE_URL`: *[Internal Database URL from Render]*
   - `JWT_ACCESS_SECRET`: *[Generate secure 32+ character random string]*
   - `JWT_REFRESH_SECRET`: *[Generate secure 32+ character random string]*
4. Build Command: `npm install && npm run build`
5. Start Command: `npm start`
6. Live Swagger docs will be immediately accessible at `https://your-service.onrender.com/api/docs`.

### Option 3: Railway.app Deployment
1. In Railway, click **New Project** -> **Deploy from GitHub repo**.
2. Add a **PostgreSQL** database service and an optional **Redis** service from Railway templates.
3. Link the `DATABASE_URL` reference variable to the API service.
4. Railway will automatically detect the `Dockerfile` or `package.json` and deploy.

### Option 4: Fly.io Deployment
```bash
# Launch application
fly launch

# Attach Postgres cluster
fly postgres create
fly postgres attach <postgres-app-name>

# Deploy
fly deploy
```

---

## 📝 Verification Checklist

- [x] Attendee can browse and filter events (category, city, price range, dates, pagination).
- [x] Attendee can view event details and remaining seat capacity.
- [x] Attendee can book one or more tickets (concurrency-safe).
- [x] Attendee can view booking history.
- [x] Attendee can cancel a booking within the 24h cancellation window (restores capacity).
- [x] Organizer can create, edit, and delete own events.
- [x] Organizer can view bookings made against their events.
- [x] Organizer can view sales summary reports (tickets sold, revenue, capacity).
- [x] Organizer can cancel an event (cascades `REFUNDED` status to all bookings).
- [x] Concurrency locking tested with 50 parallel requests competing for 5 seats.
- [x] Refresh token rotation with reuse detection and family revocation.
- [x] Rate limiting middleware (5 bookings/minute per user).
- [x] Background cron job auto-completing past events.
- [x] Live Swagger UI documentation at `/api/docs`.
- [x] All 25 automated tests passing with 100% success rate.
