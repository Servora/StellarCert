import React from "react";
import { screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { createTestQueryClient, renderWithProviders } from "../../test/renderWithProviders";

// Mock the endpoints module the page's queries import their fetchers from
vi.mock("../../api/endpoints", () => {
  const mockStats = {
    totalCertificates: 125,
    activeCertificates: 118,
    revokedCertificates: 7,
    expiredCertificates: 0,
    totalVerifications: 2847,
    lastLogin: new Date().toISOString(),
  };

  const mockActivity = {
    activities: [
      {
        id: "1",
        action: "ISSUE_CERTIFICATE",
        description:
          'Issued "Blockchain Fundamentals" certificate to Alice Johnson',
        ipAddress: "192.168.1.100",
        userAgent: "Mozilla/5.0",
        timestamp: new Date().toISOString(),
      },
    ],
    meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
  };

  const mockProfile = {
    id: "u1",
    email: "john@example.com",
    firstName: "John",
    lastName: "Doe",
    role: "issuer",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    profilePicture: "",
    metadata: { organization: "Acme" },
  };

  return {
    issuerProfileApi: {
      getStats: vi.fn().mockResolvedValue(mockStats),
      getActivity: vi.fn().mockResolvedValue(mockActivity),
      uploadProfilePicture: vi.fn(),
      updateProfile: vi.fn(),
    },
    userApi: {
      getProfile: vi.fn().mockResolvedValue(mockProfile),
    },
  };
});

import IssuerProfile from "../IssuerProfile";

describe("IssuerProfile", () => {
  it("renders issuer stats and recent activity from API", async () => {
    renderWithProviders(<IssuerProfile />, {
      queryClient: createTestQueryClient(),
    });

    // Wait for the total certificates stat to appear
    await waitFor(() =>
      expect(screen.getByText(/Total Certificates/i)).toBeInTheDocument(),
    );

    // Check numbers and activity description
    expect(screen.getByText("125")).toBeInTheDocument();
    expect(screen.getByText(/Blockchain Fundamentals/i)).toBeInTheDocument();
  });
});
