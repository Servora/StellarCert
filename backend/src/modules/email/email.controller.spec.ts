import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { RATE_LIMIT_OPTIONS_KEY } from '../security/decorators/rate-limit.decorator';
import { ROLES_KEY } from '../users/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserRole } from '../../common/constants/roles';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';
import { EmailQueueService } from './email-queue.service';
import { LoggingService } from '../../common/logging/logging.service';

jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));

describe('EmailController security', () => {
  const emailService = {} as EmailService;
  const emailQueueService = {
    queueCertificateIssued: jest.fn(),
    queueVerificationEmail: jest.fn(),
    queuePasswordReset: jest.fn(),
    queueRevocationNotice: jest.fn(),
  } as unknown as EmailQueueService;
  const logger = { error: jest.fn() } as unknown as LoggingService;
  const controller = new EmailController(
    emailService,
    emailQueueService,
    logger,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function contextFor(role: UserRole): ExecutionContext {
    return {
      getHandler: () => EmailController.prototype.sendPasswordReset,
      getClass: () => EmailController,
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    } as unknown as ExecutionContext;
  }

  it('restricts all email routes to admins and applies a per-user rate limit', () => {
    const reflector = new Reflector();

    expect(Reflect.getMetadata(GUARDS_METADATA, EmailController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
    expect(reflector.get(ROLES_KEY, EmailController)).toEqual([UserRole.ADMIN]);
    expect(reflector.get(RATE_LIMIT_OPTIONS_KEY, EmailController)).toEqual({
      limit: 5,
      windowMs: 60_000,
      keyBy: 'user',
    });
  });

  it('denies regular users and allows admins through the role guard', () => {
    const guard = new RolesGuard(new Reflector());

    expect(() => guard.canActivate(contextFor(UserRole.USER))).toThrow();
    expect(guard.canActivate(contextFor(UserRole.ADMIN))).toBe(true);
  });

  it.each([
    [
      'certificate issued',
      'queueCertificateIssued',
      'sendCertificateIssued',
      { to: 'person@example.com' },
    ],
    [
      'verification',
      'queueVerificationEmail',
      'sendVerificationEmail',
      { to: 'person@example.com' },
    ],
    [
      'password reset',
      'queuePasswordReset',
      'sendPasswordReset',
      { to: 'person@example.com' },
    ],
    [
      'revocation notice',
      'queueRevocationNotice',
      'sendRevocationNotice',
      { to: 'person@example.com' },
    ],
  ])(
    'returns HTTP 503 when the %s message cannot be queued',
    async (_name, queueMethod, controllerMethod, dto) => {
      jest
        .spyOn(emailQueueService, queueMethod as keyof EmailQueueService)
        .mockRejectedValue(new Error('queue unavailable'));

      await expect(
        (
          controller[controllerMethod as keyof EmailController] as (
            value: unknown,
          ) => Promise<unknown>
        ).call(controller, dto),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    },
  );
});
