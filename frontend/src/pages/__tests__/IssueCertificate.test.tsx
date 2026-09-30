import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { createTestQueryClient, renderWithProviders } from '../../test/renderWithProviders';

const {
  createCertificateMock,
  fetchUserByEmailMock,
} = vi.hoisted(() => ({
  createCertificateMock: vi.fn(),
  fetchUserByEmailMock: vi.fn(),
}));

// Stable identity is important: the page's useEffect depends on `user`,
// and returning a fresh object on every render would re-run the effect
// (and its setState) indefinitely.
const { issuerUser } = vi.hoisted(() => ({
  issuerUser: {
    id: 'issuer-1',
    firstName: 'Amina',
    lastName: 'Stone',
    role: 'issuer',
  },
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: issuerUser }),
}));

// Mocked at the endpoints module: the page's template query and issuance
// mutation both go through the query layer, which imports from there.
vi.mock('../../api/endpoints', () => ({
  createCertificate: createCertificateMock,
  fetchDefaultTemplate: vi.fn().mockResolvedValue({
    id: 'template-default',
    name: 'Classic Gold',
  }),
  fetchUserByEmail: fetchUserByEmailMock,
  templateApi: {
    list: vi.fn().mockResolvedValue([
      {
        id: 'template-default',
        name: 'Classic Gold',
      },
    ]),
  },
}));

import IssueCertificate from '../IssueCertificate';

describe('IssueCertificate', () => {
  beforeEach(() => {
    createCertificateMock.mockReset();
    fetchUserByEmailMock.mockReset();

    fetchUserByEmailMock.mockResolvedValue({ id: 'recipient-9' });
    createCertificateMock.mockResolvedValue({ id: 'cert-1' });
  });

  it('opens a preview before confirming certificate issuance', async () => {
    renderWithProviders(<IssueCertificate />, {
      queryClient: createTestQueryClient(),
    });

    // Templates load from the API and the default template is preselected
    await waitFor(() => {
      const templateSelect = screen.getByLabelText(/Certificate Template/i);
      expect(templateSelect).toHaveValue('template-default');
    });
    expect(
      screen.getByRole('option', { name: 'Classic Gold' }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Recipient Name/i), {
      target: { value: 'Jordan Lewis' },
    });
    fireEvent.change(screen.getByLabelText(/Recipient Email/i), {
      target: { value: 'jordan@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/Course Name/i), {
      target: { value: 'Blockchain Fundamentals' },
    });
    fireEvent.change(screen.getByLabelText(/Grade \/ Achievement Level/i), {
      target: { value: 'Distinction' },
    });
    fireEvent.change(screen.getByLabelText(/Issue Date/i), {      target: { value: '2026-03-29' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Preview Certificate/i }));

    expect(await screen.findByText(/Confirm certificate details/i)).toBeInTheDocument();
    // The preview shows the recipient in more than one place (heading +
    // details row), so assert via getAllByText
    expect(screen.getAllByText('Jordan Lewis').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText('Blockchain Fundamentals').length,
    ).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /Confirm and issue/i }));

    await waitFor(() => {
      expect(fetchUserByEmailMock).toHaveBeenCalledWith('jordan@example.com');
      expect(createCertificateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Blockchain Fundamentals Certificate',
          recipientName: 'Jordan Lewis',
          recipientEmail: 'jordan@example.com',
          courseName: 'Blockchain Fundamentals',
          issuerName: 'Amina Stone',
          issueDate: '2026-03-29',
          issuerId: 'issuer-1',
          recipientId: 'recipient-9',
          templateId: 'template-default',
          metadata: {
            grade: 'Distinction',
            courseName: 'Blockchain Fundamentals',
          },
        }),
      );
    });

    // The page surfaces issuance success via an inline banner (it does
    // not navigate away)
    expect(
      await screen.findByText(/Certificate issued successfully/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/cert-1/i)).toBeInTheDocument();
  });
});
