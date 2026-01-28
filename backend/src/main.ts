import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from './common/pipes/validation.pipe';
import { GlobalExceptionFilter } from './common/exceptions/global-exception.filter';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SentryService } from './common/monitoring/sentry.service';
import { LoggingService } from './common/logging/logging.service';
import { MonitoringInterceptor } from './common/monitoring/monitoring.interceptor';
import { MetricsService } from './common/monitoring/metrics.service';
import * as Sentry from '@sentry/node';
import * as cors from 'cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Initialize Sentry before anything else
  const sentryService = app.get(SentryService);
  const loggingService = app.get(LoggingService);
  const metricsService = app.get(MetricsService);

  // Enable CORS
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
    credentials: true,
  });
  
  // Set global prefix
  app.setGlobalPrefix('api');
  
  // Use global pipes and filters
  app.useGlobalPipes(new ValidationPipe());
  app.useGlobalFilters(new GlobalExceptionFilter(sentryService, loggingService));

  // Initialize Sentry request handler
  if (sentryService.isInitialized()) {
    // app.use(Sentry.Handlers.requestHandler());
    // app.use(Sentry.Handlers.tracingHandler());
  }

  // Add global monitoring interceptor
  app.useGlobalInterceptors(
    new MonitoringInterceptor(metricsService, sentryService, loggingService),
  );
  
  // Swagger setup
  const config = new DocumentBuilder()
    .setTitle('StellarWave API')
    .setDescription('Certificate Management System API Documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // Initialize Sentry error handler
  if (sentryService.isInitialized()) {
    // app.use(Sentry.Handlers.errorHandler());
  }
  
  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  loggingService.log(`Application started on port ${port}`);
}
bootstrap();
bootstrap();
