import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { CertificateExpirationJob } from './certificate-expiration.job';
import { Certificate } from '../entities/certificate.entity';
import { CertificateStatus } from '../constants/certificate-status.enum';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction } from '../../audit/constants/audit-action.enum';
import { StellarService } from '../../stellar/services/stellar.service';
import { LoggingService } from '../../../common/logging/logging.service';

describe('CertificateExpirationJob', () => {
  let job: CertificateExpirationJob;
  let auditService: AuditService;
  let certificateRepository: {
    createQueryBuilder: jest.Mock;
    save: jest.Mock;
  };
  let logger: LoggingService;

  const buildQueryBuilder = (certificates: Certificate[]) => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(certificates),
  });

  beforeEach(async () => {
    certificateRepository = {
      createQueryBuilder: jest.fn(),
      save: jest.fn((certificate) => Promise.resolve(certificate)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificateExpirationJob,
        {
          provide: getRepositoryToken(Certificate),
          useValue: certificateRepository,
        },
        {
          provide: StellarService,
          useValue: { getAccountInfo: jest.fn() },
        },
        {
          provide: AuditService,
          useValue: { log: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
        {
          provide: LoggingService,
          useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
        },
      ],
    }).compile();

    job = module.get(CertificateExpirationJob);
    auditService = module.get(AuditService);
    logger = module.get(LoggingService);
  });

  it('awaits every audit write so job-complete is recorded after the work', async () => {
    certificateRepository.createQueryBuilder
      .mockReturnValueOnce(buildQueryBuilder([]))
      .mockReturnValueOnce(buildQueryBuilder([]));

    await job.checkExpiredCertificates();

    expect(auditService.log).toHaveBeenCalledTimes(2);
    expect(auditService.log).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ action: AuditAction.BACKGROUND_JOB_START }),
    );
    expect(auditService.log).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: AuditAction.BACKGROUND_JOB_COMPLETE,
        metadata: expect.objectContaining({ markedExpired: 0 }),
      }),
    );
  });

  it('logs and swallows audit failures instead of leaving them unhandled', async () => {
    certificateRepository.createQueryBuilder
      .mockReturnValueOnce(buildQueryBuilder([]))
      .mockReturnValueOnce(buildQueryBuilder([]));
    (auditService.log as jest.Mock).mockRejectedValue(
      new Error('connection pool exhausted'),
    );

    await expect(job.checkExpiredCertificates()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('connection pool exhausted'),
    );
  });

  it('still expires certificates when their audit write fails', async () => {
    const certificate = {
      id: '1',
      certificateId: 'CERT-1',
      status: CertificateStatus.ACTIVE,
      expiresAt: new Date(Date.now() - 1000),
    } as Certificate;

    certificateRepository.createQueryBuilder
      .mockReturnValueOnce(buildQueryBuilder([certificate]))
      .mockReturnValueOnce(buildQueryBuilder([]));
    (auditService.log as jest.Mock).mockRejectedValue(new Error('db down'));

    await expect(job.checkExpiredCertificates()).resolves.toBeUndefined();

    expect(certificate.status).toBe(CertificateStatus.EXPIRED);
    expect(certificateRepository.save).toHaveBeenCalledWith(certificate);

    const completeCall = (auditService.log as jest.Mock).mock.calls.find(
      (call) => call[0].action === AuditAction.BACKGROUND_JOB_COMPLETE,
    );
    expect(completeCall[0].metadata).toEqual(
      expect.objectContaining({ markedExpired: 1 }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to write audit log'),
    );
  });
});
