"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const validation_pipe_1 = require("./common/pipes/validation.pipe");
const global_exception_filter_1 = require("./common/exceptions/global-exception.filter");
const app_module_1 = require("./app.module");
const swagger_1 = require("@nestjs/swagger");
const sentry_service_1 = require("./common/monitoring/sentry.service");
const logging_service_1 = require("./common/logging/logging.service");
const monitoring_interceptor_1 = require("./common/monitoring/monitoring.interceptor");
const metrics_service_1 = require("./common/monitoring/metrics.service");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    const sentryService = app.get(sentry_service_1.SentryService);
    const loggingService = app.get(logging_service_1.LoggingService);
    const metricsService = app.get(metrics_service_1.MetricsService);
    app.enableCors({
        origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
        credentials: true,
    });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new validation_pipe_1.ValidationPipe());
    app.useGlobalFilters(new global_exception_filter_1.GlobalExceptionFilter(sentryService, loggingService));
    if (sentryService.isInitialized()) {
    }
    app.useGlobalInterceptors(new monitoring_interceptor_1.MonitoringInterceptor(metricsService, sentryService, loggingService));
    const config = new swagger_1.DocumentBuilder()
        .setTitle('StellarWave API')
        .setDescription('Certificate Management System API Documentation')
        .setVersion('1.0')
        .addBearerAuth()
        .build();
    const document = swagger_1.SwaggerModule.createDocument(app, config);
    swagger_1.SwaggerModule.setup('api/docs', app, document);
    if (sentryService.isInitialized()) {
    }
    const port = process.env.PORT ?? 3000;
    await app.listen(port);
    loggingService.log(`Application started on port ${port}`);
}
bootstrap();
bootstrap();
//# sourceMappingURL=main.js.map