import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry } from 'prom-client';
import { LoggingService } from '../logging/logging.service';

@Injectable()
export class MetricsService {
  private readonly registry: Registry;

  // HTTP metrics
  private httpRequestDuration: Histogram;
  private httpRequestsTotal: Counter;
  private httpErrorsTotal: Counter;

  // Database metrics
  private dbQueryDuration: Histogram;
  private dbConnectionStatus: Counter;

  // Application metrics
  private certificateIssued: Counter;
  private certificateVerified: Counter;
  private authenticationAttempts: Counter;

  constructor(private readonly logger: LoggingService) {
    this.registry = new Registry();

    // Initialize HTTP metrics
    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency in seconds',
      labelNames: ['method', 'route', 'status'],
      registers: [this.registry],
    });

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status'],
      registers: [this.registry],
    });

    this.httpErrorsTotal = new Counter({
      name: 'http_errors_total',
      help: 'Total number of HTTP errors',
      labelNames: ['method', 'route', 'status'],
      registers: [this.registry],
    });

    // Initialize Database metrics
    this.dbQueryDuration = new Histogram({
      name: 'db_query_duration_seconds',
      help: 'Database query latency in seconds',
      labelNames: ['query_type'],
      registers: [this.registry],
    });

    this.dbConnectionStatus = new Counter({
      name: 'db_connection_status',
      help: 'Database connection status (1 = connected, 0 = disconnected)',
      labelNames: ['status'],
      registers: [this.registry],
    });

    // Initialize Application metrics
    this.certificateIssued = new Counter({
      name: 'certificate_issued_total',
      help: 'Total number of issued certificates',
      labelNames: ['issuer_id'],
      registers: [this.registry],
    });

    this.certificateVerified = new Counter({
      name: 'certificate_verified_total',
      help: 'Total number of verified certificates',
      labelNames: ['issuer_id'],
      registers: [this.registry],
    });

    this.authenticationAttempts = new Counter({
      name: 'authentication_attempts_total',
      help: 'Total authentication attempts',
      labelNames: ['status'],
      registers: [this.registry],
    });

    this.logger.log('Metrics service initialized');
  }

  /**
   * Record HTTP request duration
   */
  recordHttpRequestDuration(
    method: string,
    route: string,
    status: number,
    duration: number,
  ): void {
    this.httpRequestDuration
      .labels(method, route, status.toString())
      .observe(duration);
    this.httpRequestsTotal.labels(method, route, status.toString()).inc();
  }

  /**
   * Record HTTP error
   */
  recordHttpError(method: string, route: string, status: number): void {
    this.httpErrorsTotal.labels(method, route, status.toString()).inc();
  }

  /**
   * Record database query duration
   */
  recordDbQueryDuration(queryType: string, duration: number): void {
    this.dbQueryDuration.labels(queryType).observe(duration);
  }

  /**
   * Record database connection status
   */
  recordDbConnectionStatus(connected: boolean): void {
    this.dbConnectionStatus
      .labels(connected ? 'connected' : 'disconnected')
      .inc();
  }

  /**
   * Record issued certificate
   */
  recordCertificateIssued(issuerId: string): void {
    this.certificateIssued.labels(issuerId).inc();
  }

  /**
   * Record verified certificate
   */
  recordCertificateVerified(issuerId: string): void {
    this.certificateVerified.labels(issuerId).inc();
  }

  /**
   * Record authentication attempt
   */
  recordAuthenticationAttempt(success: boolean): void {
    this.authenticationAttempts.labels(success ? 'success' : 'failure').inc();
  }

  /**
   * Get all metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  /**
   * Get registry for manual updates
   */
  getRegistry(): Registry {
    return this.registry;
  }

  /**
   * Normalize route path to avoid high cardinality
   */
  normalizeRoute(path: string): string {
    // Remove query parameters
    let normalized = path.split('?')[0];

    // Replace numeric IDs with {id} to reduce cardinality
    normalized = normalized.replace(/\/\d+/g, '/{id}');
    normalized = normalized.replace(/\/[0-9a-f-]{36}/g, '/{uuid}');

    return normalized;
  }
}
