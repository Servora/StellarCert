import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditLog } from './entities';
import { AuditService, RequestContextService } from './services';
import { AuditController } from './controllers';
import { AuditContextMiddleware } from './middleware';
import { AuditCleanupJob } from './jobs';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog]),
    ScheduleModule.forRoot(),
  ],
  controllers: [AuditController],
  providers: [
    AuditService,
    RequestContextService,
    AuditCleanupJob,
  ],
  exports: [AuditService, RequestContextService],
})
export class AuditModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuditContextMiddleware).forRoutes('*');
  }
}
