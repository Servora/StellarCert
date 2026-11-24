import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { AuthSession } from '../entities/auth-session.entity';

export interface SessionView {
  id: string;
  device: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  current: boolean;
}

export interface SessionMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Refresh tokens are signed JWTs with high entropy, so a fast deterministic
 * digest is sufficient to store them and lets a session be found with one
 * indexed equality lookup (a salted bcrypt hash cannot be looked up at all).
 */
export function hashRefreshToken(rawRefreshToken: string): string {
  return createHash('sha256').update(rawRefreshToken).digest('hex');
}

/** Short, human-readable device label derived from the User-Agent header. */
function describeDevice(userAgent?: string | null): string | null {
  if (!userAgent) return null;
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : null;
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad/.test(userAgent)
        ? 'iOS'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  return [browser, os].filter(Boolean).join(' on ') || null;
}

@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(AuthSession)
    private readonly sessions: Repository<AuthSession>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  /** Record a new session for a freshly issued refresh token. */
  async createSession(
    userId: string,
    rawRefreshToken: string,
    meta: SessionMeta = {},
  ): Promise<AuthSession> {
    const session = this.sessions.create({
      userId,
      refreshTokenHash: hashRefreshToken(rawRefreshToken),
      device: describeDevice(meta.userAgent),
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      lastUsedAt: new Date(),
    });
    return this.sessions.save(session);
  }

  /** The session a refresh token belongs to, revoked or not. */
  async findByRefreshToken(
    rawRefreshToken: string,
  ): Promise<AuthSession | null> {
    return this.sessions.findOne({
      where: { refreshTokenHash: hashRefreshToken(rawRefreshToken) },
    });
  }

  /**
   * Move a session onto the rotated refresh token.
   * Tokens issued before sessions existed have no row, so one is created
   * for them on first use.
   */
  async rotate(
    userId: string,
    oldRefreshToken: string,
    newRefreshToken: string,
    meta: SessionMeta = {},
  ): Promise<void> {
    const session = await this.findByRefreshToken(oldRefreshToken);

    if (!session) {
      await this.createSession(userId, newRefreshToken, meta);
      return;
    }

    session.refreshTokenHash = hashRefreshToken(newRefreshToken);
    session.lastUsedAt = new Date();

    if (meta.ipAddress) {
      session.ipAddress = meta.ipAddress;
    }

    await this.sessions.save(session);
  }

  /** Revoke the session associated with a refresh token (logout). */
  async revokeByRefreshToken(rawRefreshToken: string): Promise<void> {
    await this.sessions.update(
      {
        refreshTokenHash: hashRefreshToken(rawRefreshToken),
        revokedAt: IsNull(),
      },
      {
        revokedAt: new Date(),
      },
    );
  }

  /**
   * Return all active sessions belonging to a user,
   * optionally identifying the current session.
   */
  async listForUser(
    userId: string,
    currentRefreshToken?: string,
  ): Promise<SessionView[]> {
    const currentHash = currentRefreshToken
      ? hashRefreshToken(currentRefreshToken)
      : null;

    const sessions = await this.sessions.find({
      where: {
        userId,
        revokedAt: IsNull(),
      },
      order: {
        lastUsedAt: 'DESC',
      },
    });

    return sessions.map((session) => ({
      id: session.id,
      device: session.device,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      current: currentHash !== null && session.refreshTokenHash === currentHash,
    }));
  }

  /** Revoke a specific session belonging to a user. */
  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.sessions.findOne({
      where: {
        id: sessionId,
        userId,
      },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.revokedAt) {
      return;
    }

    session.revokedAt = new Date();
    await this.sessions.save(session);
  }

  /**
   * Revoke every active session and increment tokenVersion,
   * invalidating outstanding access and refresh tokens.
   */
  async revokeAll(userId: string): Promise<number> {
    const result = await this.sessions.update(
      {
        userId,
        revokedAt: IsNull(),
      },
      {
        revokedAt: new Date(),
      },
    );

    await this.users.increment({ id: userId }, 'tokenVersion', 1);

    await this.users.update(userId, {
      refreshToken: null,
    });

    return result.affected ?? 0;
  }
}
