import {
  Module,
  MiddlewareConsumer,
  NestModule,
  forwardRef,
} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditLog } from './entities';
import { AuditService, RequestContextService } from './services';
import { AuditController } from './controllers';
import { AuditContextMiddleware } from './middleware';
import { AuditCleanupJob } from './jobs';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog]),
    ScheduleModule.forRoot(),
    forwardRef(() => AuthModule),
  ],
  controllers: [AuditController],
  providers: [AuditService, RequestContextService, AuditCleanupJob],
  exports: [AuditService, RequestContextService],
})
export class AuditModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuditContextMiddleware).forRoutes('*');
  }
}
