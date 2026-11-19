# Email Notification Service

The Email Notification Service provides a robust, asynchronous email delivery system with support for multiple email templates and queue processing.

## Features

- 📧 **Multiple Email Templates**: Certificate issuance, email verification, password reset, and revocation notifications
- ⚙️ **Flexible Configuration**: Support for both SMTP and SendGrid
- 🔄 **Asynchronous Processing**: Queue-based email processing with Bull/Redis
- 🔁 **Automatic Retries**: Exponential backoff retry strategy with configurable attempts
- 🎨 **HTML Templates**: Handlebars-based email templates with dynamic data
- 🧪 **Comprehensive Tests**: Full test coverage for service and queue processor

## Installation

The email service is already integrated into the backend. Dependencies are configured in `package.json`:

```bash
npm install
```

Required dependencies:
- `nodemailer` - Email sending
- `@nestjs/bull` - Queue management
- `bull` - Background job processing
- `handlebars` - Template rendering
- `@types/nodemailer` - TypeScript types

## Configuration

### Environment Variables

Configure the following environment variables in your `.env` file:

```env
# Email Service Configuration
EMAIL_SERVICE=smtp  # or 'sendgrid'
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USERNAME=your-email@example.com
EMAIL_PASSWORD=your-password
EMAIL_FROM=noreply@stellarcert.com

# SendGrid Configuration (if using SendGrid instead of SMTP)
SENDGRID_API_KEY=your-sendgrid-api-key

# Redis Configuration (for job queue)
REDIS_URL=redis://localhost:6379

# Public app URL (for email links; also used by QR codes and PDFs)
FRONTEND_URL=https://stellarcert.com
# Deprecated alias, read only when FRONTEND_URL is unset
# APP_URL=https://stellarcert.com
```

### SMTP Configuration

For SMTP, set the following environment variables:

```env
EMAIL_SERVICE=smtp
EMAIL_HOST=smtp.gmail.com          # Example for Gmail
EMAIL_PORT=587
EMAIL_USERNAME=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
EMAIL_FROM=noreply@stellarcert.com
```

### SendGrid Configuration

To use SendGrid instead of SMTP:

```env
EMAIL_SERVICE=sendgrid
SENDGRID_API_KEY=SG.xxxxxxxxxxxx
EMAIL_FROM=noreply@stellarcert.com
```

## Available Email Types

### 1. Certificate Issued
Sent when a certificate is issued to a recipient.

**DTO:**
```typescript
{
  to: "recipient@example.com",
  certificateId: "cert-123",
  recipientName: "John Doe",
  certificateName: "AWS Certified Solutions Architect",
  issuerName: "Amazon Web Services"
}
```

### 2. Email Verification
Sent during user registration for email verification.

**DTO:**
```typescript
{
  to: "user@example.com",
  userName: "John Doe",
  verificationLink: "https://stellarcert.com/verify?token=abc123"
}
```

### 3. Password Reset
Sent when user requests a password reset.

**DTO:**
```typescript
{
  to: "user@example.com",
  userName: "John Doe",
  resetLink: "https://stellarcert.com/reset?token=xyz789"
}
```

### 4. Revocation Notice
Sent when a certificate is revoked.

**DTO:**
```typescript
{
  to: "recipient@example.com",
  recipientName: "John Doe",
  certificateId: "cert-123",
  certificateName: "AWS Certified Solutions Architect",
  reason: "User request",
  revocationDate: "2026-01-25T10:30:00Z"
}
```

## API Endpoints

### Send Certificate Issued Email
```
POST /email/send-certificate-issued
Content-Type: application/json

{
  "to": "recipient@example.com",
  "certificateId": "cert-123",
  "recipientName": "John Doe",
  "certificateName": "AWS Certificate",
  "issuerName": "AWS Academy"
}
```

### Send Verification Email
```
POST /email/send-verification
Content-Type: application/json

{
  "to": "user@example.com",
  "userName": "John Doe",
  "verificationLink": "https://stellarcert.com/verify?token=abc123"
}
```

### Send Password Reset Email
```
POST /email/send-password-reset
Content-Type: application/json

{
  "to": "user@example.com",
  "userName": "John Doe",
  "resetLink": "https://stellarcert.com/reset?token=xyz789"
}
```

### Send Revocation Notice Email
```
POST /email/send-revocation-notice
Content-Type: application/json

{
  "to": "recipient@example.com",
  "recipientName": "John Doe",
  "certificateId": "cert-123",
  "certificateName": "AWS Certificate",
  "reason": "User request",
  "revocationDate": "2026-01-25T10:30:00Z"
}
```

## Usage in Services

### Direct Email Service

```typescript
import { EmailService } from './modules/email/email.service';

constructor(private emailService: EmailService) {}

async issueCertificate(data: any) {
  // Issue certificate logic...
  
  // Send email immediately
  await this.emailService.sendCertificateIssued({
    to: data.recipientEmail,
    certificateId: certificate.id,
    recipientName: data.recipientName,
    certificateName: certificate.name,
    issuerName: certificate.issuerName,
  });
}
```

### Queue-Based Email Service (Recommended)

```typescript
import { EmailQueueService } from './modules/email/email-queue.service';

constructor(private emailQueueService: EmailQueueService) {}

async issueCertificate(data: any) {
  // Issue certificate logic...
  
  // Queue email asynchronously
  await this.emailQueueService.queueCertificateIssued({
    to: data.recipientEmail,
    certificateId: certificate.id,
    recipientName: data.recipientName,
    certificateName: certificate.name,
    issuerName: certificate.issuerName,
  });
  
  // Return immediately while email is processed in background
}
```

## Queue Monitoring

Get queue statistics:

```typescript
const stats = await this.emailQueueService.getQueueStats();
console.log('Queue Statistics:', {
  active: stats.active,
  delayed: stats.delayed,
  failed: stats.failed,
  completed: stats.completed,
});
```

## Email Templates

Templates are located in `/src/modules/email/templates/`:

1. **certificate-issued.hbs** - Certificate issuance notification
2. **verification-email.hbs** - Email verification
3. **password-reset.hbs** - Password reset request
4. **revocation-notice.hbs** - Certificate revocation notification

All templates use Handlebars syntax for dynamic content:

```handlebars
<p>Hello {{userName}},</p>
<p>Your certificate {{certificateName}} has been issued.</p>
```

## Testing

Run the email service tests:

```bash
# Run all tests
npm test

# Run email service tests only
npm test -- email.service

# Run with coverage
npm test:cov
```

## Integration Examples

### Auth Module Integration

In `auth.service.ts`:

```typescript
import { EmailQueueService } from '../email/email-queue.service';

@Injectable()
export class AuthService {
  constructor(private emailQueueService: EmailQueueService) {}

  async register(dto: RegisterDto) {
    const user = await this.createUser(dto);
    
    // Queue verification email
    await this.emailQueueService.queueVerificationEmail({
      to: user.email,
      userName: user.name,
      verificationLink: `${process.env.APP_URL}/verify?token=${user.verificationToken}`,
    });

    return user;
  }

  async requestPasswordReset(email: string) {
    const user = await this.findByEmail(email);
    const resetToken = this.generateResetToken();

    // Queue password reset email
    await this.emailQueueService.queuePasswordReset({
      to: user.email,
      userName: user.name,
      resetLink: `${process.env.APP_URL}/reset?token=${resetToken}`,
    });
  }
}
```

### Certificate Module Integration

In `certificate.service.ts`:

```typescript
import { EmailQueueService } from '../email/email-queue.service';

@Injectable()
export class CertificateService {
  constructor(private emailQueueService: EmailQueueService) {}

  async issueCertificate(dto: IssueCertificateDto) {
    const certificate = await this.createCertificate(dto);
    
    // Queue certificate issued email
    await this.emailQueueService.queueCertificateIssued({
      to: certificate.recipientEmail,
      certificateId: certificate.id,
      recipientName: certificate.recipientName,
      certificateName: certificate.name,
      issuerName: certificate.issuerName,
    });

    return certificate;
  }

  async revokeCertificate(id: string, reason: string) {
    const certificate = await this.findById(id);
    await this.updateStatus(id, 'revoked');
    
    // Queue revocation notice email
    await this.emailQueueService.queueRevocationNotice({
      to: certificate.recipientEmail,
      recipientName: certificate.recipientName,
      certificateId: certificate.id,
      certificateName: certificate.name,
      reason,
      revocationDate: new Date().toISOString(),
    });

    return certificate;
  }
}
```

## Error Handling

The email service includes comprehensive error handling:

- **Connection Verification**: Test SMTP/SendGrid connection before sending
- **Template Loading**: Validates all templates are loaded on startup
- **Retry Logic**: Automatic retries with exponential backoff for failed emails
- **Logging**: Detailed logging of all email operations

## Performance Considerations

1. **Async Processing**: Emails are processed asynchronously via Bull queue
2. **Batch Operations**: Multiple emails can be queued for processing
3. **Redis Storage**: Job states stored in Redis for reliability
4. **Automatic Cleanup**: Completed jobs removed automatically
5. **Failed Job Persistence**: Failed jobs retained for debugging

## Troubleshooting

### Emails not sending

1. **Check Redis connection**: Ensure Redis is running and accessible
   ```bash
   redis-cli ping
   ```

2. **Verify SMTP credentials**: Test with `verifyConnection()` method
   ```typescript
   const connected = await this.emailService.verifyConnection();
   console.log('Connected:', connected);
   ```

3. **Check logs**: Review application logs for error messages
   ```
   LOG [EmailService] Template loaded: certificate-issued
   LOG [EmailService] Email sent to user@example.com
   ```

### Template not found

- Ensure template files exist in `/src/modules/email/templates/`
- Check template naming matches template names in service calls
- Verify file permissions allow reading template files

### Queue not processing

- Confirm Redis is running: `redis-cli ping`
- Check queue stats: `await emailQueueService.getQueueStats()`
- Review application logs for processor errors

## Security Considerations

1. **Sensitive Data**: Never log email addresses in production
2. **Token Expiration**: Verification and reset tokens should expire
3. **Rate Limiting**: Implement rate limiting on email endpoints
4. **HTTPS Links**: Always use HTTPS in email links
5. **SMTP Credentials**: Store credentials in environment variables, never commit

## Future Enhancements

- [ ] Email template versioning
- [ ] A/B testing support
- [ ] Email analytics tracking
- [ ] Multi-language support
- [ ] Email preference management
- [ ] Bulk email scheduling
- [ ] Webhook notifications
