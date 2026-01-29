import {
    AuthResponse,
    Certificate,
    CreateCertificateData,
    DashboardStats,
    PaginatedResponse,
    User,
    VerificationResult,
    CertificateTemplate,
    ApiError
} from './types';
import { tokenStorage } from './tokens';

const API_URL = (import.meta as any).env.VITE_API_URL || 'http://localhost:3000/api';

/**
 * Standardized API client for all requests
 */
async function apiClient<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const url = `${API_URL}${endpoint}`;

    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');

    const token = tokenStorage.getAccessToken();
    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }

    try {
        const response = await fetch(url, {
            ...options,
            headers,
        });

        if (!response.ok) {
            const errorData: ApiError = await response.json().catch(() => ({
                message: response.statusText || 'API request failed',
                statusCode: response.status,
            }));

            // Handle unauthorized globally
            if (response.status === 401) {
                tokenStorage.clearTokens();
                // Potential redirect to login could happen here if using a router
            }

            throw errorData;
        }

        // Check for empty response (no content)
        if (response.status === 204) {
            return {} as T;
        }

        return await response.json();
    } catch (error) {
        if ((error as ApiError).statusCode) {
            throw error;
        }

        // Generic network error
        const apiError: ApiError = {
            message: error instanceof Error ? error.message : 'An unexpected error occurred',
            statusCode: 0,
            error: 'Network Error',
        };
        throw apiError;
    }
}

/**
 * ==================== AUTHENTICATION ====================
 */

export const authApi = {
    login: async (credentials: any): Promise<AuthResponse> => {
        const response = await apiClient<AuthResponse>('/auth/login', {
            method: 'POST',
            body: JSON.stringify(credentials),
        });
        tokenStorage.setAccessToken(response.accessToken);
        tokenStorage.setRefreshToken(response.refreshToken);
        return response;
    },

    register: async (data: any): Promise<AuthResponse> => {
        const response = await apiClient<AuthResponse>('/auth/register', {
            method: 'POST',
            body: JSON.stringify(data),
        });
        tokenStorage.setAccessToken(response.accessToken);
        tokenStorage.setRefreshToken(response.refreshToken);
        return response;
    },

    logout: async (): Promise<void> => {
        try {
            await apiClient('/auth/logout', { method: 'POST' });
        } finally {
            tokenStorage.clearTokens();
        }
    },

    refreshToken: async (refreshToken: string): Promise<{ accessToken: string }> => {
        const response = await apiClient<{ accessToken: string }>('/auth/refresh-token', {
            method: 'POST',
            body: JSON.stringify({ refreshToken }),
        });
        tokenStorage.setAccessToken(response.accessToken);
        return response;
    },
};

/**
 * ==================== CERTIFICATE MANAGEMENT ====================
 */

export const certificateApi = {
    list: async (params?: any): Promise<PaginatedResponse<Certificate>> => {
        const searchParams = new URLSearchParams(params).toString();
        return apiClient<PaginatedResponse<Certificate>>(`/certificates?${searchParams}`);
    },

    getById: async (id: string): Promise<Certificate> => {
        return apiClient<Certificate>(`/certificates/${id}`);
    },

    create: async (data: CreateCertificateData): Promise<Certificate> => {
        return apiClient<Certificate>('/certificates', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    verify: async (serialNumber: string): Promise<VerificationResult> => {
        return apiClient<VerificationResult>(`/certificates/verify/${serialNumber}`);
    },

    revoke: async (id: string, reason: string): Promise<Certificate> => {
        return apiClient<Certificate>(`/certificates/${id}/revoke`, {
            method: 'PATCH',
            body: JSON.stringify({ reason }),
        });
    },

    getUserCertificates: async (userId: string): Promise<Certificate[]> => {
        return apiClient<Certificate[]>(`/certificates/user/${userId}`);
    },
};

/**
 * ==================== USER MANAGEMENT ====================
 */

export const userApi = {
    getProfile: async (): Promise<User> => {
        return apiClient<User>('/users/profile');
    },

    updateProfile: async (data: Partial<User>): Promise<User> => {
        return apiClient<User>('/users/profile', {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    listAll: async (params?: any): Promise<PaginatedResponse<User>> => {
        const searchParams = new URLSearchParams(params).toString();
        return apiClient<PaginatedResponse<User>>(`/users?${searchParams}`);
    },

    updateRole: async (userId: string, role: string): Promise<User> => {
        return apiClient<User>(`/users/${userId}/role`, {
            method: 'PATCH',
            body: JSON.stringify({ role }),
        });
    },

    getByEmail: async (email: string): Promise<User> => {
        return apiClient<User>(`/users/email/${email}`);
    },
};

/**
 * ==================== ANALYTICS & STATS ====================
 */

export const analyticsApi = {
    getDashboardSummary: async (): Promise<DashboardStats> => {
        return apiClient<DashboardStats>('/certificates/stats');
    },

    getVerificationStats: async (period: string = '30d'): Promise<any> => {
        return apiClient<any>(`/audit/statistics?period=${period}`);
    },
};

/**
 * ==================== TEMPLATE MANAGEMENT ====================
 */

export const templateApi = {
    list: async (): Promise<CertificateTemplate[]> => {
        return apiClient<CertificateTemplate[]>('/templates');
    },

    getById: async (id: string): Promise<CertificateTemplate> => {
        return apiClient<CertificateTemplate>(`/templates/${id}`);
    },

    getDefaultTemplate: async (): Promise<CertificateTemplate> => {
        return apiClient<CertificateTemplate>('/templates/default');
    },
};

/**
 * Standalone exports for backward compatibility and convenience
 */
export const login = authApi.login;
export const register = authApi.register;
export const logout = authApi.logout;
export const refreshToken = authApi.refreshToken;

export const createCertificate = certificateApi.create;
export const verifyCertificate = certificateApi.verify;
export const revokeCertificate = certificateApi.revoke;

export const fetchUserByEmail = userApi.getByEmail;
export const fetchDefaultTemplate = templateApi.getDefaultTemplate;
export const getUserCertificates = certificateApi.getUserCertificates;

export const totalCertificates = async () => {
    const stats = await analyticsApi.getDashboardSummary();
    return { total: stats.totalCertificates };
};

export const dailyCertificateVerification = async () => {
    const stats = await analyticsApi.getDashboardSummary();
    return { count: stats.verifications24h };
};

export const totalActiveUsers = async () => {
    const stats = await analyticsApi.getDashboardSummary();
    return { total: stats.totalUsers };
};
