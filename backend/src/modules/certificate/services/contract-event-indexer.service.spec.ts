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

  describe('polled-ledger marker when there are no events', () => {
    beforeEach(() => {
      configService.get.mockReturnValue(undefined);
    });

    it('persists the ledger polled through when nothing is new and there is no cursor yet', async () => {
      cursorRepository.findOne.mockResolvedValue(null);
      sorobanService.getContractEvents.mockResolvedValue({
        events: [],
        latestLedger: 520,
      });

      await expect(service.syncOnce()).resolves.toBe(0);

      expect(sorobanService.getContractEvents).toHaveBeenCalledWith(
        expect.objectContaining({ startLedger: 500 }),
      );
      expect(cursorRepository.save).toHaveBeenCalledTimes(1);
      expect(cursorRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: null, lastLedger: 520 }),
      );
    });

    it('resumes from the marker after a restart instead of re-deriving the start ledger', async () => {
      cursorRepository.findOne.mockResolvedValue({
        name: 'soroban-contract-events',
        cursor: null,
        lastLedger: 520,
      });
      sorobanService.getContractEvents.mockResolvedValue({
        events: [],
        latestLedger: 530,
      });

      await service.syncOnce();

      expect(sorobanService.getLatestLedgerSequence).not.toHaveBeenCalled();
      expect(sorobanService.getContractEvents).toHaveBeenCalledWith(
        expect.objectContaining({ startLedger: 520 }),
      );
      expect(cursorRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: null, lastLedger: 530 }),
      );
    });

    it('does not rewrite the marker when the ledger has not advanced', async () => {
      cursorRepository.findOne.mockResolvedValue({
        name: 'soroban-contract-events',
        cursor: null,
        lastLedger: 520,
      });
      sorobanService.getContractEvents.mockResolvedValue({
        events: [],
        latestLedger: 520,
      });

      await service.syncOnce();

      expect(cursorRepository.save).not.toHaveBeenCalled();
    });

    it('ignores a missing latest ledger instead of saving a bad marker', async () => {
      cursorRepository.findOne.mockResolvedValue(null);
      sorobanService.getContractEvents.mockResolvedValue({
        events: [],
        latestLedger: undefined,
      });

      await service.syncOnce();

      expect(cursorRepository.save).not.toHaveBeenCalled();
    });
  });

  it('does nothing when disabled', async () => {
    configService.get.mockReturnValue(undefined);
    await service.poll();
    expect(sorobanService.getContractEvents).not.toHaveBeenCalled();
  });

  describe('webhook fan-out during backlog catch-up', () => {
    const revokeEvent = (i: number) =>
      event(
        [sym('revoked'), str(`cert-${i}`)],
        nativeToScVal({ reason: 'fraud' }),
        { id: `evt-${i}`, pagingToken: `tok-${i}`, ledger: 10 + i },
      );
    const page = (from: number, count: number) => ({
      events: Array.from({ length: count }, (_, i) => revokeEvent(from + i)),
      cursor: undefined,
    });

    let sleep: jest.Mock;

    beforeEach(() => {
      certificateRepository.findOne.mockImplementation(() =>
        Promise.resolve({
          id: 'c',
          issuerId: 'issuer-1',
          status: CertificateStatus.ACTIVE,
        }),
      );
      cursorRepository.findOne.mockResolvedValue({ cursor: 'start' });
      sleep = jest.fn().mockResolvedValue(undefined);
      (service as any).sleep = sleep;
      (service as any).now = () => 1_000_000; // frozen clock: every dispatch is "too soon"
    });

    it('paces webhook dispatch while working through a full page', async () => {
      sorobanService.getContractEvents
        .mockResolvedValueOnce(page(0, 100))
        .mockResolvedValueOnce(page(100, 0));

      await service.syncOnce();

      expect(webhooksService.triggerEvent).toHaveBeenCalledTimes(100);
      // The first dispatch goes out at once; each following one waits 1000/20 ms.
      expect(sleep).toHaveBeenCalledTimes(99);
      expect(sleep).toHaveBeenCalledWith(50);
    });

    it('honours the configured catch-up rate', async () => {
      configService.get.mockImplementation((key: string) =>
        key === 'CONTRACT_EVENT_INDEXER_CATCHUP_WEBHOOKS_PER_SECOND' ? '4' : undefined,
      );
      sorobanService.getContractEvents
        .mockResolvedValueOnce(page(0, 100))
        .mockResolvedValueOnce(page(100, 0));

      await service.syncOnce();

      expect(sleep).toHaveBeenCalledWith(250);
    });

    it('ignores an invalid configured rate and uses the default', async () => {
      configService.get.mockImplementation((key: string) =>
        key === 'CONTRACT_EVENT_INDEXER_CATCHUP_WEBHOOKS_PER_SECOND' ? '0' : undefined,
      );
      sorobanService.getContractEvents
        .mockResolvedValueOnce(page(0, 100))
        .mockResolvedValueOnce(page(100, 0));

      await service.syncOnce();

      expect(sleep).toHaveBeenCalledWith(50);
    });

    it('does not throttle steady-state polling (a short first page)', async () => {
      sorobanService.getContractEvents.mockResolvedValueOnce(page(0, 5));

      await service.syncOnce();

      expect(webhooksService.triggerEvent).toHaveBeenCalledTimes(5);
      expect(sleep).not.toHaveBeenCalled();
    });

    it('still applies every event and persists the cursor per page while throttled', async () => {
      sorobanService.getContractEvents
        .mockResolvedValueOnce(page(0, 100))
        .mockResolvedValueOnce(page(100, 3));

      const processed = await service.syncOnce();

      expect(processed).toBe(103);
      expect(certificateRepository.save).toHaveBeenCalledTimes(103);
      expect(cursorRepository.save).toHaveBeenCalledTimes(2);
    });

    it('leaves catch-up mode once the backlog is drained', async () => {
      sorobanService.getContractEvents
        .mockResolvedValueOnce(page(0, 100))
        .mockResolvedValueOnce(page(100, 0));

      await service.syncOnce();

      expect((service as any).catchingUp).toBe(false);
    });
  });
});
