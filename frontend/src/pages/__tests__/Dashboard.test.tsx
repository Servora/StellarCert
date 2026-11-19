import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  getUserCertificatesMock: vi.fn(),
  getDashboardSummaryMock: vi.fn(),
  certificateVerifyMock: vi.fn(),
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => mocks.useAuthMock(),
}));

vi.mock("../../api/endpoints", () => ({
  analyticsApi: {
    getDashboardSummary: (...args: unknown[]) =>
      mocks.getDashboardSummaryMock(...args),
  },
  certificateApi: {
    verify: (...args: unknown[]) => mocks.certificateVerifyMock(...args),
  },
  getUserCertificates: (...args: unknown[]) =>
    mocks.getUserCertificatesMock(...args),
  UserRole: {
    ADMIN: "admin",
    ISSUER: "issuer",
    RECIPIENT: "recipient",
    VERIFIER: "verifier",
  },
}));

vi.mock("../AdminAnalyticsDashboard", () => ({
  default: () => <div>Admin analytics mock</div>,
}));

import Dashboard from "../Dashboard";
import { createTestQueryClient, renderWithProviders } from "../../test/renderWithProviders";

describe("Dashboard role views", () => {
  beforeEach(() => {
    mocks.useAuthMock.mockReset();
    mocks.getUserCertificatesMock.mockReset();
    mocks.getDashboardSummaryMock.mockReset();
    mocks.certificateVerifyMock.mockReset();

    mocks.getUserCertificatesMock.mockResolvedValue([
      {
        id: "cert-1",
        serialNumber: "CERT-2026-001",
        title: "Blockchain Fundamentals",
        issuerName: "StellarCert Academy",
        recipientName: "Alice Johnson",
        issueDate: new Date().toISOString(),
        status: "active",
        expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]);

    mocks.certificateVerifyMock.mockResolvedValue({
      isValid: true,
      message: "Certificate verified successfully",
      verifiedAt: new Date().toISOString(),
      certificate: {
        title: "Blockchain Fundamentals",
        recipientName: "Alice Johnson",
        issuerName: "StellarCert Academy",
        issuedDate: new Date().toISOString(),
      },
    });
  });

  it("renders the recipient wallet dashboard for recipient users", async () => {
    mocks.useAuthMock.mockReturnValue({
      user: { id: "recipient-1", role: "recipient" },
    });

    renderWithProviders(<Dashboard />, { queryClient: createTestQueryClient() });

    expect(
      await screen.findByRole("heading", { name: /Your Certificate Wallet/i }),
    ).toBeInTheDocument();
    expect(mocks.getUserCertificatesMock).toHaveBeenCalledWith("recipient-1");
    expect(
      screen.queryByRole("heading", { name: /Issuer Analytics Dashboard/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the verifier dashboard for verifier users", async () => {
    mocks.useAuthMock.mockReturnValue({
      user: { id: "verifier-1", role: "verifier" },
    });

    renderWithProviders(<Dashboard />, { queryClient: createTestQueryClient() });

    expect(
      await screen.findByRole("heading", { name: /Verification Center/i }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/CERT-2024-XXXXXXXX/i), {
      target: { value: "CERT-2026-001" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Verify$/i }));

    await waitFor(() =>
      expect(mocks.certificateVerifyMock).toHaveBeenCalledWith("CERT-2026-001"),
    );
    expect(
      await screen.findByText(/Certificate verified successfully/i),
    ).toBeInTheDocument();
  });

  it("renders admin analytics for admin users", async () => {
    mocks.useAuthMock.mockReturnValue({
      user: { id: "admin-1", role: "admin" },
    });

    renderWithProviders(<Dashboard />, { queryClient: createTestQueryClient() });

    expect(
      await screen.findByText(/Admin analytics mock/i),
    ).toBeInTheDocument();
  });
});
