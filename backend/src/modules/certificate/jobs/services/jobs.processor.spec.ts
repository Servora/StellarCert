import { Brackets } from 'typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JobsProcessor } from './jobs.processor';
import { Certificate } from '../../entities/certificate.entity';
import { CertificateStatus } from '../../constants/certificate-status.enum';
import { WebhookEvent } from '../../../webhooks/entities/webhook-subscription.entity';
import { EmailService } from '../../../email/email.service';
import { CertificatePdfService } from '../../services/pdf.service';
import { WebhooksService } from '../../../webhooks/webhooks.service';
import { LoggingService } from '../../../../common/logging/logging.service';

/**
 * Regression tests for the `expiration-check` job query.
 *
 * The historical bug (ungrouped `orWhere`) OR-joined the stellar-sequence
 * condition at the top level, so certificates matching the sequence threshold
 * were selected regardless of their status — including REVOKED and FROZEN
 * ones — and were wrongly marked EXPIRED. These tests evaluate the built
 * query against an in-memory certificate set, faithfully mirroring SQL
 * condition semantics (first condition as base, `andWhere` → AND,
 * `orWhere` → OR, `Brackets` → grouped sub-expression).
 */

type Predicate = (cert: Record<string, any>) => boolean;

interface CapturedCondition {
  op: 'BASE' | 'AND' | 'OR';
  test: Predicate;
}

/** Translates the TypeORM SQL fragments used by the processor into predicates. */
function compileExpr(expr: string, params: Record<string, any>): Predicate {
  if (expr.includes('certificate.status = :status')) {
    const status = params.status;
    return (cert) => cert.status === status;
  }
  if (expr.includes('certificate.expiresAt <= :now')) {
    const now = new Date(params.now).getTime();
    return (cert) => new Date(cert.expiresAt).getTime() <= now;
  }
  if (expr.includes('certificate.expiresAt >= :windowDate')) {
    const windowDate = new Date(params.windowDate).getTime();
    return (cert) => new Date(cert.expiresAt).getTime() >= windowDate;
  }
  if (expr.includes("metadata->>'stellarSequence'")) {
    const threshold = params.sequenceThreshold;
    return (cert) =>
      Number(cert.metadata?.stellarSequence ?? Number.MAX_SAFE_INTEGER) <=
      threshold;
  }
  throw new Error(`Unhandled query expression in test mock: ${expr}`);
}

function makeQueryBuilder(certs: Array<Record<string, any>>) {
  const conditions: CapturedCondition[] = [];

  const addCondition =
    (op: CapturedCondition['op']) =>
    (expr: any, params?: Record<string, any>) => {
      if (expr instanceof Brackets) {
        // Evaluate the bracketed sub-query against its own condition list.
        const innerConditions: CapturedCondition[] = [];
        const innerBuilder = {
          where: (e: string, p?: Record<string, any>) => {
            innerConditions.push({
              op: 'BASE' as const,
              test: compileExpr(e, p!),
            });
            return innerBuilder;
          },
          andWhere: (e: string, p?: Record<string, any>) => {
            innerConditions.push({
              op: 'AND' as const,
              test: compileExpr(e, p!),
            });
            return innerBuilder;
          },
          orWhere: (e: string, p?: Record<string, any>) => {
            innerConditions.push({
              op: 'OR' as const,
              test: compileExpr(e, p!),
            });
            return innerBuilder;
          },
        };
        (expr as any).whereFactory(innerBuilder as any);
        conditions.push({
          op,
          test: (cert) => {
            let acc: boolean | null = null;
            for (const cond of innerConditions) {
              const value = cond.test(cert);
              acc =
                acc === null
                  ? value
                  : cond.op === 'AND'
                    ? acc && value
                    : acc || value;
            }
            return acc === true;
          },
        });
        return builder;
      }
      conditions.push({ op, test: compileExpr(expr as string, params ?? {}) });
      return builder;
    };

  const builder = {
    where: addCondition('BASE'),
    andWhere: addCondition('AND'),
    orWhere: addCondition('OR'),
    getMany: () => {
      const selected =
        conditions.length === 0
          ? [...certs]
          : certs.filter((cert) => {
              let acc: boolean | null = null;
              for (const cond of conditions) {
                const value = cond.test(cert);
                acc =
                  acc === null
                    ? value
                    : cond.op === 'AND'
                      ? acc && value
                      : acc || value;
              }
              return acc === true;
            });
      return Promise.resolve(selected);
    },
  };

  return builder;
}

function makeCert(
  overrides: Partial<Record<string, any>> = {},
): Record<string, any> {
  return {
    id: 'cert-id',
    issuerId: 'issuer-1',
    status: CertificateStatus.ACTIVE,
    expiresAt: new Date('2020-01-01T00:00:00Z'),
    metadata: { stellarSequence: '100000' },
    ...overrides,
  };
}

describe('JobsProcessor – expiration-check', () => {
  let processor: JobsProcessor;
  let save: jest.Mock;
  let triggerEvent: jest.Mock;
  const envSnapshot: Record<string, string | undefined> = {};

  const buildProcessor = (certs: Array<Record<string, any>>) => {
    const queryBuilder = makeQueryBuilder(certs);
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      save: save,
    } as unknown as any;
    processor = new JobsProcessor(
      repository,
      { triggerEvent } as any,
      { log: jest.fn(), error: jest.fn() } as any,
    );
    return processor;
  };

  beforeEach(() => {
    jest.resetModules();
    save = jest.fn((cert: Certificate) => Promise.resolve(cert));
    triggerEvent = jest.fn(() => Promise.resolve(undefined));
    for (const key of [
      'STELLAR_SEQUENCE_THRESHOLD',
      'CERTIFICATE_EXPIRY_WINDOW_DAYS',
    ]) {
      envSnapshot[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe('status safety (regression: ungrouped orWhere)', () => {
    it('does not select a REVOKED certificate even when its stellar sequence is at the threshold', async () => {
      process.env.STELLAR_SEQUENCE_THRESHOLD = '100000';

      const revoked = makeCert({
        id: 'revoked-1',
        status: CertificateStatus.REVOKED,
        expiresAt: new Date('2099-01-01T00:00:00Z'), // not expired by time
        metadata: { stellarSequence: '100000' }, // matches sequence branch
      });
      const activeExpired = makeCert({ id: 'active-expired' });

      await buildProcessor([revoked, activeExpired]).handleExpiration(
        {} as any,
      );

      const savedIds = save.mock.calls.map((call) => call[0].id);
      expect(savedIds).toContain('active-expired');
      expect(savedIds).not.toContain('revoked-1');
      expect(revoked.status).toBe(CertificateStatus.REVOKED);
    });

    it('does not select a FROZEN certificate matching the sequence threshold', async () => {
      process.env.STELLAR_SEQUENCE_THRESHOLD = '100000';

      const frozen = makeCert({
        id: 'frozen-1',
        status: CertificateStatus.FROZEN,
        expiresAt: new Date('2099-01-01T00:00:00Z'),
        metadata: { stellarSequence: '1' },
      });

      await buildProcessor([frozen]).handleExpiration({} as any);

      expect(save).not.toHaveBeenCalled();
      expect(frozen.status).toBe(CertificateStatus.FROZEN);
    });

    it('marks only ACTIVE certificates that match the sequence-threshold branch', async () => {
      process.env.STELLAR_SEQUENCE_THRESHOLD = '100000';

      const activeNotExpired = makeCert({
        id: 'active-sequence',
        expiresAt: new Date('2099-01-01T00:00:00Z'),
        metadata: { stellarSequence: '42' },
      });

      const processor = buildProcessor([activeNotExpired]);
      await processor.handleExpiration({} as any);

      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0][0].status).toBe(CertificateStatus.EXPIRED);
      expect(triggerEvent).toHaveBeenCalledWith(
        WebhookEvent.CERTIFICATE_EXPIRED,
        expect.any(String),
        expect.objectContaining({ id: 'active-sequence' }),
      );
    });
  });

  describe('expiry by time', () => {
    it('marks expired ACTIVE certificates as EXPIRED', async () => {
      const activeExpired = makeCert({ id: 'active-expired' });
      const activeFuture = makeCert({
        id: 'active-future',
        expiresAt: new Date('2099-01-01T00:00:00Z'),
      });

      await buildProcessor([activeExpired, activeFuture]).handleExpiration(
        {} as any,
      );

      const savedIds = save.mock.calls.map((call) => call[0].id);
      expect(savedIds).toEqual(['active-expired']);
      expect(save.mock.calls[0][0].status).toBe(CertificateStatus.EXPIRED);
    });

    it('marks nothing when no certificates match', async () => {
      const activeFuture = makeCert({
        id: 'active-future',
        expiresAt: new Date('2099-01-01T00:00:00Z'),
      });

      await buildProcessor([activeFuture]).handleExpiration({} as any);

      expect(save).not.toHaveBeenCalled();
      expect(triggerEvent).not.toHaveBeenCalled();
    });
  });

  describe('expiry window', () => {
    it('excludes certificates that expired before the configured window', async () => {
      process.env.CERTIFICATE_EXPIRY_WINDOW_DAYS = '30';

      const now = Date.now();
      const withinWindow = makeCert({
        id: 'within-window',
        expiresAt: new Date(now - 5 * 24 * 60 * 60 * 1000),
      });
      const outsideWindow = makeCert({
        id: 'outside-window',
        expiresAt: new Date(now - 90 * 24 * 60 * 60 * 1000),
      });

      await buildProcessor([withinWindow, outsideWindow]).handleExpiration(
        {} as any,
      );

      const savedIds = save.mock.calls.map((call) => call[0].id);
      expect(savedIds).toEqual(['within-window']);
    });
  });
});

describe('JobsProcessor - email and pdf handlers (upstream coverage)', () => {
  let processor: JobsProcessor;
  let emailService: jest.Mocked<EmailService>;
  let pdfService: jest.Mocked<CertificatePdfService>;
  let certificateRepository: any;

  beforeEach(async () => {
    const mockEmailService = { sendEmail: jest.fn() };
    const mockPdfService = { generate: jest.fn() };
    const mockRepo = { findOne: jest.fn() };
    const mockWebhooks = {};
    const mockLogger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobsProcessor,
        { provide: getRepositoryToken(Certificate), useValue: mockRepo },
        { provide: WebhooksService, useValue: mockWebhooks },
        { provide: LoggingService, useValue: mockLogger },
        { provide: EmailService, useValue: mockEmailService },
        { provide: CertificatePdfService, useValue: mockPdfService },
      ],
    }).compile();

    processor = module.get<JobsProcessor>(JobsProcessor);
    emailService = module.get(EmailService);
    pdfService = module.get(CertificatePdfService);
    certificateRepository = module.get(getRepositoryToken(Certificate));
  });

  it('should call EmailService on send-email', async () => {
    const jobData = { recipientEmail: 'test@example.com', subject: 'Test', metadata: {} };
    await processor.handleEmail({ data: jobData } as any);
    expect(emailService.sendEmail).toHaveBeenCalledWith({
      to: 'test@example.com',
      subject: 'Test',
      template: 'certificate-issued',
      data: {},
    });
  });

  it('should call PdfService on generate-pdf', async () => {
    const cert = { id: 'cert-1' };
    certificateRepository.findOne.mockResolvedValue(cert);
    await processor.handlePdf({ data: { certificateId: 'cert-1' } } as any);
    expect(pdfService.generate).toHaveBeenCalledWith(cert);
  });
});
