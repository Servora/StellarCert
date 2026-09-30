import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import CertificateTable from './CertificateTable';
import { certificateApi, auditApi } from '../api/endpoints';
import type { Certificate } from '../api';
import { createTestQueryClient, renderWithProviders } from '../test/renderWithProviders';

// Mocked at the endpoints module because the table's data now flows through the
// query layer, which imports its fetchers from there.
vi.mock('../api/endpoints', () => ({
  certificateApi: {
    list: vi.fn(),
    bulkExport: vi.fn(),
    bulkExportAll: vi.fn(),
    bulkRevoke: vi.fn(),
    freeze: vi.fn(),
    unfreeze: vi.fn(),
    transfer: { initiate: vi.fn() },
  },
  auditApi: {
    getCertificateHistory: vi.fn().mockResolvedValue([]),
  },
}));

const certificate = (overrides: Partial<Certificate> = {}): Certificate =>
  ({
    id: 'cert-1',
    serialNumber: 'SC-0001',
    recipientName: 'Ada Lovelace',
    recipientEmail: 'ada@example.com',
    title: 'Advanced Analytical Engines',
    courseName: 'Computing 101',
    issuerName: 'Royal Society',
    issueDate: '2026-01-15T00:00:00.000Z',
    status: 'active',
    ...overrides,
  }) as Certificate;

const listResolvesWith = (certificates: Certificate[]) => {
  vi.mocked(certificateApi.list).mockResolvedValue({
    data: certificates,
    total: certificates.length,
    totalPages: 1,
    page: 1,
    limit: 10,
  } as never);
};

const renderTable = async (certificates: Certificate[] = [certificate()]) => {
  listResolvesWith(certificates);
  renderWithProviders(<CertificateTable />, {
    queryClient: createTestQueryClient(),
  });
  await waitFor(() => expect(certificateApi.list).toHaveBeenCalled());
};

const openDetails = async (serialNumber = 'SC-0001') => {
  const button = await screen.findByRole('button', {
    name: `View certificate ${serialNumber}`,
  });
  await userEvent.click(button);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CertificateTable "View Certificate" action', () => {
  // The button rendered enabled with no onClick, so clicking it did nothing
  // and the user had no way to tell it was not meant to work.
  it('opens the certificate details dialog', async () => {
    await renderTable();

    expect(screen.queryByRole('dialog', { name: /certificate details/i })).not.toBeInTheDocument();

    await openDetails();

    expect(screen.getByRole('dialog', { name: /certificate details/i })).toBeInTheDocument();
  });

  it('shows the certificate the row belongs to', async () => {
    await renderTable([
      certificate(),
      certificate({ id: 'cert-2', serialNumber: 'SC-0002', recipientName: 'Grace Hopper' }),
    ]);

    await openDetails('SC-0002');

    const dialog = screen.getByRole('dialog', { name: /certificate details/i });
    expect(dialog).toHaveTextContent('SC-0002');
    expect(dialog).toHaveTextContent('Grace Hopper');
    expect(dialog).not.toHaveTextContent('Ada Lovelace');
  });

  it('shows the certificate fields', async () => {
    await renderTable();
    await openDetails();

    const dialog = screen.getByRole('dialog', { name: /certificate details/i });
    expect(dialog).toHaveTextContent('Ada Lovelace');
    expect(dialog).toHaveTextContent('ada@example.com');
    expect(dialog).toHaveTextContent('Advanced Analytical Engines');
    expect(dialog).toHaveTextContent('Computing 101');
    expect(dialog).toHaveTextContent('Royal Society');
  });

  it('reads the details straight from the row, without a second request', async () => {
    await renderTable();
    const callsBefore = vi.mocked(certificateApi.list).mock.calls.length;

    await openDetails();

    expect(vi.mocked(certificateApi.list).mock.calls).toHaveLength(callsBefore);
  });

  it('says so when the certificate has no expiry', async () => {
    await renderTable();
    await openDetails();

    expect(screen.getByRole('dialog', { name: /certificate details/i })).toHaveTextContent(
      'No expiry',
    );
  });

  it('shows the expiry date when there is one', async () => {
    await renderTable([certificate({ expiryDate: '2027-01-15T00:00:00.000Z' })]);
    await openDetails();

    const dialog = screen.getByRole('dialog', { name: /certificate details/i });
    expect(dialog).toHaveTextContent(new Date('2027-01-15T00:00:00.000Z').toLocaleDateString());
  });

  it('shows the transaction hash and IPFS CID when present', async () => {
    await renderTable([certificate({ txHash: 'abc123def456', cid: 'bafyfakecid' })]);
    await openDetails();

    const dialog = screen.getByRole('dialog', { name: /certificate details/i });
    expect(dialog).toHaveTextContent('abc123def456');
    expect(dialog).toHaveTextContent('bafyfakecid');
  });

  it('omits the chain fields when the certificate has none', async () => {
    await renderTable();
    await openDetails();

    const dialog = screen.getByRole('dialog', { name: /certificate details/i });
    expect(dialog).not.toHaveTextContent(/Transaction Hash/i);
    expect(dialog).not.toHaveTextContent(/IPFS CID/i);
  });

  it('explains why a frozen certificate is frozen', async () => {
    await renderTable([
      certificate({ status: 'frozen', freezeReason: 'Pending accreditation review' }),
    ]);
    await openDetails();

    expect(screen.getByRole('dialog', { name: /certificate details/i })).toHaveTextContent(
      'Pending accreditation review',
    );
  });

  it('links to the certificate file when one exists', async () => {
    await renderTable([certificate({ pdfUrl: 'https://files.example.com/cert-1.pdf' })]);
    await openDetails();

    const link = screen.getByRole('link', { name: /open certificate file/i });
    expect(link).toHaveAttribute('href', 'https://files.example.com/cert-1.pdf');
    // A cross-origin target="_blank" without this leaks window.opener.
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('offers no file link when the certificate has no file', async () => {
    await renderTable();
    await openDetails();

    expect(screen.queryByRole('link', { name: /open certificate file/i })).not.toBeInTheDocument();
  });

  it('closes from the close button', async () => {
    await renderTable();
    await openDetails();

    await userEvent.click(screen.getByRole('button', { name: /close certificate details/i }));

    expect(screen.queryByRole('dialog', { name: /certificate details/i })).not.toBeInTheDocument();
  });

  it('closes from the footer button', async () => {
    await renderTable();
    await openDetails();

    const dialog = screen.getByRole('dialog', { name: /certificate details/i });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog', { name: /certificate details/i })).not.toBeInTheDocument();
  });

  it('reopens with a different certificate after closing', async () => {
    await renderTable([
      certificate(),
      certificate({ id: 'cert-2', serialNumber: 'SC-0002', recipientName: 'Grace Hopper' }),
    ]);

    await openDetails('SC-0001');
    await userEvent.click(screen.getByRole('button', { name: /close certificate details/i }));
    await openDetails('SC-0002');

    expect(screen.getByRole('dialog', { name: /certificate details/i })).toHaveTextContent(
      'Grace Hopper',
    );
  });

  it('does not trigger a revoke or freeze when viewing', async () => {
    await renderTable();
    await openDetails();

    expect(certificateApi.freeze).not.toHaveBeenCalled();
    expect(certificateApi.bulkRevoke).not.toHaveBeenCalled();
  });
});

// A failure has to reach the user, not just the console: the page banner
// auto-dismisses, so each action must also leave state the user can see (an
// inline message, a dialog that stays open, a retry) and must not double-submit
// while a request is in flight.
describe('CertificateTable failure feedback', () => {
  const renderWithHandlers = async (certificates: Certificate[] = [certificate()]) => {
    const onError = vi.fn();
    const onSuccess = vi.fn();
    listResolvesWith(certificates);
    renderWithProviders(<CertificateTable onError={onError} onSuccess={onSuccess} />);
    await screen.findByText(certificates[0].recipientName);
    return { onError, onSuccess };
  };

  beforeEach(() => {
    vi.mocked(auditApi.getCertificateHistory).mockResolvedValue([]);
  });

  it('shows a failed load as a failure with a retry, not as an empty list', async () => {
    const onError = vi.fn();
    vi.mocked(certificateApi.list).mockRejectedValueOnce(new Error('network down'));
    renderWithProviders(<CertificateTable onError={onError} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to fetch certificates/i);
    expect(screen.queryByText(/no certificates found/i)).not.toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith('Failed to fetch certificates');

    listResolvesWith([certificate()]);
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('still reports an empty result set when the load succeeded', async () => {
    listResolvesWith([]);
    renderWithProviders(<CertificateTable />);

    expect(await screen.findByText(/no certificates found/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the freeze dialog open and shows why freezing failed', async () => {
    const { onError } = await renderWithHandlers();
    vi.mocked(certificateApi.freeze).mockRejectedValueOnce(new Error('nope'));

    await userEvent.click(screen.getByTitle('Freeze Certificate'));
    await userEvent.type(screen.getByPlaceholderText(/reason for freezing/i), 'dispute');
    await userEvent.click(screen.getByRole('button', { name: 'Freeze' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to freeze certificate/i);
    expect(onError).toHaveBeenCalledWith('Failed to freeze certificate');
    // The dialog stays open with the reason intact so the action can be retried.
    expect(screen.getByPlaceholderText(/reason for freezing/i)).toHaveValue('dispute');
    expect(screen.getByRole('button', { name: 'Freeze' })).toBeEnabled();
  });

  it('disables the freeze action while the request is in flight', async () => {
    await renderWithHandlers();
    let release: () => void = () => {};
    vi.mocked(certificateApi.freeze).mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = () => resolve(); }) as never,
    );

    await userEvent.click(screen.getByTitle('Freeze Certificate'));
    await userEvent.type(screen.getByPlaceholderText(/reason for freezing/i), 'dispute');
    await userEvent.click(screen.getByRole('button', { name: 'Freeze' }));

    const pending = await screen.findByRole('button', { name: /freezing/i });
    expect(pending).toBeDisabled();
    expect(screen.getByTitle('Revoke Certificate')).toBeDisabled();

    release();

    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/reason for freezing/i)).not.toBeInTheDocument(),
    );
    expect(certificateApi.freeze).toHaveBeenCalledTimes(1);
  });

  it('closes the freeze dialog and confirms on success', async () => {
    const { onSuccess } = await renderWithHandlers();
    vi.mocked(certificateApi.freeze).mockResolvedValueOnce(undefined as never);

    await userEvent.click(screen.getByTitle('Freeze Certificate'));
    await userEvent.type(screen.getByPlaceholderText(/reason for freezing/i), 'dispute');
    await userEvent.click(screen.getByRole('button', { name: 'Freeze' }));

    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/reason for freezing/i)).not.toBeInTheDocument(),
    );
    expect(onSuccess).toHaveBeenCalledWith('Certificate frozen successfully');
  });

  it('shows a failed revoke inside the revoke dialog', async () => {
    const { onError } = await renderWithHandlers();
    vi.mocked(certificateApi.bulkRevoke).mockRejectedValueOnce(new Error('nope'));

    await userEvent.click(screen.getByTitle('Revoke Certificate'));
    await userEvent.type(screen.getByPlaceholderText(/reason for revocation/i), 'fraud');
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to revoke certificates/i);
    expect(onError).toHaveBeenCalledWith('Failed to revoke certificates');
    expect(screen.getByPlaceholderText(/reason for revocation/i)).toHaveValue('fraud');
  });

  it('surfaces a failed unfreeze on the row', async () => {
    const { onError } = await renderWithHandlers([certificate({ status: 'frozen' })]);
    vi.mocked(certificateApi.unfreeze).mockRejectedValueOnce(new Error('nope'));

    await userEvent.click(screen.getByTitle('Unfreeze Certificate'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to unfreeze certificate/i);
    expect(onError).toHaveBeenCalledWith('Failed to unfreeze certificate');
    expect(screen.getByTitle('Unfreeze Certificate')).toBeEnabled();
  });

  it('keeps the transfer dialog open and shows why it failed', async () => {
    const { onError } = await renderWithHandlers();
    vi.mocked(certificateApi.transfer.initiate).mockRejectedValueOnce(new Error('nope'));

    await userEvent.click(screen.getByTitle('Transfer Certificate'));
    await userEvent.type(screen.getByPlaceholderText(/full name/i), 'Grace Hopper');
    await userEvent.type(screen.getByPlaceholderText('recipient@example.com'), 'grace@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Initiate Transfer' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to initiate transfer/i);
    expect(onError).toHaveBeenCalledWith('Failed to initiate transfer');
    expect(screen.getByPlaceholderText('recipient@example.com')).toHaveValue('grace@example.com');
  });

  it('surfaces a failed export of the selection', async () => {
    const { onError } = await renderWithHandlers();
    vi.mocked(certificateApi.bulkExport).mockRejectedValueOnce(new Error('nope'));

    await userEvent.click(screen.getAllByRole('checkbox')[1]);
    await userEvent.click(screen.getByRole('button', { name: /export \(1\)/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to export certificates/i);
    expect(onError).toHaveBeenCalledWith('Failed to export certificates');
    expect(screen.getByRole('button', { name: /export \(1\)/i })).toBeEnabled();
  });

  it('surfaces a failed export-all and re-enables the button', async () => {
    const { onError } = await renderWithHandlers();
    vi.mocked(certificateApi.bulkExportAll).mockRejectedValueOnce(new Error('nope'));

    await userEvent.click(screen.getByRole('button', { name: /export all \(1\)/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to export certificates/i);
    expect(onError).toHaveBeenCalledWith('Failed to export certificates');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /export all \(1\)/i })).toBeEnabled(),
    );
  });

  it('shows a failed history fetch inside the history dialog', async () => {
    const { onError } = await renderWithHandlers();
    vi.mocked(auditApi.getCertificateHistory).mockRejectedValueOnce(new Error('nope'));

    await userEvent.click(screen.getByTitle('View History'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /failed to load certificate history/i,
    );
    expect(onError).toHaveBeenCalledWith('Failed to load certificate history');
    // A failed fetch must not read as "this certificate has no history".
    expect(screen.queryByText(/no history found/i)).not.toBeInTheDocument();
  });
});
