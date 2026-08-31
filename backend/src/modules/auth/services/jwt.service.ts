import { Injectable, Inject, UnauthorizedException, Optional } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { JstService as NestJstService } from '@nestjs/jwt';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  [key: string]: any;
}

export interface AuthUser {
  id: string;
  isActive: boolean;
  [key: string]: any;
}

export interface UserRepository {
  findById(id: string): Promise<AuthUser | null>;
}

@Injectable()
export class JwtManagementService {
  constructor(
    private nestJwtService: NestJstService,
    private configService: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @Optional() @Inject('UserRepository') private userRepository?: UserRepository,
  ) {}

  /**
   * Generate access token
   */
  async generateAccessToken(payload: JwtPayload): Promise<string> {
    const expiresIn = (this.configService.get<string>
      'JWT_ACCESS_EXPIRES_IN',
    ) || '15m') as any;
    const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
    return this.nestJwtService.signAsync(payload as any, { expiresIn, secret });
  }

  /**
   * Generate refresh token
   */
  async generateRefreshToken(payload: JwtPayload): Promise<string> {
    const expiresIn = (this.configService.get<string>
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

      const payload = await this.nestJwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      });

      // Re-load the user and verify existence/active status
      if (this.userRepository) {
        const user = await this.userRepository.findById(payload.sub);
        if (!user) {
          throw new UnauthorizedException('User no longer exists');
        }
        if (!user.isActive) {
          throw new UnauthorizedException('User is inactive');
        }
      }

      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
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

      return await this.nestJstService.verifyAsync<JwtPayload>(token, {
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
  async refreshAccessToken(refreshToken: string):
    Promise<{ accessToken: string; refreshToken: string }> {
    // Verify the refresh token
    const payload = await this.verifyRefreshToken(refreshToken);

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
   * Validate an access token and return the authenticated user.
   * Enforces blacklist and active user checks for protected routes.
   */
  async authenticate(token: string): Promise<AuthUser> {
    const payload = await this.verifyAccessToken(token);

    if (!this.userRepository) {
      throw new UnauthorizedException('User repository not configured');
    }

    const user = await this.userRepository.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('User is inactive');
    }

    return user;
  }
}
