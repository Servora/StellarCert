import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PUBLIC_KEY } from '../decorators/public.decorator';
import { Reflector } from '@nestjs/core';
import { AuthException } from '../exceptions';
import { ErrorCode } from '../constants/error-codes';

/**
 * JWT Authentication Guard
 * Validates JWT tokens from the Authorization header
 */
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
    private configService: ConfigService,
  ) { }

  canActivate(context: ExecutionContext): boolean {
    // Check if the route is public
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new AuthException(
        ErrorCode.UNAUTHORIZED,
        'Missing authentication token',
      );
    }

    try {
      const secret = this.configService.get<string>('JWT_SECRET') || 'default_secret_key_for_dev';
      // console.log('Verifying token with secret:', secret.substring(0, 4) + '...');
      const payload = this.jwtService.verify(token, {
        secret: secret,
      });
      request.user = payload;
    } catch (error) {
      // console.error('JWT Verification Error:', error.message);
      if (error.name === 'TokenExpiredError') {
        throw new AuthException(ErrorCode.TOKEN_EXPIRED, 'Token has expired');
      }
      throw new AuthException(ErrorCode.TOKEN_INVALID, 'Invalid token');
    }

    return true;
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return undefined;
    }

    const [scheme, token] = authHeader.split(' ');
    return scheme === 'Bearer' ? token : undefined;
  }
}
