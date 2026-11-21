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
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let logger: LoggingService;
  let stellarService: { getAccountInfo: jest.Mock };
  let configService: { get: jest.Mock };

  const buildSequenceQueryBuilder = (pages: Certificate[][]) => {
    const getMany = jest.fn();
    for (const page of pages) getMany.mockResolvedValueOnce(page);
    getMany.mockResolvedValue([]);
    return {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany,
    };
  };

  beforeEach(async () => {
    certificateRepository = {
      update: jest.fn().mockResolvedValue({ affected: 0 }),
      createQueryBuilder: jest.fn(() => buildSequenceQueryBuilder([])),
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
    stellarService = module.get(StellarService);
    configService = module.get(ConfigService);
  });

  it('awaits every audit write so job-complete is recorded after the work', async () => {
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
    (auditService.log as jest.Mock).mockRejectedValue(
      new Error('connection pool exhausted'),
    );

    await expect(job.checkExpiredCertificates()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('connection pool exhausted'),
    );
  });

  describe('date-based expiration (bulk UPDATE)', () => {
    it('issues a single bulk update and writes one audit entry carrying the count', async () => {
      certificateRepository.update.mockResolvedValue({ affected: 3 });

      await job.checkExpiredCertificates();

      expect(certificateRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: CertificateStatus.ACTIVE }),
        { status: CertificateStatus.EXPIRED },
      );

      const bulkCall = (auditService.log as jest.Mock).mock.calls.find(
        (call) =>
          call[0].action === AuditAction.CERTIFICATE_EXPIRE &&
          call[0].metadata?.reason === 'date_based',
      );
      expect(bulkCall[0].metadata).toEqual(
        expect.objectContaining({ bulk: true, count: 3 }),
      );

      const completeCall = (auditService.log as jest.Mock).mock.calls.find(
        (call) => call[0].action === AuditAction.BACKGROUND_JOB_COMPLETE,
      );
      expect(completeCall[0].metadata).toEqual(
        expect.objectContaining({ markedExpired: 3 }),
      );
    });

    it('writes no audit entry when nothing matched', async () => {
      certificateRepository.update.mockResolvedValue({ affected: 0 });

      await job.checkExpiredCertificates();

      const bulkCall = (auditService.log as jest.Mock).mock.calls.find(
        (call) => call[0].metadata?.reason === 'date_based',
      );
      expect(bulkCall).toBeUndefined();
    });

    it('logs the failure and still runs the sequence pass and closing audit entry when the bulk update rejects', async () => {
      certificateRepository.update.mockRejectedValue(new Error('db down'));

      await expect(job.checkExpiredCertificates()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Bulk date-based expiration failed'),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.BACKGROUND_JOB_COMPLETE,
        }),
      );
    });
  });

  describe('Stellar sequence-based expiration (paged)', () => {
    beforeEach(() => {
      configService.get.mockReturnValue('ISSUER_PUBLIC_KEY');
      stellarService.getAccountInfo.mockResolvedValue({ sequence: '100' });
    });

    it('expires a certificate whose recorded sequence the issuer has moved past', async () => {
      const certificate = {
        id: '1',
        certificateId: 'CERT-1',
        stellarSequenceNumber: '50',
      } as Certificate;
      certificateRepository.createQueryBuilder.mockReturnValue(
        buildSequenceQueryBuilder([[certificate]]),
      );
      certificateRepository.update.mockImplementation((where) =>
        Promise.resolve(where.id === '1' ? { affected: 1 } : { affected: 0 }),
      );

      await job.checkExpiredCertificates();

      expect(certificateRepository.update).toHaveBeenCalledWith(
        { id: '1', status: CertificateStatus.ACTIVE },
        { status: CertificateStatus.EXPIRED },
      );

      const sequenceCall = (auditService.log as jest.Mock).mock.calls.find(
        (call) => call[0].metadata?.reason === 'stellar_sequence',
      );
      expect(sequenceCall[0].resourceId).toBe('1');

      const completeCall = (auditService.log as jest.Mock).mock.calls.find(
        (call) => call[0].action === AuditAction.BACKGROUND_JOB_COMPLETE,
      );
      expect(completeCall[0].metadata).toEqual(
        expect.objectContaining({ markedExpired: 1 }),
      );
    });

    it('skips a row the guarded update did not actually flip, without counting or auditing it', async () => {
      const certificate = {
        id: '1',
        certificateId: 'CERT-1',
        stellarSequenceNumber: '50',
      } as Certificate;
      certificateRepository.createQueryBuilder.mockReturnValue(
        buildSequenceQueryBuilder([[certificate]]),
      );
      certificateRepository.update.mockResolvedValue({ affected: 0 });

      await job.checkExpiredCertificates();

      const sequenceCall = (auditService.log as jest.Mock).mock.calls.find(
        (call) => call[0].metadata?.reason === 'stellar_sequence',
      );
      expect(sequenceCall).toBeUndefined();

      const completeCall = (auditService.log as jest.Mock).mock.calls.find(
        (call) => call[0].action === AuditAction.BACKGROUND_JOB_COMPLETE,
      );
      expect(completeCall[0].metadata).toEqual(
        expect.objectContaining({ markedExpired: 0 }),
      );
    });

    it('pages through more than one batch of candidates', async () => {
      const page1 = [
        { id: '1', certificateId: 'CERT-1', stellarSequenceNumber: '50' },
      ] as Certificate[];
      const page2 = [
        { id: '2', certificateId: 'CERT-2', stellarSequenceNumber: '60' },
      ] as Certificate[];
      const qb = buildSequenceQueryBuilder([page1, page2]);
      certificateRepository.createQueryBuilder.mockReturnValue(qb);
      certificateRepository.update.mockResolvedValue({ affected: 1 });

      await job.checkExpiredCertificates();

      expect(qb.getMany).toHaveBeenCalledTimes(3); // page1, page2, empty page
      expect(certificateRepository.update).toHaveBeenCalledWith(
        { id: '1', status: CertificateStatus.ACTIVE },
        { status: CertificateStatus.EXPIRED },
      );
      expect(certificateRepository.update).toHaveBeenCalledWith(
        { id: '2', status: CertificateStatus.ACTIVE },
        { status: CertificateStatus.EXPIRED },
      );
    });

    it('is skipped entirely when no issuer public key is configured', async () => {
      configService.get.mockReturnValue(undefined);

      await job.checkExpiredCertificates();

      expect(stellarService.getAccountInfo).not.toHaveBeenCalled();
      expect(certificateRepository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  it('still records the closing audit entry when its own write fails', async () => {
    (auditService.log as jest.Mock).mockRejectedValue(new Error('db down'));
    certificateRepository.update.mockResolvedValue({ affected: 1 });

    await expect(job.checkExpiredCertificates()).resolves.toBeUndefined();

    const completeCall = (auditService.log as jest.Mock).mock.calls.find(
      (call) => call[0].action === AuditAction.BACKGROUND_JOB_COMPLETE,
    );
    expect(completeCall).toBeDefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to write audit log'),
    );
  });
});
