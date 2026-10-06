process.env.NODE_ENV = 'test';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { AuthService } from '../src/services/auth.service.js';

const app = createApp();

describe('Auth Service & Endpoints', () => {
  before(async () => {
    await db.init();
    await db.cleanDb();
  });

  after(async () => {
    await db.close();
  });

  test('POST /api/auth/register - Successfully registers an Attendee', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'alice.test@example.com',
        password: 'Password123',
        name: 'Alice Attendee',
        role: 'ATTENDEE',
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.user.email, 'alice.test@example.com');
    assert.equal(res.body.data.user.role, 'ATTENDEE');
    assert.ok(res.body.data.accessToken);
    assert.ok(res.body.data.refreshToken);
  });

  test('POST /api/auth/register - Rejects duplicate email registration (409 Conflict)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'alice.test@example.com',
        password: 'Password123',
        name: 'Alice Duplicate',
        role: 'ATTENDEE',
      });

    assert.equal(res.status, 409);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'EMAIL_ALREADY_EXISTS');
  });

  test('POST /api/auth/register - Rejects invalid weak password (400 Bad Request)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'weakpass@example.com',
        password: 'pass',
        name: 'Weak Pass User',
        role: 'ATTENDEE',
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  test('POST /api/auth/login - Successfully authenticates user and returns tokens', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'alice.test@example.com',
        password: 'Password123',
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.accessToken);
    assert.ok(res.body.data.refreshToken);
  });

  test('POST /api/auth/login - Rejects invalid credentials (401 Unauthorized)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'alice.test@example.com',
        password: 'WrongPassword999',
      });

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
  });

  test('POST /api/auth/refresh - Refresh token rotation issues new tokens', async () => {
    // 1. Login
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'alice.test@example.com',
        password: 'Password123',
      });

    const initialRefreshToken = loginRes.body.data.refreshToken;

    // 2. Rotate
    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: initialRefreshToken });

    assert.equal(refreshRes.status, 200);
    assert.ok(refreshRes.body.data.accessToken);
    assert.ok(refreshRes.body.data.refreshToken);
    assert.notEqual(refreshRes.body.data.refreshToken, initialRefreshToken);

    // 3. Security Check: Reusing the old refresh token must trigger reuse detection and revoke session!
    const reuseRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: initialRefreshToken });

    assert.equal(reuseRes.status, 401);
    assert.equal(reuseRes.body.error.code, 'TOKEN_REUSE_DETECTED');
  });

  test('GET /api/auth/me - Protected route access', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'alice.test@example.com',
        password: 'Password123',
      });

    const token = loginRes.body.data.accessToken;

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.email, 'alice.test@example.com');
  });

  test('GET /api/auth/me - Rejects unauthenticated request (401)', async () => {
    const res = await request(app).get('/api/auth/me');
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });
});
