import { Injectable, CanActivate, ExecutionContext, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PUBLIC_KEY } from '../decorators/public.decorator';
import { Reflector } from '@nestjs/core';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthException } from '../exceptions';
import { ErrorCode } from '../constants/error-codes';
import { Request } from 'express';
import { User, UserStatus } from '../../modules/users/entities/user.entity';

export interface AuthenticatedUser {
  id: string;
  sub: string;
  email: string;
  role: string;
}

interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
    private configService: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @InjectRepository(User) private userRepository: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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

    try {
      const secret = this.configService.get<string>('JWT_ACCESS_SECRET');

      if (!secret) {
        throw new AuthException(
          ErrorCode.UNAUTHORIZED,
          'JWT configuration is missing',
        );
      }

      const payload = this.jwtService.verify(token, { secret });

      const isBlacklisted = await this.cacheManager.get(
        `blacklisted_token:${token}`,
      );
      if (isBlacklisted) {
        throw new AuthException(ErrorCode.TOKEN_INVALID, 'Token has been revoked');
      }

      const user = await this.userRepository.findOne({
        where: { id: payload.sub },
      });
      if (!user || !user.isActive || user.status === UserStatus.SUSPENDED) {
        throw new AuthException(
          ErrorCode.UNAUTHORIZED,
          'User not found or inactive',
        );
      }

      request.user = {
        id: user.id,
        sub: user.id,
        email: user.email,
        role: user.role,
      };
    } catch (error: unknown) {
      if (error instanceof AuthException) {
        throw error;
      }
      if (error instanceof Error && error.name === 'TokenExpiredError') {
        throw new AuthException(ErrorCode.TOKEN_EXPIRED, 'Token has expired');
      }
      throw new AuthException(ErrorCode.TOKEN_INVALID, 'Invalid token');
    }

    return true;
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
