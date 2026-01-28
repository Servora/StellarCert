const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export interface Certificate {
  id: string;
  certificateId: string;
  recipientName: string;
  courseName: string;
  issuerName: string;
  issueDate: string;
  status: 'active' | 'revoked' | 'expired';
  description?: string;
  expiresAt?: string;
  isRevoked?: boolean;
}

export interface VerificationResponse {
  success: boolean;
  certificate?: Certificate;
  message?: string;
}

export async function verifyCertificate(
  serial: string
): Promise<VerificationResponse> {
  try {
    const response = await fetch(`${API_URL}/certificates/verify/${serial}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        message: response.statusText || 'Verification failed',
      }));

      if (response.status === 404) {
        return {
          success: false,
          message: 'Certificate not found. Please check the serial number and try again.',
        };
      }

      return {
        success: false,
        message: errorData.message || 'Failed to verify certificate. Please try again.',
      };
    }

    const data = await response.json();
    return {
      success: true,
      certificate: data,
    };
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return {
        success: false,
        message: 'Network error. Please check your connection and try again.',
      };
    }

    return {
      success: false,
      message: 'An unexpected error occurred. Please try again.',
    };
  }
}
