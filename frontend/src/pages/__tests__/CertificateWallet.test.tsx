import React from "react";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import type { Mock } from "vitest";

// ── API mock ───────────────────────────────────────────────────────────────
vi.mock("../../api/endpoints", () => ({
  certificateApi: {
    getQR: vi.fn().mockResolvedValue("data:image/png;base64,MOCK"),
    transfer: {
      getPending: vi.fn().mockResolvedValue([]),
    },
  },
  getMyCertificates: vi.fn(),
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
  walletAuth: {
    user: { id: "u1", role: "recipient", email: "alice@example.com" } as {
      id: string;
      role: string;
      email: string;
    },
  },
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: walletAuth.user }),
}));

import CertificateWallet from "../CertificateWallet";
import {
  getMyCertificates,
  getUserCertificates,
  certificateApi,
} from "../../api/endpoints";
import {
  createTestQueryClient,
  renderWithProviders,
} from "../../test/renderWithProviders";

// Typed reference to the mocked function for easy per-test overrides
const mockedGetMyCertificates = getMyCertificates as Mock;
const mockedGetUserCertificates = getUserCertificates as Mock;
const mockedGetPendingTransfers = certificateApi.transfer.getPending as Mock;

const MOCK_CERT = {
  id: "cert1",
  serialNumber: "CERT-2026-001",
  title: "Blockchain Fundamentals",
  recipientName: "Alice Johnson",
  recipientEmail: "alice@example.com",
  issueDate: new Date().toISOString(),
  status: "active" as const,
  pdfUrl: "http://example.com/cert1.pdf",
};

describe("CertificateWallet", () => {
  beforeEach(() => {
    walletAuth.user = {
      id: "u1",
      role: "recipient",
      email: "alice@example.com",
    };
    mockedGetMyCertificates.mockResolvedValue([MOCK_CERT]);
    mockedGetUserCertificates.mockResolvedValue([MOCK_CERT]);
    mockedGetPendingTransfers.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Happy path ─────────────────────────────────────────────────────────
  it("renders certificates when fetch succeeds", async () => {
    mockedGetMyCertificates.mockResolvedValueOnce([MOCK_CERT]);

    renderWithProviders(<CertificateWallet />, {
      queryClient: createTestQueryClient(),
    });

    await waitFor(() =>
      expect(screen.getByText(/Blockchain Fundamentals/i)).toBeInTheDocument(),
    );
  });

  // ── Issue #568 fix ──────────────────────────────────────────────────────
  it("displays a visible error message when certificate fetch fails", async () => {
    mockedGetMyCertificates.mockRejectedValueOnce(new Error("Network error"));

    renderWithProviders(<CertificateWallet />, {
      queryClient: createTestQueryClient(),
    });

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
    mockedGetMyCertificates.mockRejectedValueOnce(new Error("Network error"));

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
    // identity of `user`, which triggers a fresh fetch
    mockedGetMyCertificates.mockResolvedValueOnce([MOCK_CERT]);
    walletAuth.user = { id: "u2", role: "recipient", email: "bob@example.com" };
    rerender(<CertificateWallet />);

    // The stale error disappears as soon as the new key mounts.
    await waitFor(() =>
      expect(
        screen.queryByText(/Failed to load your certificates/i),
      ).not.toBeInTheDocument(),
    );

    expect(
      await screen.findByText(/Blockchain Fundamentals/i),
    ).toBeInTheDocument();
  });

  // ── Dark mode fix (#795) ────────────────────────────────────────────────
  it("renders with correct dark mode classes", async () => {
    mockedGetMyCertificates.mockResolvedValueOnce([MOCK_CERT]);

    renderWithProviders(<CertificateWallet />, {
      queryClient: createTestQueryClient(),
    });

    await waitFor(() =>
      expect(screen.getByText(/Blockchain Fundamentals/i)).toBeInTheDocument(),
    );

    const card = screen
      .getByText(/Blockchain Fundamentals/i)
      .closest(".bg-white");
    expect(card).toHaveClass("dark:bg-gray-900");

    const title = screen.getByText(/Blockchain Fundamentals/i);
    expect(title).toHaveClass("dark:text-white");

    const statusBadge = screen.getByText("active");
    expect(statusBadge).toHaveClass("dark:bg-green-900/30");
    expect(statusBadge).toHaveClass("dark:text-green-400");
  });

  it("renders empty state with correct classes", async () => {
    mockedGetMyCertificates.mockResolvedValueOnce([]);

    renderWithProviders(<CertificateWallet />, {
      queryClient: createTestQueryClient(),
    });

    await waitFor(() =>
      expect(screen.getByText(/No Certificates Yet/i)).toBeInTheDocument(),
    );

    const heading = screen.getByText(/No Certificates Yet/i);
    expect(heading).toHaveClass("text-gray-900");
    expect(heading).toHaveClass("dark:text-white");
  });

  // ── Transfer status and Share Links ──────────────────────────────────────
  it("displays transfer status badge on certificate card when transfer is pending", async () => {
    mockedGetMyCertificates.mockResolvedValueOnce([MOCK_CERT]);
    mockedGetPendingTransfers.mockResolvedValueOnce([
      {
        id: "transfer-1",
        certificateId: "cert1",
        status: "pending",
        fromEmail: "alice@example.com",
        toEmail: "bob@example.com",
      },
    ]);

    renderWithProviders(<CertificateWallet />, {
      queryClient: createTestQueryClient(),
    });

    await waitFor(() =>
      expect(screen.getByTestId("transfer-status-cert1")).toBeInTheDocument(),
    );
    expect(screen.getByText(/Transfer: pending/i)).toBeInTheDocument();
  });

  it("opens Share Links modal and copies verification link", async () => {
    mockedGetMyCertificates.mockResolvedValueOnce([MOCK_CERT]);
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    renderWithProviders(<CertificateWallet />, {
      queryClient: createTestQueryClient(),
    });

    await waitFor(() =>
      expect(screen.getByText(/Blockchain Fundamentals/i)).toBeInTheDocument(),
    );

    const shareLinkBtn = screen.getByTitle("Share Link");
    fireEvent.click(shareLinkBtn);

    expect(
      await screen.findByRole("dialog", { name: /Share certificate links/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Public Verification Link/i)).toBeInTheDocument();

    const copyBtn = screen.getByRole("button", { name: /Copy/i });
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining("/verify?serial=CERT-2026-001"),
    );
  });
});
