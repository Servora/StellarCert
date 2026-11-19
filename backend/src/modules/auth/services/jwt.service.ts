import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { JwtService as NestJwtService } from '@nestjs/jwt';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  [key: string]: any;
}

@Injectable()
export class JwtManagementService {
  constructor(
    private nestJwtService: NestJwtService,
    private configService: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  /**
   * Generate access token
   */
  async generateAccessToken(payload: JwtPayload): Promise<string> {
    const expiresIn = (this.configService.get<string>(
      'JWT_ACCESS_EXPIRES_IN',
    ) || '15m') as any;
    const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
    return this.nestJwtService.signAsync(payload as any, { expiresIn, secret });
  }

  /**
   * Generate refresh token
   */
  async generateRefreshToken(payload: JwtPayload): Promise<string> {
    const expiresIn = (this.configService.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
    ) || '7d') as any;
    const secret = this.configService.get<string>('JWT_REFRESH_SECRET');
    return this.nestJwtService.signAsync(payload as any, { expiresIn, secret });
  }

  /**
   * Verify access token
   */
  async verifyAccessToken(token: string): Promise<JwtPayload> {
    try {
      // Check if token is blacklisted
      const isBlacklisted = await this.isTokenBlacklisted(token);
      if (isBlacklisted) {
        throw new Error('Token has been revoked');
      }

      return await this.nestJwtService.verifyAsync(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      });
    } catch (error) {
      throw new Error(`Invalid access token: ${error.message}`);
    }
  }

  /**
   * Verify refresh token
   */
  async verifyRefreshToken(token: string): Promise<JwtPayload> {
    try {
      // Check if token is blacklisted
      const isBlacklisted = await this.isTokenBlacklisted(token);
      if (isBlacklisted) {
        throw new Error('Token has been revoked');
      }

      return await this.nestJwtService.verifyAsync(token, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch (error) {
      throw new Error(`Invalid refresh token: ${error.message}`);
    }
  }

  /**
   * Blacklist a token
   */
  async blacklistToken(token: string, expiresIn?: number): Promise<void> {
    // Get token expiration time to set appropriate cache expiration
    let tokenExp: number;
    try {
      const decoded = this.nestJwtService.decode(token);
      tokenExp = decoded.exp || 3600; // Default to 1 hour if no exp found
    } catch (error) {
      // If we can't decode the token, use a default expiration
      tokenExp = 3600;
    }

    // Calculate remaining time until token naturally expires
    const currentTime = Math.floor(Date.now() / 1000);
    const remainingTime = Math.max(1, tokenExp - currentTime);

    // Use the provided expiration or the remaining time until natural expiration
    const cacheExpiry = expiresIn || remainingTime;

    // Store the token in cache to mark it as blacklisted
    await this.cacheManager.set(
      `blacklisted_token:${token}`,
      true,
      cacheExpiry * 1000,
    );
  }

  /**
   * Check if a token is blacklisted
   */
  async isTokenBlacklisted(token: string): Promise<boolean> {
    const blacklisted = await this.cacheManager.get(
      `blacklisted_token:${token}`,
    );
    return !!blacklisted;
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // Verify the refresh token
    const verified = await this.verifyRefreshToken(refreshToken);

    // Re-sign only the identity claims. The verified payload still carries the
    // registered claims from the old token (iat/exp, and nbf/jti when set), and
    // jsonwebtoken refuses to sign a payload that already has `exp` while an
    // `expiresIn` option is given - "Bad options.expiresIn option the payload
    // already has an exp property". That threw on every refresh, so the catch
    // in AuthService.refreshTokens turned all of them into 401s and silent
    // refresh never worked: sessions ended as soon as the access token aged out.
    const {
      iat: _iat,
      exp: _exp,
      nbf: _nbf,
      jti: _jti,
      ...payload
    } = verified as JwtPayload & {
      iat?: number;
      exp?: number;
      nbf?: number;
      jti?: string;
    };

    // Generate new access token
    const newAccessToken = await this.generateAccessToken(payload);

    // Generate new refresh token (rotation)
    const newRefreshToken = await this.generateRefreshToken(payload);

    // Blacklist the old refresh token
    await this.blacklistToken(refreshToken);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  /**
   * Extract payload from token without verification (for introspection)
   */
  extractPayload(token: string): JwtPayload | null {
    try {
      return this.nestJwtService.decode(token);
    } catch (error) {
      return null;
    }
  }

  /**
   * Record a failed 2FA verification attempt for a pre-auth token.
   * If attempts reach or exceed maxAttempts, the token is invalidated (blacklisted).
   */
  async recordFailed2faAttempt(
    token: string,
    maxAttempts = 3,
  ): Promise<{ attempts: number; invalidated: boolean }> {
    const key = `2fa_attempts:${token}`;
    const current = (await this.cacheManager.get<number>(key)) || 0;
    const attempts = current + 1;
    // Window of 5 minutes (matching pre-auth token expiration)
    await this.cacheManager.set(key, attempts, 5 * 60 * 1000);

    if (attempts >= maxAttempts) {
      await this.blacklistToken(token, 5 * 60);
      return { attempts, invalidated: true };
    }

    return { attempts, invalidated: false };
  }

  /**
   * Clear failed 2FA verification attempts for a pre-auth token.
   */
  async clear2faAttempts(token: string): Promise<void> {
    const key = `2fa_attempts:${token}`;
    await this.cacheManager.del(key);
  }
}
