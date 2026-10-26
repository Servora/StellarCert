import { BulkCertificateProcessor } from './bulk-certificate.processor';

describe('BulkCertificateProcessor', () => {
  let processor: BulkCertificateProcessor;
  let mockCertificateService: any;
  let mockNotificationsGateway: any;
  let mockServer: any;

  beforeEach(() => {
    mockCertificateService = {
      issue: jest
        .fn()
        .mockResolvedValue({ id: 'cert-1', certificateId: 'CERT-2026-001' }),
    };
    mockServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };
    mockNotificationsGateway = {
      server: mockServer,
    };

    processor = new BulkCertificateProcessor(
      mockCertificateService,
      mockNotificationsGateway,
    );
  });

  it('processes each certificate row and emits progress over socket', async () => {
    const job = {
      id: 'job-101',
      data: {
        issuerId: 'issuer-1',
        rows: [
          {
            dto: {
              recipientEmail: 'a@example.com',
              recipientName: 'Alice',
              title: 'Course 1',
            },
          },
          {
            dto: {
              recipientEmail: 'b@example.com',
              recipientName: 'Bob',
              title: 'Course 2',
            },
          },
        ],
      },
      progress: jest.fn().mockResolvedValue(true),
    };

    await processor.handleBulkIssuance(job as any);

    expect(mockCertificateService.issue).toHaveBeenCalledTimes(2);
    expect(job.progress).toHaveBeenCalledWith(50);
    expect(job.progress).toHaveBeenCalledWith(100);

    expect(mockServer.to).toHaveBeenCalledWith('user_issuer-1');
    expect(mockServer.emit).toHaveBeenCalledWith(
      'bulkIssuanceProgress',
      expect.objectContaining({
        jobId: 'job-101',
        total: 2,
        current: 2,
        progress: 100,
        successful: 2,
        failed: 0,
        status: 'completed',
      }),
    );
  });

  it('handles errors on a single row, continues processing and emits failed progress count', async () => {
    mockCertificateService.issue
      .mockRejectedValueOnce(new Error('Stellar error'))
      .mockResolvedValueOnce({ id: 'cert-2', certificateId: 'CERT-2026-002' });

    const job = {
      id: 'job-102',
      data: {
        issuerId: 'issuer-2',
        rows: [
          {
            dto: {
              recipientEmail: 'fail@example.com',
              recipientName: 'Fails',
              title: 'Fail Cert',
            },
          },
          {
            dto: {
              recipientEmail: 'ok@example.com',
              recipientName: 'Ok',
              title: 'Ok Cert',
            },
          },
        ],
      },
      progress: jest.fn().mockResolvedValue(true),
    };

    await processor.handleBulkIssuance(job as any);

    expect(mockCertificateService.issue).toHaveBeenCalledTimes(2);
    expect(mockServer.emit).toHaveBeenLastCalledWith(
      'bulkIssuanceProgress',
      expect.objectContaining({
        jobId: 'job-102',
        total: 2,
        current: 2,
        progress: 100,
        successful: 1,
        failed: 1,
        status: 'completed',
      }),
    );
  });
});
