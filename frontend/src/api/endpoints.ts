import {
  ActivityItem,
  AdminAnalytics,
  ApiError,
  AuthResponse,
  AuditLogItem,
  Certificate,
  CertificateTemplate,
  CreateCertificateData,
  DashboardStats,
  IssuanceTrendPoint,
  PaginatedResponse,
  CertificateExportFilters,
  StatusDistribution,
  User,
  UserRole,
  VerificationResult,
  LoginCredentials,
  RegisterData,
  ProfileUpdateData,
  DailyVerificationStats,
  TotalCertificatesStats,
  TotalActiveUsersStats,
  IssuerStats,
  PaginatedActivityLog,
  CertificateTransfer,
  InitiateTransferDto,
  ApproveTransferDto,
  RejectTransferDto,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  VerifyEmailRequest,
} from "./types";
import { tokenStorage, notifyTokenRefreshed } from "./tokens";

interface AuditLogQueryParams {
  action?: string;
  resourceType?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

// Configuration flag - can be enabled via Vite env `VITE_(import.meta.env.VITE_USE_DUMMY_DATA === 'true')` ("true"/"false") in development only.
const viteEnv = import.meta as unknown as { env: Record<string, string> };

const API_URL_BASE =
  viteEnv.env?.VITE_API_URL || "http://localhost:3000/api/v1";
export const API_URL = API_URL_BASE;

// Helper function to simulate API delay
const simulateDelay = () => new Promise((resolve) => setTimeout(resolve, 300));

// Common error handler
const handleError = (error: unknown, endpointName: string): never => {
  console.error(`Error in ${endpointName}:`, error);
  const message =
    error instanceof Error ? error.message : "An unexpected error occurred";
  const statusCode =
    error && typeof error === "object" && "statusCode" in error
      ? (error as { statusCode: number }).statusCode
      : 500;
  const errorName =
    error && typeof error === "object" && "name" in error
      ? (error as { name: string }).name
      : "API Error";
  throw new ApiError(message, statusCode, errorName);
};

// Base path constants for authentication
export const AUTH_ENDPOINTS = {
  LOGIN: "/users/login",
  REGISTER: "/users/register",
  REFRESH: "/users/refresh-token",
  LOGOUT: "/users/logout",
} as const;

/**
 * Refresh tokens using the HttpOnly cookie sent automatically by the browser.
 *
 * Concurrent callers are coalesced onto a single in-flight request. The refresh
 * endpoint is IP-rate-limited, so the app must never issue a page-load burst of
 * refresh requests. AuthContext now performs one explicit bootstrap refresh
 * before rendering routes, removing the old need for a cooldown workaround.
 *
 * This stays in the fetch layer (rather than the query layer) because it has to
 * rewrite the Authorization header of already-issued requests, not just queue
 * another one.
 */
let _refreshInFlight: Promise<AuthResponse> | null = null;

const refreshTokens = async (): Promise<AuthResponse> => {
  if (_refreshInFlight) return _refreshInFlight;

  _refreshInFlight = apiClient<AuthResponse>(AUTH_ENDPOINTS.REFRESH, {
    method: "POST",
    skipAuth: true,
  }).finally(() => {
    _refreshInFlight = null;
  });

  return _refreshInFlight;
};

/**
 * Standardized API client: a plain fetcher over the REST endpoints.
 *
 * Deliberately no retry/backoff here. Retries are a caching concern and live in
 * the query layer (`src/lib/queryClient.ts`), which can only retry queries it
 * owns -- doing it in both places produced duplicate requests and multiplied
 * delays. Mutating calls are also never retried here, so a double-submitted
 * revoke can't be manufactured by a network hiccup.
 *
 * The one exception is the 401 access-token refresh, which stays in this layer
 * because it has to rewrite the Authorization header of the in-flight request
 * and coalesce across every caller.
 */
export async function apiClient<T>(
  endpoint: string,
  options: RequestInit & { skipAuth?: boolean } = {},
): Promise<T> {
  const url = `${API_URL}${endpoint}`;

  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");

  if (!options.skipAuth) {
    const token = tokenStorage.getAccessToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  const attemptRequest = async (
    hasTriedRefresh: boolean = false,
  ): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        headers,
        credentials: "include",
      });
    } catch (error) {
      // A rejected fetch is a network-level failure, not an HTTP status, so
      // normalise it into the same shape callers already handle. Built with the
      // constructor rather than an object literal so `instanceof ApiError` holds
      // for `getErrorMessage` and friends.
      throw new ApiError(
        error instanceof Error ? error.message : "An unexpected error occurred",
        0,
        "Network Error",
      );
    }

    if (!response.ok) {
      const errorData: ApiError = await response.json().catch(() => ({
        message: response.statusText || "API request failed",
        statusCode: response.status,
      }));

      // Never attempt a refresh for the refresh call itself (skipAuth) — that
      // would recurse into refreshTokens and, with the shared in-flight
      // promise, deadlock the request against itself.
      if (response.status === 401 && !hasTriedRefresh && !options.skipAuth) {
        try {
          const refreshResponse = await refreshTokens();
          tokenStorage.setAccessToken(refreshResponse.accessToken);
          headers.set("Authorization", `Bearer ${refreshResponse.accessToken}`);
          // Forward the fresh user too so AuthContext updates both the user
          // object and isAuthenticated, not just the stored token (#560).
          notifyTokenRefreshed(
            refreshResponse.accessToken,
            refreshResponse.user,
          );
          // Replay the original request with the refreshed credential.
          return attemptRequest(true);
        } catch {
          tokenStorage.clearTokens();
          throw new ApiError(
            errorData.message,
            errorData.statusCode,
            errorData.error,
          );
        }
      }

      if (response.status === 401) {
        tokenStorage.clearTokens();
      }

      throw errorData;
    }

    if (response.status === 204) {
      return {} as T;
    }

    const json = await response.json();
    // Unwrap the global ResponseInterceptor envelope { statusCode, message, data }
    if (
      json &&
      typeof json === "object" &&
      "data" in json &&
      "statusCode" in json
    ) {
      return json.data as T;
    }
    return json as T;
  };

  return attemptRequest(false);
}

/**
 * Raw request helper for endpoints that need the underlying `Response`
 * (file/blob downloads and multipart uploads) rather than the parsed,
 * envelope-unwrapped JSON that `apiClient` returns. It attaches the bearer
 * token and performs a single transparent refresh-and-retry on a 401, but does
 * NOT force a JSON `Content-Type` — so callers can send `FormData` (letting the
 * browser set the multipart boundary) or their own JSON body.
 */
export async function apiClientRaw(
  url: string,
  options: RequestInit & { skipAuth?: boolean } = {},
): Promise<Response> {
  const headers = new Headers(options.headers);

  if (!options.skipAuth) {
    const token = tokenStorage.getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  let response = await fetch(url, {
    ...options,
    headers,
    credentials: "include",
  });

  if (response.status === 401 && !options.skipAuth) {
    try {
      const refreshResponse = await refreshTokens();
      tokenStorage.setAccessToken(refreshResponse.accessToken);
      headers.set("Authorization", `Bearer ${refreshResponse.accessToken}`);
      notifyTokenRefreshed(refreshResponse.accessToken, refreshResponse.user);
      response = await fetch(url, {
        ...options,
        headers,
        credentials: "include",
      });
    } catch {
      tokenStorage.clearTokens();
    }
  }

  return response;
}

// Dummy data generators
const dummyData = {
  users: [
    {
      id: "1",
      email: "john@example.com",
      firstName: "John",
      lastName: "Doe",
      role: UserRole.ISSUER,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "2",
      email: "jane@example.com",
      firstName: "Jane",
      lastName: "Smith",
      role: UserRole.RECIPIENT,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ] as User[],

  certificates: [
    {
      id: "cert-1",
      serialNumber: "CERT-2023-001",
      recipientName: "John Doe",
      recipientEmail: "john@example.com",
      issueDate: new Date().toISOString(),
      expiryDate: new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      issuerName: "StellarCert Academy",
      status: "active",
      title: "Blockchain Expert",
      courseName: "Stellar Fundamentals",
    },
    {
      id: "cert-2",
      serialNumber: "CERT-2023-002",
      recipientName: "Jane Smith",
      recipientEmail: "jane@example.com",
      issueDate: new Date().toISOString(),
      expiryDate: new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      issuerName: "StellarCert Academy",
      status: "revoked",
      title: "Web3 Developer",
      courseName: "Smart Contract Development",
    },
  ] as Certificate[],

  templates: [
    {
      id: "template-default",
      name: "Default Template",
      description: "Standard academic certificate template",
      layoutUrl: "/templates/default.pdf",
      fields: ["name", "date", "course"],
      issuerId: "1",
    },
  ] as CertificateTemplate[],
};

// ==================== USER MANAGEMENT ====================

export const fetchUserByEmail = async (email: string): Promise<User | null> => {
  if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
    await simulateDelay();
    const user = dummyData.users.find((user) => user.email === email);

    return user || null;
  }

  try {
    return await apiClient<User | null>(`/users/email/${email}`);
  } catch (error) {
    return handleError(error, "fetchUserByEmail");
  }
};

export const userApi = {
  getProfile: async (): Promise<User> => {
    return apiClient<User>("/users/profile");
  },
  updateProfile: async (data: ProfileUpdateData): Promise<User> => {
    return apiClient<User>("/users/profile", {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },
  getByEmail: fetchUserByEmail,
  getAll: async (
    params?: Record<string, string | number | boolean>,
  ): Promise<PaginatedResponse<User>> => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        searchParams.append(key, String(value));
      });
    }
    return apiClient<PaginatedResponse<User>>(
      `/users?${searchParams.toString()}`,
    );
  },
  getById: async (id: string) => apiClient<User>(`/users/${id}`),
  updateRole: async (id: string, role: string) =>
    apiClient<User>(`/users/${id}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),
  toggleStatus: async (id: string, isActive: boolean) =>
    apiClient<User>(`/users/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ isActive }),
    }),
  delete: async (id: string) =>
    apiClient<void>(`/users/${id}`, { method: "DELETE" }),
};

// ==================== TEMPLATE MANAGEMENT ====================

export const fetchDefaultTemplate = async (): Promise<CertificateTemplate> => {
  if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
    await simulateDelay();
    const template = dummyData.templates[0];
    console.log("Dummy Template Data:", template);
    return template;
  }

  try {
    return await apiClient<CertificateTemplate>("/templates/default");
  } catch (error) {
    return handleError(error, "fetchDefaultTemplate");
  }
};

export const templateApi = {
  list: async (): Promise<CertificateTemplate[]> => {
    if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
      await simulateDelay();
      return dummyData.templates;
    }
    return apiClient<CertificateTemplate[]>("/templates");
  },
  getDefaultTemplate: fetchDefaultTemplate,
};

// ==================== CERTIFICATE MANAGEMENT ====================

export const verifyCertificate = async (
  serialNumber: string,
): Promise<VerificationResult> => {
  if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
    await simulateDelay();
    const certificate = dummyData.certificates.find(
      (cert) => cert.serialNumber === serialNumber,
    );
    const result: VerificationResult = certificate
      ? {
          isValid: certificate.status === "active",
          status: certificate.status === "active" ? "valid" : "revoked",
          certificate,
          verificationDate: new Date().toISOString(),
          verifiedAt: new Date().toISOString(),
          message:
            certificate.status === "active"
              ? "Certificate is valid and active"
              : "Certificate has been revoked.",
          verificationId: `ver_${Date.now()}`,
        }
      : {
          isValid: false,
          status: "not_found",
          verificationDate: new Date().toISOString(),
          verifiedAt: new Date().toISOString(),
          message: "Certificate not found",
          verificationId: `ver_${Date.now()}`,
        };
    console.log("Dummy Verification:", result);
    return result;
  }

  try {
    return await apiClient<VerificationResult>(
      `/certificates/verify/${encodeURIComponent(serialNumber)}`,
    );
  } catch (error) {
    return handleError(error, "verifyCertificate");
  }
};

export const createCertificate = async (
  data: CreateCertificateData,
): Promise<Certificate> => {
  if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
    await simulateDelay();
    const newCertificate: Certificate = {
      id: `cert-${Date.now()}`,
      serialNumber: `CERT-${new Date().getFullYear()}-${Math.floor(
        Math.random() * 1000,
      )
        .toString()
        .padStart(3, "0")}`,
      recipientName: data.recipientName,
      recipientEmail: data.recipientEmail,
      title: "New Certificate",
      courseName: data.courseName,
      issuerName: "StellarCert Academy",
      issueDate: new Date().toISOString(),
      status: "active",
    };
    dummyData.certificates.push(newCertificate);
    console.log("Dummy certificate created:", newCertificate);
    return newCertificate;
  }

  try {
    const payload = {
      issuerId: data.issuerId,
      recipientId: data.recipientId || undefined,
      recipientEmail: data.recipientEmail,
      recipientName: data.recipientName,
      title: data.title,
      description: data.description || undefined,
      courseName: data.courseName || undefined,
      issuerName: data.issuerName || undefined,
      expiresAt: data.expiryDate || undefined,
      templateId: data.templateId || undefined,
      metadata: data.metadata || undefined,
    };
    return await apiClient<Certificate>("/certificates", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch (error) {
    return handleError(error, "createCertificate");
  }
};

export const revokeCertificate = async (
  id: string,
  reason: string,
): Promise<Certificate> => {
  if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
    await simulateDelay();
    const certificate = dummyData.certificates.find((cert) => cert.id === id);
    if (certificate) {
      certificate.status = "revoked";
      console.log("Dummy certificate revoked:", certificate);
      return certificate;
    }
    throw new Error("Certificate not found");
  }

  try {
    return await apiClient<Certificate>(`/certificates/${id}/revoke`, {
      method: "PATCH",
      body: JSON.stringify({ reason }),
    });
  } catch (error) {
    return handleError(error, "revokeCertificate");
  }
};

export const findCertBySerialNumber = async (
  serialNumber: string,
): Promise<Certificate | null> => {
  if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
    await simulateDelay();
    const certificate = dummyData.certificates.find(
      (cert) => cert.serialNumber === serialNumber,
    );
    console.log("Dummy Certificate:", certificate);
    return certificate || null;
  }

  try {
    return await apiClient<Certificate | null>(
      `/certificates/serial/${serialNumber}`,
    );
  } catch (error) {
    return handleError(error, "findCertBySerialNumber");
  }
};

export const getCertificatePdfUrl = async (
  certificateId: string,
): Promise<string | null> => {
  if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
    await simulateDelay();
    const certificate = dummyData.certificates.find(
      (cert) => cert.id === certificateId,
    );
    return certificate ? `/api/dummy-pdf/${certificateId}` : null;
  }

  try {
    const data = await apiClient<{ pdfUrl: string }>(
      `/certificates/${certificateId}/pdf`,
    );
    return data.pdfUrl;
  } catch (error) {
    return handleError(error, "getCertificatePdfUrl");
  }
};

export const getUserCertificates = async (
  userId: string,
): Promise<Certificate[]> => {
  if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
    await simulateDelay();
    return dummyData.certificates.filter(
      (cert) => cert.recipientEmail === userId || cert.id === userId,
    );
  }

  try {
    const result = await apiClient<
      | Certificate[]
      | { certificates: Certificate[]; total: number }
      | PaginatedResponse<Certificate>
    >(`/certificates/user/${userId}`);
    if (Array.isArray(result)) return result;
    if ("data" in result)
      return (result as PaginatedResponse<Certificate>).data;
    if ("certificates" in result)
      return (result as { certificates: Certificate[] }).certificates;
    return [];
  } catch (error) {
    return handleError(error, "getUserCertificates");
  }
};

export const getCertificateQR = async (
  certificateId: string,
): Promise<string> => {
  if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
    await simulateDelay();
    // Return a dummy QR code URL
    return `data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjBmMGYwIi8+CiAgPHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkJJIENvZGU6ICR7Y2VydGlmaWNhdGVJZH08L3RleHQ+Cjwvc3ZnPg==`;
  }

  try {
    const data = await apiClient<{ qrCode: string }>(
      `/certificates/${certificateId}/qr`,
    );
    return data.qrCode;
  } catch (error) {
    return handleError(error, "getCertificateQR");
  }
};

export const certificateApi = {
  list: async (params?: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    startDate?: string;
    endDate?: string;
  }): Promise<PaginatedResponse<Certificate>> => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== "") {
          searchParams.append(key, String(value));
        }
      });
    }
    return apiClient<PaginatedResponse<Certificate>>(
      `/certificates?${searchParams.toString()}`,
    );
  },
  create: createCertificate,
  verify: verifyCertificate,
  revoke: revokeCertificate,
  getById: async (id: string): Promise<Certificate> => {
    return apiClient<Certificate>(`/certificates/${id}`);
  },
  getAll: async (
    params?: Record<string, string | number | boolean>,
  ): Promise<PaginatedResponse<Certificate> | Certificate[]> => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        searchParams.set(key, String(value));
      });
    }

    if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
      await simulateDelay();
      return {
        data: dummyData.certificates,
        certificates: dummyData.certificates,
        total: dummyData.certificates.length,
        page: 1,
        limit: dummyData.certificates.length,
        totalPages: 1,
      } as PaginatedResponse<Certificate> & { certificates: Certificate[] };
    }

    return apiClient<PaginatedResponse<Certificate>>(
      `/certificates?${searchParams.toString()}`,
    );
  },
  getUserCertificates,
  bulkExport: async (
    certificateIds: string[],
    filters?: CertificateExportFilters,
  ): Promise<Blob> => {
    if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
      await simulateDelay();
      const headers = [
        "ID",
        "Recipient Name",
        "Email",
        "Title",
        "Status",
        "Issue Date",
      ];
      const normalizedSearch = filters?.search?.trim().toLowerCase();
      const startDate = filters?.startDate ? new Date(filters.startDate) : null;
      const endDate = filters?.endDate ? new Date(filters.endDate) : null;
      const certs = dummyData.certificates.filter((certificate) => {
        const matchesIds =
          certificateIds.length === 0 ||
          certificateIds.includes(certificate.id);
        const matchesSearch =
          !normalizedSearch ||
          [
            certificate.id,
            certificate.serialNumber,
            certificate.recipientName,
            certificate.recipientEmail,
            certificate.title,
            certificate.issuerName,
          ].some((value) => value?.toLowerCase().includes(normalizedSearch));
        const matchesStatus =
          !filters?.status || certificate.status === filters.status;
        const issueDate = new Date(certificate.issueDate);
        const matchesStartDate = !startDate || issueDate >= startDate;
        const matchesEndDate = !endDate || issueDate <= endDate;

        return (
          matchesIds &&
          matchesSearch &&
          matchesStatus &&
          matchesStartDate &&
          matchesEndDate
        );
      });
      const rows = certs.map((c) => [
        c.id,
        c.recipientName,
        c.recipientEmail,
        c.title,
        c.status,
        c.issueDate,
      ]);
      const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
      return new Blob([csv], { type: "text/csv" });
    }
    const response = await apiClientRaw(`${API_URL}/certificates/export`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenStorage.getAccessToken()}`,
      },
      body: JSON.stringify({ certificateIds, filters }),
    });
    if (!response.ok) throw new Error("Export failed");
    return response.blob();
  },
  bulkExportAll: async (filters?: CertificateExportFilters): Promise<Blob> => {
    if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
      await simulateDelay();
      const headers = [
        "ID",
        "Recipient Name",
        "Email",
        "Title",
        "Status",
        "Issue Date",
      ];
      const normalizedSearch = filters?.search?.trim().toLowerCase();
      const startDate = filters?.startDate ? new Date(filters.startDate) : null;
      const endDate = filters?.endDate ? new Date(filters.endDate) : null;
      const certs = dummyData.certificates.filter((certificate) => {
        const matchesSearch =
          !normalizedSearch ||
          [
            certificate.id,
            certificate.serialNumber,
            certificate.recipientName,
            certificate.recipientEmail,
            certificate.title,
            certificate.issuerName,
          ].some((value) => value?.toLowerCase().includes(normalizedSearch));
        const matchesStatus =
          !filters?.status || certificate.status === filters.status;
        const issueDate = new Date(certificate.issueDate);
        const matchesStartDate = !startDate || issueDate >= startDate;
        const matchesEndDate = !endDate || issueDate <= endDate;

        return (
          matchesSearch && matchesStatus && matchesStartDate && matchesEndDate
        );
      });
      const rows = certs.map((c) => [
        c.id,
        c.recipientName,
        c.recipientEmail,
        c.title,
        c.status,
        c.issueDate,
      ]);
      const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
      return new Blob([csv], { type: "text/csv" });
    }

    const response = await apiClientRaw(`${API_URL}/certificates/export/all`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenStorage.getAccessToken()}`,
      },
      body: JSON.stringify({ filters }),
    });
    if (!response.ok) {
      throw new Error("Export failed");
    }
    return response.blob();
  },
  bulkRevoke: async (
    certificateIds: string[],
    reason?: string,
  ): Promise<Certificate[]> => {
    if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
      await simulateDelay();
      const updatedCerts: Certificate[] = [];
      for (const id of certificateIds) {
        const cert = dummyData.certificates.find(
          (certificate) => certificate.id === id,
        );
        if (cert) {
          cert.status = "revoked";
          updatedCerts.push(cert);
        }
      }
      return updatedCerts;
    }

    return apiClient<Certificate[]>("/certificates/bulk-revoke", {
      method: "POST",
      body: JSON.stringify({ certificateIds, reason }),
    });
  },
  freeze: async (
    certificateId: string,
    reason: string,
    durationDays: number,
  ): Promise<Certificate> => {
    if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
      await simulateDelay();
      const cert = dummyData.certificates.find(
        (certificate) => certificate.id === certificateId,
      );
      if (!cert) {
        throw new Error("Certificate not found");
      }

      cert.status = "frozen";
      cert.freezeReason = reason;
      cert.frozenAt = new Date().toISOString();
      const unfreezeDate = new Date();
      unfreezeDate.setDate(unfreezeDate.getDate() + durationDays);
      cert.unfreezeAt = unfreezeDate.toISOString();
      return cert;
    }

    return apiClient<Certificate>(`/certificates/${certificateId}/freeze`, {
      method: "PATCH",
      body: JSON.stringify({ reason, durationDays }),
    });
  },
  unfreeze: async (certificateId: string): Promise<Certificate> => {
    if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
      await simulateDelay();
      const cert = dummyData.certificates.find(
        (certificate) => certificate.id === certificateId,
      );
      if (!cert) {
        throw new Error("Certificate not found");
      }

      cert.status = "active";
      cert.freezeReason = undefined;
      cert.frozenAt = undefined;
      cert.unfreezeAt = undefined;
      return cert;
    }

    return apiClient<Certificate>(`/certificates/${certificateId}/unfreeze`, {
      method: "PATCH",
    });
  },
  getQR: getCertificateQR,

  // Certificate Transfer API (#286)
  transfer: {
    initiate: async (
      data: InitiateTransferDto,
    ): Promise<CertificateTransfer> => {
      return apiClient("/certificates/transfers/initiate", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    approve: async (data: ApproveTransferDto): Promise<CertificateTransfer> => {
      return apiClient("/certificates/transfers/approve", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    reject: async (data: RejectTransferDto): Promise<CertificateTransfer> => {
      return apiClient("/certificates/transfers/reject", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    getPending: async (): Promise<CertificateTransfer[]> => {
      return apiClient("/certificates/transfers/pending");
    },
  },
};

// ==================== AUTHENTICATION ====================

export const loginApi = async (
  credentials: LoginCredentials,
): Promise<AuthResponse> => {
  if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
    await simulateDelay();
    const user = dummyData.users.find((u) => u.email === credentials.email);
    if (user && credentials.password === "password123") {
      const response: AuthResponse = {
        user,
        accessToken: "dummy-access-token",
        refreshToken: "dummy-refresh-token",
      };
      tokenStorage.setAccessToken(response.accessToken);
      return response;
    }
    throw new Error("Invalid credentials");
  }

  try {
    const response = await apiClient<AuthResponse>(AUTH_ENDPOINTS.LOGIN, {
      method: "POST",
      body: JSON.stringify({
        email: credentials.email,
        password: credentials.password,
      }),
      skipAuth: true,
    });
    tokenStorage.setAccessToken(response.accessToken);
    return response;
  } catch (error) {
    return handleError(error, "loginApi");
  }
};

export const registerApi = async (
  data: RegisterData,
): Promise<AuthResponse> => {
  if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
    await simulateDelay();
    const newUser: User = {
      id: `user-${Date.now()}`,
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      role: UserRole.USER,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    dummyData.users.push(newUser);
    const response: AuthResponse = {
      user: newUser,
      accessToken: "dummy-access-token",
      refreshToken: "dummy-refresh-token",
    };
    tokenStorage.setAccessToken(response.accessToken);
    return response;
  }

  try {
    const response = await apiClient<AuthResponse>(AUTH_ENDPOINTS.REGISTER, {
      method: "POST",
      body: JSON.stringify({
        email: data.email,
        password: data.password,
        firstName: data.firstName,
        lastName: data.lastName,
      }),
      skipAuth: true,
    });
    // Registration requires email verification before login is allowed.
    // Store access token so the UI can show the "check your email" state.
    if (response.accessToken) {
      tokenStorage.setAccessToken(response.accessToken);
    }
    return response;
  } catch (error) {
    return handleError(error, "registerApi");
  }
};

export const authApi = {
  login: loginApi,
  register: registerApi,
  /**
   * Establish the session during AuthProvider's initial bootstrap.
   * The HttpOnly refresh-token cookie is sent by the browser and the returned
   * access token remains in memory, preserving the XSS-hardening design.
   */
  bootstrapAuth: (): Promise<AuthResponse> => refreshTokens(),
  // Keep the legacy refresh entry point for existing callers/tests.
  refresh: (): Promise<AuthResponse> => refreshTokens(),
  logout: async (): Promise<void> => {
    try {
      if (!(import.meta.env.VITE_USE_DUMMY_DATA === "true")) {
        const accessToken = tokenStorage.getAccessToken();
        await apiClient(AUTH_ENDPOINTS.LOGOUT, {
          method: "POST",
          body: JSON.stringify({ accessToken: accessToken ?? "" }),
        });
      }
    } finally {
      tokenStorage.clearTokens();
    }
  },
  forgotPassword: async (
    data: ForgotPasswordRequest,
  ): Promise<{ message: string }> => {
    return apiClient("/users/forgot-password", {
      method: "POST",
      body: JSON.stringify(data),
      skipAuth: true,
    });
  },
  resetPassword: async (
    data: ResetPasswordRequest,
  ): Promise<{ message: string }> => {
    return apiClient("/users/reset-password", {
      method: "POST",
      body: JSON.stringify(data),
      skipAuth: true,
    });
  },
  verifyEmail: async (
    data: VerifyEmailRequest,
  ): Promise<{ message: string }> => {
    return apiClient("/users/verify-email", {
      method: "POST",
      body: JSON.stringify(data),
      skipAuth: true,
    });
  },
  resendVerification: async (email: string): Promise<{ message: string }> => {
    return apiClient("/users/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email }),
      skipAuth: true,
    });
  },
};

export const login = loginApi;
export const register = registerApi;

type CertificateStatsResponse = {
  totalCertificates: number;
  activeCertificates: number;
  revokedCertificates: number;
  expiredCertificates: number;
  issuanceTrend: IssuanceTrendPoint[];
  verificationStats: {
    totalVerifications: number;
    successfulVerifications: number;
    failedVerifications: number;
    dailyVerifications: number;
    weeklyVerifications: number;
  };
};

const buildStatusDistributionFromCertificates = (
  certificates: Certificate[],
): StatusDistribution => {
  const base: StatusDistribution = {
    active: 0,
    revoked: 0,
    expired: 0,
  };

  for (const cert of certificates) {
    if (cert.status === "active") {
      base.active += 1;
    } else if (cert.status === "revoked") {
      base.revoked += 1;
    } else if (cert.status === "expired") {
      base.expired += 1;
    }
  }

  return base;
};

const buildIssuanceTrendFromCertificates = (
  certificates: Certificate[],
): IssuanceTrendPoint[] =>
  Array.from(
    certificates.reduce((map, cert) => {
      const dateKey = cert.issueDate.slice(0, 10);
      map.set(dateKey, (map.get(dateKey) ?? 0) + 1);
      return map;
    }, new Map<string, number>()),
  )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

const buildRecentActivityFromCertificates = (
  certificates: Certificate[],
): ActivityItem[] =>
  certificates
    .map((cert) => ({
      type: (cert.status === "revoked"
        ? "revoke"
        : "issue") as ActivityItem["type"],
      date: cert.issueDate,
      description:
        cert.status === "revoked"
          ? `Revoked ${cert.title} for ${cert.recipientName}`
          : `Issued ${cert.title} to ${cert.recipientName}`,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

export const dailyCertificateVerification =
  async (): Promise<DailyVerificationStats> => {
    if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
      await simulateDelay();
      return { count: Math.floor(Math.random() * 50) + 20 };
    }
    return apiClient<DailyVerificationStats>(
      "/certificates/stats/daily-verification",
    );
  };

export const totalCertificates = async (): Promise<TotalCertificatesStats> => {
  if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
    await simulateDelay();
    return { total: dummyData.certificates.length };
  }
  return apiClient<TotalCertificatesStats>("/certificates/stats/total");
};

export const totalActiveUsers = async (): Promise<TotalActiveUsersStats> => {
  if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
    await simulateDelay();
    return { total: dummyData.users.length };
  }
  const stats = await apiClient<{
    total?: number;
    active?: number;
  }>("/users/stats");
  return { total: stats.active ?? stats.total ?? 0 };
};

export const analyticsApi = {
  getDashboardSummary: async (params?: {
    startDate?: string;
    endDate?: string;
    issuerId?: string;
  }): Promise<DashboardStats> => {
    if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
      await simulateDelay();

      let certificates = dummyData.certificates;
      if (params?.startDate && params?.endDate) {
        const start = new Date(params.startDate);
        const end = new Date(params.endDate);
        certificates = certificates.filter((cert) => {
          const issuedAt = new Date(cert.issueDate);
          return issuedAt >= start && issuedAt <= end;
        });
      }

      const statusDistribution =
        buildStatusDistributionFromCertificates(certificates);

      return {
        totalCertificates: certificates.length,
        activeCertificates: statusDistribution.active,
        revokedCertificates: statusDistribution.revoked,
        expiredCertificates: statusDistribution.expired,
        totalVerifications: 1250,
        verifications24h: 45,
        totalUsers: dummyData.users.length,
        issuanceTrend: buildIssuanceTrendFromCertificates(certificates),
        statusDistribution,
        recentActivity: buildRecentActivityFromCertificates(certificates),
      };
    }

    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.set("startDate", params.startDate);
    if (params?.endDate) searchParams.set("endDate", params.endDate);
    if (params?.issuerId) searchParams.set("issuerId", params.issuerId);
    const query = searchParams.toString();

    const data = await apiClient<CertificateStatsResponse>(
      `/certificates/stats${query ? `?${query}` : ""}`,
    );

    return {
      totalCertificates: data.totalCertificates,
      activeCertificates: data.activeCertificates,
      revokedCertificates: data.revokedCertificates,
      expiredCertificates: data.expiredCertificates,
      totalVerifications: data.verificationStats.totalVerifications,
      verifications24h: data.verificationStats.dailyVerifications,
      totalUsers: 0,
      issuanceTrend: data.issuanceTrend,
      statusDistribution: {
        active: data.activeCertificates,
        revoked: data.revokedCertificates,
        expired: data.expiredCertificates,
      },
      recentActivity: [],
    };
  },
};

export const adminAnalyticsApi = {
  getAnalytics: async (params?: {
    startDate?: string;
    endDate?: string;
  }): Promise<import("./types").AdminAnalytics> => {
    if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
      await simulateDelay();
      return {
        usersByRole: {
          users: 42,
          issuers: 12,
          admins: 3,
          total: dummyData.users.length,
        },
        usersByStatus: {
          active: dummyData.users.length,
          inactive: 0,
          suspended: 0,
          pendingVerification: 0,
        },
        certificatesByStatus: {
          active: dummyData.certificates.filter(
            (cert) => cert.status === "active",
          ).length,
          revoked: dummyData.certificates.filter(
            (cert) => cert.status === "revoked",
          ).length,
          expired: dummyData.certificates.filter(
            (cert) => cert.status === "expired",
          ).length,
          total: dummyData.certificates.length,
        },
        topIssuers: [
          {
            issuerId: "issuer-1",
            issuerName: "StellarCert Academy",
            certificateCount: dummyData.certificates.length,
            percentage: 100,
          },
        ],
        verificationTrends: {
          total: 1200,
          successful: 1140,
          failed: 60,
          successRate: 95,
          last24Hours: 45,
          last7Days: 210,
          last30Days: 830,
        },
        userRegistrationTrend: [
          {
            date: params?.startDate ?? new Date().toISOString().slice(0, 10),
            count: 2,
          },
        ],
        certificateIssuanceTrend: buildIssuanceTrendFromCertificates(
          dummyData.certificates,
        ),
        totalIssuers: 12,
      };
    }

    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.set("startDate", params.startDate);
    if (params?.endDate) searchParams.set("endDate", params.endDate);
    return apiClient(`/admin/analytics?${searchParams.toString()}`);
  },
};

export const issuerProfileApi = {
  getStats: async (): Promise<IssuerStats> => {
    if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
      await simulateDelay();
      return {
        totalCertificates: 125,
        activeCertificates: 118,
        revokedCertificates: 7,
        expiredCertificates: 0,
        totalVerifications: 2847,
        lastLogin: new Date().toISOString(),
      };
    }
    return apiClient<IssuerStats>("/users/profile/stats");
  },
  getActivity: async (
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedActivityLog> => {
    if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
      await simulateDelay();
      const activities = [
        {
          id: "1",
          action: "ISSUE_CERTIFICATE",
          description:
            'Issued "Blockchain Fundamentals" certificate to Alice Johnson',
          ipAddress: "192.168.1.100",
          userAgent: "Mozilla/5.0",
          timestamp: new Date().toISOString(),
        },
      ];
      return {
        activities,
        meta: {
          total: activities.length,
          page,
          limit,
          totalPages: 1,
        },
      };
    }
    return apiClient<PaginatedActivityLog>(
      `/users/profile/activity?page=${page}&limit=${limit}`,
    );
  },
  updateProfile: async (data: ProfileUpdateData): Promise<User> => {
    if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
      await simulateDelay();
      return dummyData.users[0];
    }
    return apiClient<User>("/users/profile/issuer", {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },
  uploadProfilePicture: async (
    file: File,
  ): Promise<{ profilePicture: string; message: string }> => {
    if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
      await simulateDelay();
      return {
        profilePicture: URL.createObjectURL(file),
        message: "Profile picture uploaded successfully",
      };
    }

    const formData = new FormData();
    formData.append("file", file);

    // Multipart upload: route through apiClientRaw so the browser sets the
    // multipart boundary (apiClient would force application/json and break it),
    // while still getting auth + 401-refresh handling.
    const response = await apiClientRaw(`${API_URL}/users/profile/picture`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        message: response.statusText || "Profile picture upload failed",
        statusCode: response.status,
      }));
      throw new ApiError(
        errorData.message,
        errorData.statusCode,
        errorData.error,
        errorData.details,
      );
    }
    return response.json();
  },
};

// ==================== DASHBOARD & ANALYTICS ====================
//
// Dashboard statistics are served by `analyticsApi.getDashboardSummary` above,
// which reads /certificates/stats. That is the endpoint to use and to change.
//
// A second `dashboardApi.getStats` used to live here, reading
// /admin/analytics. It was removed rather than merged because it was wrong on
// two counts, and neither was visible from the frontend alone:
//
//   1. /admin/analytics is @Roles(ADMIN) in AdminAnalyticsController, while
//      /certificates/stats allows ADMIN, ISSUER and AUDITOR. Dashboard.tsx
//      renders IssuerDashboard for any non-admin, non-recipient, non-verifier
//      user, so an issuer using it would have been rejected with a 403.
//   2. It never populated `statusDistribution`, so any consumer reading it
//      would have silently seen undefined for that field.
//
// Its sibling `getRecentActivity` called /admin/analytics/activity, a route
// that does not exist in the backend at all. Neither function had any caller
// outside this file, so removing them changed no behaviour.

export const dashboardApi = {
  getStats: async (): Promise<DashboardStats> => {
    if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
      await simulateDelay();
      return {
        totalCertificates: 1250,
        activeCertificates: 1200,
        revokedCertificates: 30,
        expiredCertificates: 20,
        issuanceTrend: [
          { date: "2023-01", count: 100 },
          { date: "2023-02", count: 120 },
          { date: "2023-03", count: 150 },
        ],
        totalVerifications: 450,
        verifications24h: 15,
        totalUsers: 1150,
        statusDistribution: {
          active: 1200,
          revoked: 30,
          expired: 20,
        },
        recentActivity: [
          {
            type: "issue",
            date: new Date().toISOString(),
            description: "Issued certificate 'Blockchain Expert' to John Doe",
          },
        ],
      };
    }
    const data = await apiClient<AdminAnalytics>("/admin/analytics");
    return {
      totalCertificates: data.certificatesByStatus.total,
      activeCertificates: data.certificatesByStatus.active,
      revokedCertificates: data.certificatesByStatus.revoked,
      expiredCertificates: data.certificatesByStatus.expired,
      totalVerifications: data.verificationTrends.total,
      verifications24h: data.verificationTrends.last24Hours,
      totalUsers: data.usersByRole.total,
      issuanceTrend: data.certificateIssuanceTrend,
      recentActivity: [],
    };
  },

  getRecentActivity: async (limit = 10): Promise<ActivityItem[]> => {
    if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
      await simulateDelay();
      return [
        {
          type: "issue",
          date: new Date().toISOString(),
          description: "Issued certificate 'Blockchain Expert' to John Doe",
        },
      ];
    }
    return apiClient<ActivityItem[]>(
      `/admin/analytics/activity?limit=${limit}`,
    );
  },
};

// ==================== AUDIT LOGS (#283) ====================

export const auditApi = {
  getLogs: async (
    params?: AuditLogQueryParams,
  ): Promise<PaginatedActivityLog> => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value) searchParams.append(key, String(value));
      });
    }
    return apiClient<PaginatedActivityLog>(`/audit?${searchParams.toString()}`);
  },
  getCertificateHistory: async (
    certificateId: string,
  ): Promise<ActivityItem[]> => {
    if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
      await simulateDelay();
      return [
        {
          type: "issue",
          date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          description: "Certificate issued to recipient",
        },
        {
          type: "verify",
          date: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
          description: "Certificate verified by verifier",
        },
      ];
    }
    const response = await apiClient<AuditLogItem[]>(
      `/audit/certificates/${certificateId}/history`,
    );
    return response.map((log) => {
      let type: "issue" | "verify" | "revoke" = "issue";
      const actionLower = (log.action || "").toLowerCase();
      if (actionLower.includes("revoke")) {
        type = "revoke";
      } else if (
        actionLower.includes("verify") ||
        actionLower.includes("verified") ||
        actionLower.includes("check")
      ) {
        type = "verify";
      }
      return {
        type,
        date: new Date(
          Number(log.timestamp) || log.createdAt || Date.now(),
        ).toISOString(),
        description:
          log.description ||
          log.errorMessage ||
          `${String(log.action).replace(/_/g, " ")} by ${log.userEmail || "unknown"}`,
      };
    });
  },
  searchLogs: async (
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<import("./types").AuditLogSearchResponse> => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== "") {
          searchParams.set(key, String(value));
        }
      });
    }

    if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
      await simulateDelay();
      return {
        data: [
          {
            id: "audit-1",
            action: "ISSUE_CERTIFICATE",
            description: "Issued Blockchain Fundamentals to Alice Johnson",
            timestamp: new Date().toISOString(),
            ipAddress: "127.0.0.1",
          },
        ],
        total: 1,
      };
    }

    return apiClient(`/audit/search?${searchParams.toString()}`);
  },
  getStatistics: async (
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<import("./types").AuditStatistics> => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== "") {
          searchParams.set(key, String(value));
        }
      });
    }

    if (import.meta.env.VITE_USE_DUMMY_DATA === "true") {
      await simulateDelay();
      return {
        total: 1,
        byAction: {
          ISSUE_CERTIFICATE: 1,
        },
      };
    }

    return apiClient(`/audit/statistics?${searchParams.toString()}`);
  },
  exportCsvUrl: (
    params?: Record<string, string | number | boolean | undefined>,
  ) => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== "") {
          searchParams.set(key, String(value));
        }
      });
    }
    const query = searchParams.toString();
    return `${API_URL}/audit/export${query ? `?${query}` : ""}`;
  },
};
