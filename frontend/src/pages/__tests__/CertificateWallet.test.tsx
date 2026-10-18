import React from "react";
import { screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import type { Mock } from "vitest";

// ── API mock ───────────────────────────────────────────────────────────────
vi.mock("../../api/endpoints", () => ({
  certificateApi: {
    getQR: vi.fn().mockResolvedValue("data:image/png;base64,MOCK"),
  },
  getUserCertificates: vi.fn(),
  getCertificatePdfUrl: vi
    .fn()
    .mockResolvedValue("http://example.com/cert1.pdf"),
}));

// ── QRCodeModal mock ───────────────────────────────────────────────────────
vi.mock("../../components/QRCodeModal", () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="qr-modal">QR</div> : null,
}));

// ── AuthContext mock ───────────────────────────────────────────────────────
// The user reference must keep a STABLE identity across renders: the page's
// useEffect depends on `user`, and returning a fresh object on every render
// would re-run the effect (and its setState) indefinitely, masking fetch
// errors. The holder is mutable so a test can simulate an auth-state change
// (which legitimately triggers the user-dependent re-fetch).
const { walletAuth } = vi.hoisted(() => ({
  walletAuth: { user: { id: "u1" } as { id: string } },
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: walletAuth.user }),
}));

import CertificateWallet from "../CertificateWallet";
import { getUserCertificates } from "../../api/endpoints";
import { createTestQueryClient, renderWithProviders } from "../../test/renderWithProviders";

// Typed reference to the mocked function for easy per-test overrides
const mockedGetUserCertificates = getUserCertificates as Mock;

const MOCK_CERT = {
  id: "cert1",
  serialNumber: "CERT-2026-001",
  title: "Blockchain Fundamentals",
  recipientName: "Alice Johnson",
  issueDate: new Date().toISOString(),
  status: "active" as const,
  pdfUrl: "http://example.com/cert1.pdf",
};

describe("CertificateWallet", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Happy path ─────────────────────────────────────────────────────────
  it("renders certificates when fetch succeeds", async () => {
    mockedGetUserCertificates.mockResolvedValueOnce([MOCK_CERT]);

    renderWithProviders(<CertificateWallet />, { queryClient: createTestQueryClient() });

    await waitFor(() =>
      expect(
        screen.getByText(/Blockchain Fundamentals/i),
      ).toBeInTheDocument(),
    );
  });

  // ── Issue #568 fix ──────────────────────────────────────────────────────
  it("displays a visible error message when certificate fetch fails", async () => {
    mockedGetUserCertificates.mockRejectedValueOnce(
      new Error("Network error"),
    );

    renderWithProviders(<CertificateWallet />, { queryClient: createTestQueryClient() });

    // The error banner must appear — not just a silent console.error
    await waitFor(() =>
      expect(
        screen.getByText(/Failed to load your certificates/i),
      ).toBeInTheDocument(),
    );

    // The wallet grid must NOT render confusing empty state while error is shown
    expect(
      screen.queryByText(/Blockchain Fundamentals/i),
    ).not.toBeInTheDocument();
  });

  // ── Retry clears previous error ─────────────────────────────────────────
  it("clears a previous fetch error when re-fetch succeeds", async () => {
    // First call fails
    mockedGetUserCertificates.mockRejectedValueOnce(
      new Error("Network error"),
    );

    // `rerender` re-applies the provider wrapper, so the cache survives.
    const { rerender } = renderWithProviders(<CertificateWallet />, {
      queryClient: createTestQueryClient(),
    });

    await waitFor(() =>
      expect(
        screen.getByText(/Failed to load your certificates/i),
      ).toBeInTheDocument(),
    );

    // Next call succeeds — changing the authenticated user changes the
    // identity of `user`, which is part of the query key, so a fresh fetch
    // runs for the new account.
    mockedGetUserCertificates.mockResolvedValueOnce([MOCK_CERT]);
    walletAuth.user = { id: "u2" };
    rerender(<CertificateWallet />);

    // The stale error disappears as soon as the new key mounts.
    await waitFor(() =>
      expect(
        screen.queryByText(/Failed to load your certificates/i),
      ).not.toBeInTheDocument(),
    );

    expect(await screen.findByText(/Blockchain Fundamentals/i)).toBeInTheDocument();
  });

  // ── Dark mode fix (#795) ────────────────────────────────────────────────
  it("renders with correct dark mode classes", async () => {
    mockedGetUserCertificates.mockResolvedValueOnce([MOCK_CERT]);

    renderWithProviders(<CertificateWallet />, { queryClient: createTestQueryClient() });

    await waitFor(() =>
      expect(screen.getByText(/Blockchain Fundamentals/i)).toBeInTheDocument()
    );

    const card = screen.getByText(/Blockchain Fundamentals/i).closest('.bg-white');
    expect(card).toHaveClass('dark:bg-gray-900');
    
    const title = screen.getByText(/Blockchain Fundamentals/i);
    expect(title).toHaveClass('dark:text-white');

    const statusBadge = screen.getByText('active');
    expect(statusBadge).toHaveClass('dark:bg-green-900/30');
    expect(statusBadge).toHaveClass('dark:text-green-400');
  });

  it("renders empty state with correct classes", async () => {
    mockedGetUserCertificates.mockResolvedValueOnce([]);

    renderWithProviders(<CertificateWallet />, { queryClient: createTestQueryClient() });

    await waitFor(() =>
      expect(screen.getByText(/No Certificates Yet/i)).toBeInTheDocument()
    );

    const heading = screen.getByText(/No Certificates Yet/i);
    expect(heading).toHaveClass('text-gray-900');
    expect(heading).toHaveClass('dark:text-white');
  });
});
