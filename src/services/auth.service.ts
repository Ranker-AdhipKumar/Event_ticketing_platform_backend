import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../db/index.js';
import { config } from '../config/index.js';
import { AppError } from '../errors/AppError.js';
import type { User, AuthTokenPayload, RefreshToken } from '../types/index.js';
import type { RegisterInput, LoginInput } from '../schemas/auth.schema.js';

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export class AuthService {
  static async register(input: RegisterInput): Promise<{
    user: Omit<User, 'password_hash'>;
    accessToken: string;
    refreshToken: string;
  }> {
    const existingUser = await db.queryOne<User>('SELECT id FROM users WHERE email = ?', [
      input.email.toLowerCase(),
    ]);

    if (existingUser) {
      throw AppError.conflict('An account with this email address already exists', 'EMAIL_ALREADY_EXISTS');
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(input.password, saltRounds);
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, input.email.toLowerCase(), passwordHash, input.name, input.role, now, now]
    );

    const user: Omit<User, 'password_hash'> = {
      id: userId,
      email: input.email.toLowerCase(),
      name: input.name,
      role: input.role,
      created_at: now,
      updated_at: now,
    };

    const tokens = await this.generateTokenPair(user);

    return {
      user,
      ...tokens,
    };
  }

  static async login(input: LoginInput): Promise<{
    user: Omit<User, 'password_hash'>;
    accessToken: string;
    refreshToken: string;
  }> {
    const user = await db.queryOne<User>('SELECT * FROM users WHERE email = ?', [
      input.email.toLowerCase(),
    ]);

    if (!user) {
      throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    const isMatch = await bcrypt.compare(input.password, user.password_hash);
    if (!isMatch) {
      throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    const userProfile: Omit<User, 'password_hash'> = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };

    const tokens = await this.generateTokenPair(userProfile);

    return {
      user: userProfile,
      ...tokens,
    };
  }

  static async refreshTokens(rawRefreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    user: Omit<User, 'password_hash'>;
  }> {
    const hashed = hashToken(rawRefreshToken);
    const tokenRecord = await db.queryOne<RefreshToken>(
      'SELECT * FROM refresh_tokens WHERE token_hash = ?',
      [hashed]
    );

    if (!tokenRecord) {
      throw AppError.unauthorized('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
    }

    // Refresh Token Reuse Detection
    if (tokenRecord.is_revoked === 1) {
      // Automatic family revocation: Someone reused a revoked token!
      await db.execute('UPDATE refresh_tokens SET is_revoked = 1 WHERE family = ?', [
        tokenRecord.family,
      ]);
      throw AppError.unauthorized(
        'Security Alert: Refresh token reuse detected. All sessions in this token family have been revoked.',
        'TOKEN_REUSE_DETECTED'
      );
    }

    if (new Date(tokenRecord.expires_at).getTime() <= Date.now()) {
      throw AppError.unauthorized('Refresh token has expired', 'REFRESH_TOKEN_EXPIRED');
    }

    const user = await db.queryOne<User>('SELECT * FROM users WHERE id = ?', [tokenRecord.user_id]);
    if (!user) {
      throw AppError.unauthorized('Associated user no longer exists', 'USER_NOT_FOUND');
    }

    // Revoke the old token that was just presented
    await db.execute('UPDATE refresh_tokens SET is_revoked = 1 WHERE id = ?', [tokenRecord.id]);

    const userProfile: Omit<User, 'password_hash'> = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };

    // Issue new pair in the same token family
    const tokens = await this.generateTokenPair(userProfile, tokenRecord.family);

    return {
      user: userProfile,
      ...tokens,
    };
  }

  static async logout(rawRefreshToken: string): Promise<void> {
    const hashed = hashToken(rawRefreshToken);
    const tokenRecord = await db.queryOne<RefreshToken>(
      'SELECT * FROM refresh_tokens WHERE token_hash = ?',
      [hashed]
    );

    if (tokenRecord) {
      // Revoke the whole family associated with this session
      await db.execute('UPDATE refresh_tokens SET is_revoked = 1 WHERE family = ?', [
        tokenRecord.family,
      ]);
    }
  }

  static async getProfile(userId: string): Promise<Omit<User, 'password_hash'>> {
    const user = await db.queryOne<User>('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      throw AppError.notFound('User not found', 'USER_NOT_FOUND');
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };
  }

  private static async generateTokenPair(
    user: Omit<User, 'password_hash'>,
    existingFamily?: string
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload: AuthTokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    };

    const accessToken = jwt.sign(payload, config.jwt.accessSecret, {
      expiresIn: config.jwt.accessExpiresIn as any,
    });

    const rawRefreshToken = crypto.randomBytes(40).toString('hex');
    const tokenHash = hashToken(rawRefreshToken);
    const family = existingFamily || crypto.randomUUID();
    const tokenId = crypto.randomUUID();

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + config.jwt.refreshExpiresInDays);

    await db.execute(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, family, is_revoked, expires_at, created_at)
       VALUES (?, ?, ?, ?, 0, ?, CURRENT_TIMESTAMP)`,
      [tokenId, user.id, tokenHash, family, expiresAt.toISOString()]
    );

    return {
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }
}
