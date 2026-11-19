import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { CertificateService } from './certificate.service';
import { Issuer } from '../issuers/entities/issuer.entity';

function build() {
  const manager = {
    create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
    save: jest.fn((entity: object) =>
      Promise.resolve({
        id: 'cert-1',
        issuerId: (entity as { issuerId?: string }).issuerId,
        ...entity,
      }),
    ),
    increment: jest.fn().mockResolvedValue(undefined),
  };
  const queryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    isTransactionActive: true,
    manager,
  };
  const service = new CertificateService(
    { update: jest.fn() } as never,
    {} as never,
    { findOne: jest.fn() } as never,
    {} as never,
    { triggerEvent: jest.fn() } as never,
    {} as never,
    { createQueryRunner: () => queryRunner } as unknown as DataSource,
    { isConfigured: () => false } as never,
    {
      get: (key: string) =>
        key === 'STELLAR_ANCHORING_ENABLED' ? 'false' : undefined,
    } as unknown as ConfigService,
  );
  jest
    .spyOn(service as never, 'generateCertificateId')
    .mockResolvedValue('CERT-1' as never);
  jest
    .spyOn(service as never, 'generateVerificationCode')
    .mockResolvedValue('CODE1234' as never);
  return { service, manager, queryRunner };
}

describe('CertificateService.create issuer counter', () => {
  const dto = {
    issuerId: 'issuer-1',
    recipientEmail: 'r@example.com',
    recipientName: 'R',
    title: 'T',
  } as never;

  it('increments the issuer certificate count in the issuing transaction', async () => {
    const { service, manager, queryRunner } = build();

    await service.create(dto);

    expect(manager.increment).toHaveBeenCalledWith(
      Issuer,
      { id: 'issuer-1' },
      'certificateCount',
      1,
    );
    // Counted before the commit, so a rollback can never leave a stale count.
    expect(manager.increment.mock.invocationCallOrder[0]).toBeLessThan(
      queryRunner.commitTransaction.mock.invocationCallOrder[0],
    );
  });

  it('does not count a certificate whose issuance failed', async () => {
    const { service, manager, queryRunner } = build();
    manager.save.mockRejectedValueOnce(new Error('db down'));

    await expect(service.create(dto)).rejects.toThrow('db down');

    expect(manager.increment).not.toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
  });
});
