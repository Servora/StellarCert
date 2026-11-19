import { nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { ContractEventIndexerService } from './contract-event-indexer.service';
import { CertificateStatus } from '../constants/certificate-status.enum';
import { WebhookEvent } from '../../webhooks/entities/webhook-subscription.entity';
import { RawContractEvent } from '../../stellar/services/soroban.service';

const sym = (s: string) => nativeToScVal(s, { type: 'symbol' });
const str = (s: string) => nativeToScVal(s, { type: 'string' });

function event(
  topic: xdr.ScVal[],
  value: xdr.ScVal = xdr.ScVal.scvVoid(),
  overrides: Partial<RawContractEvent> = {},
): RawContractEvent {
  return {
    id: 'evt-1',
    pagingToken: 'tok-1',
    ledger: 10,
    txHash: 'hash',
    contractId: 'C1',
    inSuccessfulContractCall: true,
    topic,
    value,
    ...overrides,
  };
}

describe('ContractEventIndexerService', () => {
  let service: ContractEventIndexerService;
  let cert: any;
  const certificateRepository = {
    findOne: jest.fn(),
    save: jest.fn((c) => Promise.resolve(c)),
  };
  const transferRepository = { update: jest.fn() };
  const cursorRepository = {
    findOne: jest.fn(),
    create: jest.fn((v) => v),
    save: jest.fn((v) => Promise.resolve(v)),
  };
  const sorobanService = {
    isConfigured: jest.fn().mockReturnValue(true),
    getEventContractIds: jest.fn().mockReturnValue(['C1']),
    getLatestLedgerSequence: jest.fn().mockResolvedValue(500),
    getContractEvents: jest.fn(),
  };
  const webhooksService = { triggerEvent: jest.fn() };
  const configService = { get: jest.fn() };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    cert = {
      id: 'cert-1',
      issuerId: 'issuer-1',
      status: CertificateStatus.ACTIVE,
    };
    certificateRepository.findOne.mockResolvedValue(cert);
    service = new ContractEventIndexerService(
      certificateRepository as any,
      transferRepository as any,
      cursorRepository as any,
      sorobanService as any,
      webhooksService as any,
      configService as any,
      logger as any,
    );
  });

  it('marks a certificate revoked and fires a webhook', async () => {
    await service.handleEvent(
      event(
        [sym('revoked'), str('cert-1')],
        nativeToScVal({ id: 'cert-1', reason: 'fraud' }),
      ),
    );

    expect(cert.status).toBe(CertificateStatus.REVOKED);
    expect(cert.revocationReason).toBe('fraud');
    expect(webhooksService.triggerEvent).toHaveBeenCalledWith(
      WebhookEvent.CERTIFICATE_REVOKED,
      'issuer-1',
      expect.objectContaining({ id: 'cert-1' }),
    );
  });

  it('is idempotent for already-revoked certificates', async () => {
    cert.status = CertificateStatus.REVOKED;
    await service.handleEvent(
      event([sym('revoked'), str('cert-1')], nativeToScVal({ reason: 'x' })),
    );
    expect(certificateRepository.save).not.toHaveBeenCalled();
    expect(webhooksService.triggerEvent).not.toHaveBeenCalled();
  });

  it('treats a CRL revocation as a revocation', async () => {
    await service.handleEvent(
      event(
        [sym('crl'), sym('revoked'), str('cert-1')],
        nativeToScVal({ certificate_id: 'cert-1', reason: 1 }),
      ),
    );
    expect(cert.status).toBe(CertificateStatus.REVOKED);
  });

  it('freezes and unfreezes', async () => {
    await service.handleEvent(
      event([sym('frozen'), str('cert-1')], nativeToScVal({ reason: 'audit' })),
    );
    expect(cert.status).toBe(CertificateStatus.FROZEN);

    await service.handleEvent(event([sym('unfrozen'), str('cert-1')]));
    expect(cert.status).toBe(CertificateStatus.ACTIVE);
    expect(webhooksService.triggerEvent).toHaveBeenCalledTimes(2);
  });

  it('ignores events from failed contract calls', async () => {
    await service.handleEvent(
      event([sym('revoked'), str('cert-1')], xdr.ScVal.scvVoid(), {
        inSuccessfulContractCall: false,
      }),
    );
    expect(certificateRepository.findOne).not.toHaveBeenCalled();
  });

  it('updates the owner and pending transfers on transfer_done', async () => {
    await service.handleEvent(
      event(
        [sym('transfer_done'), str('t-1')],
        nativeToScVal({
          transfer_id: 't-1',
          certificate_id: 'cert-1',
          to_owner: 'GNEWOWNER',
        }),
      ),
    );
    expect(cert.recipientStellarAddress).toBe('GNEWOWNER');
    expect(transferRepository.update).toHaveBeenCalled();
  });

  it('persists the cursor after a page', async () => {
    configService.get.mockImplementation((k: string) =>
      k === 'CONTRACT_EVENT_INDEXER_START_LEDGER' ? '42' : undefined,
    );
    cursorRepository.findOne.mockResolvedValue(null);
    sorobanService.getContractEvents.mockResolvedValue({
      events: [event([sym('suspend'), str('cert-1')])],
      latestLedger: 100,
    });

    const processed = await service.syncOnce();

    expect(processed).toBe(1);
    expect(sorobanService.getContractEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 42 }),
    );
    expect(cursorRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 'tok-1', lastLedger: 10 }),
    );
  });

  it('does nothing when disabled', async () => {
    configService.get.mockReturnValue(undefined);
    await service.poll();
    expect(sorobanService.getContractEvents).not.toHaveBeenCalled();
  });
});
