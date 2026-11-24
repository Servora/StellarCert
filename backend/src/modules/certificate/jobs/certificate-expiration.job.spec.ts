import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LessThanOrEqual } from 'typeorm';
import { CertificateExpirationJob } from './certificate-expiration.job';
import { Certificate } from '../entities/certificate.entity';
import { CertificateStatus } from '../constants/certificate-status.enum';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction } from '../../audit/constants/audit-action.enum';
import { LoggingService } from '../../../common/logging/logging.service';

describe('CertificateExpirationJob', () => {
  let job: CertificateExpirationJob;
  const repository = { update: jest.fn() };
  const auditService = { log: jest.fn() };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    repository.update.mockResolvedValue({ affected: 0 });
    auditService.log.mockResolvedValue(null);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificateExpirationJob,
        { provide: getRepositoryToken(Certificate), useValue: repository },
        { provide: AuditService, useValue: auditService },
        { provide: LoggingService, useValue: logger },
      ],
    }).compile();
    job = module.get(CertificateExpirationJob);
  });

  it('expires only active certificates whose explicit expiry date has passed', async () => {
    repository.update.mockResolvedValue({ affected: 2 });
    await job.checkExpiredCertificates();

    expect(repository.update).toHaveBeenCalledTimes(1);
    const [where, update] = repository.update.mock.calls[0];
    expect(where.status).toBe(CertificateStatus.ACTIVE);
    expect(where.expiresAt).toBeDefined();
    expect(update).toEqual({ status: CertificateStatus.EXPIRED });
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: AuditAction.CERTIFICATE_EXPIRE,
      metadata: expect.objectContaining({ reason: 'date_based', count: 2 }),
    }));
  });

  it('does not perform any issuer-sequence lookup or sequence-based expiration', async () => {
    await job.checkExpiredCertificates();
    expect(repository.update).toHaveBeenCalledTimes(1);
    expect(repository.update.mock.calls[0][0].expiresAt).toBeDefined();
  });

  it('does not create a certificate-expiration audit record when no rows expire', async () => {
    await job.checkExpiredCertificates();
    expect(auditService.log).not.toHaveBeenCalledWith(expect.objectContaining({
      action: AuditAction.CERTIFICATE_EXPIRE,
    }));
  });

  it('records completion even when the date-based update fails', async () => {
    repository.update.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(job.checkExpiredCertificates()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Bulk date-based expiration failed'));
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: AuditAction.BACKGROUND_JOB_COMPLETE,
    }));
  });

  it('does not allow audit persistence failures to fail the scheduled job', async () => {
    auditService.log.mockRejectedValue(new Error('audit storage unavailable'));
    await expect(job.checkExpiredCertificates()).resolves.toBeUndefined();
  });
});
