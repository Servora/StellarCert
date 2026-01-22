/**
 * Audit Logging Integration Examples
 *
 * This file demonstrates how to use the comprehensive audit logging system
 * in the StellarCert application.
 */

// ============================================
// 1. AUTOMATIC CONTEXT CAPTURE
// ============================================
// The audit middleware automatically captures:
// - User ID and email (from JWT)
// - IP address (with x-forwarded-for support)
// - User agent
// - Unique correlation ID
// - Request timestamp

// All of this is automatically available in your services via the REQUEST object:
// @Inject(REQUEST) private request: any

// Access the audit context:
// const context = this.request.auditContext;
// console.log(context.userId);           // Current user ID
// console.log(context.userEmail);        // Current user email
// console.log(context.ipAddress);        // Client IP address
// console.log(context.userAgent);        // Browser/client info
// console.log(context.correlationId);    // Request correlation ID

// ============================================
// 2. LOGGING EVENTS
// ============================================
// Example: Log a user action
// await this.auditService.log({
//   action: AuditAction.USER_LOGIN,
//   resourceType: AuditResourceType.USER,
//   userId: user.id,
//   userEmail: user.email,
//   ipAddress: context.ipAddress,
//   userAgent: context.userAgent,
//   correlationId: context.correlationId,
//   status: 'success',
//   timestamp: Date.now(),
// });

// ============================================
// 3. SEARCHING AND FILTERING
// ============================================
// Example: Search audit logs with multiple filters
// const result = await this.auditService.search({
//   action: AuditAction.CERTIFICATE_ISSUE,
//   resourceType: AuditResourceType.CERTIFICATE,
//   userId: 'user-123',
//   startDate: '2024-01-01',
//   endDate: '2024-01-31',
//   skip: 0,
//   take: 50,
// });

// Access the audit logs endpoint:
// GET /audit/logs?action=USER_LOGIN&userId=user-123&skip=0&take=50

// ============================================
// 4. VIEWING STATISTICS
// ============================================
// Example: Get audit statistics
// const stats = await this.auditService.getStatistics({
//   startDate: '2024-01-01',
//   endDate: '2024-01-31',
// });
// 
// Returns:
// {
//   totalEvents: 1000,
//   eventsByAction: { USER_LOGIN: 500, CERTIFICATE_ISSUE: 200, ... },
//   eventsByResourceType: { USER: 500, CERTIFICATE: 300, ... },
//   eventsByStatus: { success: 900, failure: 100 },
//   eventsPerDay: { '2024-01-20': 50, '2024-01-21': 60, ... },
//   topUsers: [
//     { userId: 'user-123', userEmail: 'admin@example.com', eventCount: 150 },
//   ],
//   topResources: [
//     { resourceId: 'cert-456', resourceType: 'CERTIFICATE', eventCount: 25 },
//   ],
// }

// Access the statistics endpoint:
// GET /audit/statistics?startDate=2024-01-01&endDate=2024-01-31

// ============================================
// 5. EXPORTING LOGS
// ============================================
// Example: Export filtered logs as CSV
// const csv = await this.auditService.exportToCsv({
//   action: AuditAction.CERTIFICATE_ISSUE,
//   userId: 'user-123',
// });

// Access the export endpoint:
// GET /audit/export?action=CERTIFICATE_ISSUE&userId=user-123

// ============================================
// 6. TRACKING RESOURCE CHANGES
// ============================================
// Example: Capture before/after changes
// await this.auditService.log({
//   action: AuditAction.CERTIFICATE_UPDATE,
//   resourceType: AuditResourceType.CERTIFICATE,
//   resourceId: certificate.id,
//   changes: {
//     before: {
//       title: 'Old Title',
//       description: 'Old Description',
//     },
//     after: {
//       title: 'New Title',
//       description: 'New Description',
//     },
//   },
//   userId: context.userId,
//   ipAddress: context.ipAddress,
//   status: 'success',
//   timestamp: Date.now(),
// });

// ============================================
// 7. ERROR TRACKING
// ============================================
// Example: Log failed operations
// try {
//   await this.certificateService.revoke(id);
// } catch (error) {
//   await this.auditService.log({
//     action: AuditAction.CERTIFICATE_REVOKE,
//     resourceType: AuditResourceType.CERTIFICATE,
//     resourceId: id,
//     userId: context.userId,
//     ipAddress: context.ipAddress,
//     status: 'error',
//     errorMessage: error.message,
//     timestamp: Date.now(),
//   });
// }

// ============================================
// 8. SENSITIVE DATA REDACTION
// ============================================
// IMPORTANT: Always redact sensitive data before logging!

// DO NOT log passwords, tokens, or secrets:
// ❌ WRONG:
// resourceData: { password: user.password }

// ✅ CORRECT:
// resourceData: { password: '[REDACTED]' }

// Example of secure logging:
// const safeUserData = { ...user };
// if (safeUserData.password) {
//   safeUserData.password = '[REDACTED]';
// }
// if (safeUserData.apiKey) {
//   safeUserData.apiKey = '[REDACTED]';
// }
// await this.auditService.log({
//   resourceData: safeUserData,
//   // ... other fields
// });

// ============================================
// 9. CORRELATION IDS FOR TRACING
// ============================================
// Use correlation IDs to track requests across multiple services
// The audit middleware automatically generates and manages correlation IDs

// Example: Find all related operations
// const relatedLogs = await this.auditService.search({
//   correlationId: 'abc-123-def-456',
// });

// You can also pass custom correlation IDs in request headers:
// curl -H "x-correlation-id: my-custom-id" http://api.example.com/certificates

// ============================================
// 10. STELLAR TRANSACTION TRACKING
// ============================================
// Link blockchain transactions to audit logs

// Example: Log certificate with Stellar transaction hash
// await this.auditService.log({
//   action: AuditAction.CERTIFICATE_ISSUE,
//   resourceType: AuditResourceType.CERTIFICATE,
//   resourceId: certificate.id,
//   transactionHash: stellarTxHash,
//   metadata: {
//     recipient: certificate.recipientEmail,
//     issuer: certificate.issuerName,
//     blockchainVerified: true,
//   },
//   status: 'success',
//   timestamp: Date.now(),
// });

// ============================================
// 11. CLEANUP AND RETENTION
// ============================================
// The audit system automatically cleans up old logs based on
// the configured retention period (default: 90 days)

// Configure in environment:
// AUDIT_RETENTION_DAYS=90

// The cleanup job runs daily at midnight
// You can manually trigger cleanup:
// const deletedCount = await this.auditService.cleanupOldLogs(90);
// console.log(`Cleaned up ${deletedCount} audit logs`);

// ============================================
// 12. PERFORMANCE CONSIDERATIONS
// ============================================
// - Audit logging is async and non-blocking
// - Failures in audit logging do not affect main operations
// - Use database indexes for common search patterns
// - Limit export size (max 50,000 records per request)
// - Cache statistics queries for frequently accessed data

// Example: Non-blocking audit logging
// // This doesn't block the response
// await this.auditService.log({...}).catch(() => {
//   // Silently fail - don't break main operation
// });

// ============================================
// 13. INTEGRATION PATTERNS
// ============================================

// Pattern 1: Service method with audit
// async updateUser(id: string, data: UpdateUserDto): Promise<User> {
//   const before = await this.findOne(id);
//   const updated = await this.usersRepository.update(id, data);
//   const after = await this.findOne(id);
//
//   const context = this.request.auditContext;
//   await this.auditService.log({
//     action: AuditAction.USER_PROFILE_UPDATE,
//     resourceType: AuditResourceType.USER,
//     resourceId: id,
//     changes: { before, after },
//     userId: context.userId,
//     ipAddress: context.ipAddress,
//     status: 'success',
//     timestamp: Date.now(),
//   }).catch(() => {});
//
//   return after;
// }

// Pattern 2: Controller with @UseGuards
// @Controller('certificates')
// @UseGuards(JwtAuthGuard)
// export class CertificatesController {
//   constructor(private certificatesService: CertificatesService) {}
//
//   @Post()
//   async create(@Body() dto: CreateCertificateDto) {
//     return this.certificatesService.create(dto);
//     // Audit logging happens automatically in the service
//   }
// }

// Pattern 3: Error handling with audit
// async deleteCertificate(id: string): Promise<void> {
//   try {
//     await this.certificatesRepository.delete(id);
//   } catch (error) {
//     const context = this.request.auditContext;
//     await this.auditService.log({
//       action: AuditAction.CERTIFICATE_UPDATE,
//       resourceType: AuditResourceType.CERTIFICATE,
//       resourceId: id,
//       userId: context.userId,
//       ipAddress: context.ipAddress,
//       status: 'error',
//       errorMessage: error.message,
//       timestamp: Date.now(),
//     }).catch(() => {});
//     throw error;
//   }
// }

// ============================================
// 14. ADMIN ENDPOINTS
// ============================================
// Access audit logs via REST API (requires authentication)

// Search logs:
// GET /audit/logs?action=USER_LOGIN&userId=user-123&skip=0&take=50

// Get statistics:
// GET /audit/statistics?startDate=2024-01-01&endDate=2024-01-31

// Export as CSV:
// GET /audit/export?action=CERTIFICATE_ISSUE&userId=user-123

// Get resource audit trail:
// GET /audit/resource/cert-123

// ============================================
// 15. MONITORING AND ALERTS (FUTURE)
// ============================================
// The audit system is designed to support:
// - Real-time alerting on suspicious activities
// - SIEM integration
// - Custom webhooks for critical events
// - Email notifications for admin actions

// Example configuration (future):
// await this.auditService.onEvent(
//   AuditAction.LOGIN_FAILED,
//   async (event) => {
//     // Alert on multiple failed logins
//     const count = await this.auditService.countByAction(
//       AuditAction.LOGIN_FAILED,
//     );
//     if (count > 5) {
//       await this.notificationService.alertSecurityTeam(event);
//     }
//   },
// );
