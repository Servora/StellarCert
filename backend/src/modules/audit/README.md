# Audit Logging System Configuration

## Environment Variables

```bash
# Audit log retention period in days (default: 90)
AUDIT_RETENTION_DAYS=90

# Enable/disable audit logging (default: true)
AUDIT_ENABLED=true

# Database connection settings (inherited from TypeORM config)
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=stellarwave_user
DB_PASSWORD=stellarwave_password
DB_NAME=stellarwave
```

## Installation

### 1. Install Dependencies

The `@nestjs/schedule` package has been added to `package.json`. Install it:

```bash
cd backend
npm install
```

### 2. Database Migration

The audit logs table will be automatically created by TypeORM using the `AuditLog` entity. No manual migration is required.

If you're using migrations, you can generate one:

```bash
npm run typeorm:generate -- migrations/CreateAuditLogsTable
```

### 3. Module Registration

The `AuditModule` is already registered in `AppModule`. It includes:

- **Entities**: `AuditLog` entity with automatic indexing
- **Services**: `AuditService` and `RequestContextService`
- **Controllers**: `AuditController` for REST API access
- **Middleware**: `AuditContextMiddleware` for request context capture
- **Jobs**: `AuditCleanupJob` for scheduled log cleanup
- **Scheduled Tasks**: Daily cleanup at midnight

## Database Schema

### audit_logs Table

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action VARCHAR(50) NOT NULL,
  resourceType VARCHAR(50) NOT NULL,
  resourceId VARCHAR(255),
  userId VARCHAR(255),
  userEmail VARCHAR(255),
  userRole VARCHAR(50),
  ipAddress VARCHAR(45) NOT NULL,
  userAgent TEXT,
  correlationId VARCHAR(255),
  transactionHash VARCHAR(255),
  resourceData JSONB,
  changes JSONB,
  metadata JSONB,
  status VARCHAR(20) DEFAULT 'success',
  errorMessage TEXT,
  timestamp BIGINT NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes for performance
  INDEX idx_userId (userId),
  INDEX idx_action (action),
  INDEX idx_resourceType (resourceType),
  INDEX idx_resourceId (resourceId),
  INDEX idx_createdAt (createdAt),
  INDEX idx_correlationId (correlationId),
  INDEX idx_ipAddress (ipAddress),
  INDEX idx_status (status)
);
```

## API Endpoints

### Search Audit Logs

```
GET /audit/logs
```

**Query Parameters:**
- `action` (optional): `AuditAction` enum value
- `resourceType` (optional): `AuditResourceType` enum value
- `userId` (optional): User ID to filter by
- `userEmail` (optional): User email pattern to search
- `resourceId` (optional): Resource ID to filter by
- `startDate` (optional): ISO date string (YYYY-MM-DD)
- `endDate` (optional): ISO date string (YYYY-MM-DD)
- `correlationId` (optional): Correlation ID
- `ipAddress` (optional): IP address
- `status` (optional): 'success' | 'failure' | 'error'
- `skip` (optional): Number of records to skip (default: 0)
- `take` (optional): Number of records to take (default: 50, max: 500)

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "action": "USER_LOGIN",
      "resourceType": "USER",
      "userId": "user-123",
      "userEmail": "user@example.com",
      "ipAddress": "192.168.1.1",
      "status": "success",
      "timestamp": 1234567890000,
      "createdAt": "2024-01-20T12:30:00Z"
    }
  ],
  "total": 100
}
```

### Get Statistics

```
GET /audit/statistics
```

**Query Parameters:**
- Same as search endpoint

**Response:**
```json
{
  "totalEvents": 1000,
  "eventsByAction": {
    "USER_LOGIN": 500,
    "CERTIFICATE_ISSUE": 300
  },
  "eventsByResourceType": {
    "USER": 500,
    "CERTIFICATE": 300,
    "ISSUER": 200
  },
  "eventsByStatus": {
    "success": 950,
    "failure": 30,
    "error": 20
  },
  "eventsPerDay": {
    "2024-01-20": 50,
    "2024-01-21": 60
  },
  "topUsers": [
    {
      "userId": "admin-123",
      "userEmail": "admin@example.com",
      "eventCount": 200
    }
  ],
  "topResources": [
    {
      "resourceId": "cert-456",
      "resourceType": "CERTIFICATE",
      "eventCount": 50
    }
  ]
}
```

### Export Logs as CSV

```
GET /audit/export
```

**Query Parameters:** Same as search endpoint

**Response:** CSV file with headers
```
ID,Action,Resource Type,Resource ID,User ID,User Email,IP Address,Status,Timestamp,Error Message,Correlation ID
```

### Get Resource Audit Trail

```
GET /audit/resource/:resourceId
```

**Query Parameters:**
- `limit` (optional): Number of records to return (default: 50)

**Response:** Array of audit logs for the resource

## Security

### Access Control

- All audit endpoints require JWT authentication via `JwtAuthGuard`
- Only authenticated users can access audit logs
- Consider adding additional authorization checks for admin-only operations

### Sensitive Data Handling

The audit system automatically handles some sensitive data, but you should:

1. **Never log passwords**: Use `[REDACTED]` for password fields
2. **Never log tokens**: Use `[REDACTED]` for API keys and tokens
3. **Never log secrets**: Use `[REDACTED]` for encryption keys

Example:
```typescript
const safeData = { ...userData };
if (safeData.password) safeData.password = '[REDACTED]';
if (safeData.apiKey) safeData.apiKey = '[REDACTED]';

await this.auditService.log({
  resourceData: safeData,
  // ...
});
```

### Immutability

Audit logs are append-only and cannot be modified or deleted by users. The database schema enforces this through:

- No UPDATE permissions on audit logs
- No DELETE permissions for regular users
- SYSTEM-level access only for cleanup job

To maintain immutability in production:
1. Use database roles and row-level security
2. Consider archiving old logs to cold storage
3. Implement cryptographic signing for critical events

## Performance Optimization

### Indexes

The `AuditLog` entity includes indexes on commonly searched fields:
- `userId`
- `action`
- `resourceType`
- `resourceId`
- `createdAt`
- `correlationId`
- `ipAddress`
- `status`

### Query Limits

- Maximum 500 records per request
- Pagination recommended for large result sets
- Export functionality handles up to 50,000 records

### Storage

Default retention: 90 days

To adjust:
```bash
AUDIT_RETENTION_DAYS=180  # Keep logs for 6 months
AUDIT_RETENTION_DAYS=365  # Keep logs for 1 year
```

Cleanup runs automatically daily at midnight UTC.

## Testing

Run audit module tests:

```bash
# Unit tests
npm test -- audit.service.spec

# All audit tests
npm test -- audit

# With coverage
npm test:cov -- audit
```

## Troubleshooting

### Audit Logs Not Being Recorded

1. Check that `AuditModule` is imported in `AppModule`
2. Verify `AuditContextMiddleware` is registered
3. Check database connection and `audit_logs` table exists
4. Review logs for any audit service errors

### Performance Issues

1. Check indexes are created: `SELECT * FROM pg_indexes WHERE tablename = 'audit_logs';`
2. Run VACUUM on the table: `VACUUM ANALYZE audit_logs;`
3. Consider archiving older logs
4. Review query execution plans: `EXPLAIN ANALYZE SELECT ...`

### Large Table Size

If the audit_logs table grows too large:

1. Adjust `AUDIT_RETENTION_DAYS` to lower value
2. Export old logs to archive storage
3. Manually delete archived logs: `DELETE FROM audit_logs WHERE createdAt < '2024-01-01';`
4. Consider partitioning by date

## Future Enhancements

The audit system is designed to support:

- [ ] Real-time alerting on suspicious activities
- [ ] SIEM (Security Information and Event Management) integration
- [ ] Email notifications for critical events
- [ ] Webhook integration for custom workflows
- [ ] Encrypted field support for sensitive data
- [ ] Audit log signing and verification
- [ ] Multi-tenant audit log isolation
- [ ] Custom event types and handlers

## References

- [NestJS Documentation](https://docs.nestjs.com)
- [TypeORM Documentation](https://typeorm.io)
- [PostgreSQL JSONB Documentation](https://www.postgresql.org/docs/current/datatype-json.html)
