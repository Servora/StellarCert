import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from '../../common/common.module';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { CorsMiddleware } from './middleware/cors.middleware';
import { InputSanitizationMiddleware } from './middleware/input-sanitization.middleware';
import { SecurityHeadersInterceptor } from './interceptor';

@Module({
  imports: [ConfigModule, CommonModule],
  providers: [
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: SecurityHeadersInterceptor,
    },
  ],
})
export class SecurityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(CorsMiddleware, InputSanitizationMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
