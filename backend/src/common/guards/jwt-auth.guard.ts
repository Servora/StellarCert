import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Optional,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PUBLIC_KEY } from '../decorators/public.decorator';
import { ModuleRef, Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AuthException } from '../exceptions';
import { ErrorCode } from '../constants/error-codes';
import { Request } from 'express';
import { JwtManagementService } from '../../modules/auth/services/jwt.service';
import { User, UserStatus } from '../../modules/users/entities/user.entity';

/**
 * Canonical shape attached to `req.user` by JwtAuthGuard.
 * `id` and `sub` are aliases for the same user id so both
 * `@CurrentUser('id')` and `@CurrentUser('sub')` resolve correctly,
 * regardless of which guard authenticated the request.
 */
export interface AuthenticatedUser {
  id: string;
  sub: string;
  email: string;
  role: string;
  /** `ver` claim of the access token; see {@link User.tokenVersion}. */
  tokenVersion?: number;
}

interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
  ver?: number;
}

interface CachedUserState {
  active: boolean;
  tokenVersion: number;
  expiresAt: number;
}

/**
 * How long a user's state lookup is reused, in ms. This bounds how long a
 * suspended account, or a token revoked by "sign out everywhere", keeps working.
 */
const USER_STATUS_CACHE_MS = 30_000;
const USER_STATUS_CACHE_MAX = 10_000;

/**
 * JWT Authentication Guard
 * Validates JWT tokens from the Authorization header, rejects tokens that were
 * blacklisted on logout, rejects users that are missing, deactivated or
 * suspended (#1118), and rejects tokens minted before the user's last
 * "sign out everywhere" (#1184).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly userStateCache = new Map<string, CachedUserState>();

  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
    private configService: ConfigService,
    @Optional() private moduleRef?: ModuleRef,
    @Optional() private dataSource?: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if the route is public
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new AuthException(
        ErrorCode.UNAUTHORIZED,
        'Missing authentication token',
      );
    }

    let payload: AccessTokenPayload;
    try {
      const secret = this.configService.get<string>('JWT_ACCESS_SECRET');

      if (!secret) {
        throw new AuthException(
          ErrorCode.UNAUTHORIZED,
          'JWT configuration is missing',
        );
      }

      payload = this.jwtService.verify(token, {
        secret,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'TokenExpiredError') {
        throw new AuthException(ErrorCode.TOKEN_EXPIRED, 'Token has expired');
      }
      throw new AuthException(ErrorCode.TOKEN_INVALID, 'Invalid token');
    }

    if (await this.isBlacklisted(token)) {
      throw new AuthException(
        ErrorCode.TOKEN_INVALID,
        'Token has been revoked',
      );
    }

    const state = await this.loadUserState(payload.sub);
    if (state && !state.active) {
      throw new AuthException(ErrorCode.UNAUTHORIZED, 'User is not active');
    }

    const tokenVersion = payload.ver ?? 0;
    if (state && tokenVersion < state.tokenVersion) {
      throw new AuthException(
        ErrorCode.TOKEN_INVALID,
        'Token has been revoked',
      );
    }

    // Single canonical req.user shape: id and sub are aliases of the same
    // user id, so @CurrentUser('id') and @CurrentUser('sub') both resolve.
    request.user = {
      id: payload.sub,
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      tokenVersion,
    };

    return true;
  }

  /** Whether the token was blacklisted by `AuthService.logout`. */
  private async isBlacklisted(token: string): Promise<boolean> {
    let jwtManagementService: JwtManagementService | undefined;
    try {
      jwtManagementService = this.moduleRef?.get(JwtManagementService, {
        strict: false,
      });
    } catch {
      // AuthModule is not loaded (e.g. isolated tests); nothing to check.
      return false;
    }
    return jwtManagementService
      ? jwtManagementService.isTokenBlacklisted(token)
      : false;
  }

  /**
   * Reload the user so deleted or suspended accounts, and revoked token
   * versions, lose access promptly. Returns undefined when no database is
   * available (isolated tests), in which case only the signature is checked.
   */
  private async loadUserState(
    userId: string,
  ): Promise<CachedUserState | undefined> {
    if (!this.dataSource) {
      return undefined;
    }

    const now = Date.now();
    const cached = this.userStateCache.get(userId);
    if (cached && cached.expiresAt > now) {
      return cached;
    }

    const user = await this.dataSource.getRepository(User).findOne({
      where: { id: userId },
      select: { id: true, isActive: true, status: true, tokenVersion: true },
    });
    const state: CachedUserState = {
      active:
        !!user &&
        user.isActive !== false &&
        user.status !== UserStatus.SUSPENDED,
      tokenVersion: user?.tokenVersion ?? 0,
      expiresAt: now + USER_STATUS_CACHE_MS,
    };

    if (this.userStateCache.size >= USER_STATUS_CACHE_MAX) {
      this.userStateCache.clear();
    }
    this.userStateCache.set(userId, state);
    return state;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return undefined;
    }

    const [scheme, token] = authHeader.split(' ');
    return scheme === 'Bearer' ? token : undefined;
  }
}
