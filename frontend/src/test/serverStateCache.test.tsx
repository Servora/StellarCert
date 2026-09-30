import React from "react";
import { screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import type { Mock } from "vitest";

/**
 * Issue #959 - "No server-state caching layer - every page refetches on each mount".
 *
 * These tests pin the behaviour a server-state cache must provide:
 *  - sibling components requesting the same resource are de-duplicated
 *  - a remount (i.e. navigating away from a route and back) is served from cache
 *
 * They deliberately build the client from `createQueryClient()` — the same
 * factory the app uses — so the 30s `staleTime` that makes this work is
 * verified here rather than re-declared in the test.
 */

vi.mock("../api/endpoints", () => ({
  certificateApi: {
    getQR: vi.fn().mockResolvedValue("data:image/png;base64,MOCK"),
  },
  getUserCertificates: vi.fn(),
  getCertificatePdfUrl: vi
    .fn()
    .mockResolvedValue("http://example.com/cert1.pdf"),
}));

const { walletAuth } = vi.hoisted(() => ({
  walletAuth: { user: { id: "u1" } as { id: string } },
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: walletAuth.user }),
}));

import CertificateWallet from "../pages/CertificateWallet";
import { getUserCertificates } from "../api/endpoints";
import { queryKeys } from "../api/queries";
import { createQueryClient } from "../lib/queryClient";
import { renderWithProviders } from "./renderWithProviders";

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

describe("server-state cache (#959)", () => {
  beforeEach(() => {
    mockedGetUserCertificates.mockResolvedValue([MOCK_CERT]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    walletAuth.user = { id: "u1" };
  });

  it("de-duplicates identical concurrent requests from sibling components", async () => {
    renderWithProviders(
      <>
        <CertificateWallet />
        <CertificateWallet />
      </>,
    );

    // Both wallets rendered the same shared resource.
    await waitFor(() =>
      expect(screen.getAllByText(/Blockchain Fundamentals/i)).toHaveLength(2),
    );

    // ...but it must only have been fetched once.
    expect(mockedGetUserCertificates).toHaveBeenCalledTimes(1);
  });

  it("serves a remounted route from cache instead of refetching", async () => {
    // One client shared across both mounts, mirroring a route teardown/navigation
    // in the running app.
    const queryClient = createQueryClient();

    const first = renderWithProviders(<CertificateWallet />, { queryClient });
    await waitFor(() =>
      expect(screen.getByText(/Blockchain Fundamentals/i)).toBeInTheDocument(),
    );
    expect(mockedGetUserCertificates).toHaveBeenCalledTimes(1);
    first.unmount();

    // Navigating back to the wallet.
    renderWithProviders(<CertificateWallet />, { queryClient });
    await waitFor(() =>
      expect(screen.getByText(/Blockchain Fundamentals/i)).toBeInTheDocument(),
    );

    expect(mockedGetUserCertificates).toHaveBeenCalledTimes(1);
  });

  it("refetches once the cached entry is no longer fresh", async () => {
    // Guards the other half of the contract: the cache is not a permanent
    // mirror. Once the entry goes stale, background revalidation runs again.
    const queryClient = createQueryClient();

    const first = renderWithProviders(<CertificateWallet />, { queryClient });
    await waitFor(() =>
      expect(screen.getByText(/Blockchain Fundamentals/i)).toBeInTheDocument(),
    );
    first.unmount();

    await queryClient.invalidateQueries({
      queryKey: queryKeys.certificates.user("u1"),
    });

    renderWithProviders(<CertificateWallet />, { queryClient });
    await waitFor(() => expect(mockedGetUserCertificates).toHaveBeenCalledTimes(2));
  });
});
