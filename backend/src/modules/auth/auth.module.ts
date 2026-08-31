import {
  Module,
  forwardRef,
  MiddlewareConsumer,
  NestModule,
} from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtManagementService } from './services/jwt.service';
import { TwoFactorService } from './services/two-factor.service';
import { UsersModule } from '../users/users.module';
import { User } from '../users/entities/user.entity';
import { CacheModule } from '@nestjs/cache-manager';
import { AuthRateLimitMiddleware } from './middleware/auth-rate-limit.middleware';

@Module({
  imports: [
    CacheModule.register(),
    ConfigModule,
    TypeOrmModule.forFeature([User]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_ACCESS_SECRET');
        const expiresIn = (configService.get<string>('JWT_ACCESS_EXPIRES_IN') ||
          '15m') as any;

        if (!secret) {
          throw new Error('JWT_ACCESS_SECRET must be configured');
        }

        return {
          secret,
          signOptions: {
            expiresIn,
          },
        };
      },
    }),
    forwardRef(() => UsersModule),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtManagementService,
    TwoFactorService,
    AuthRateLimitMiddleware,
  ],
  exports: [AuthService, JwtModule, JwtManagementService, TwoFactorService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthRateLimitMiddleware)
      .forRoutes(
        { path: 'auth/login', method: RequestMethod.POST },
        { path: 'auth/register', method: RequestMethod.POST },
      );
  }
}
