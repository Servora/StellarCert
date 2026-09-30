/**
 * User roles in the system
 */
export enum UserRole {
  ADMIN = "admin",
  ISSUER = "issuer",
  RECIPIENT = "recipient",
  VERIFIER = "verifier",
  AUDITOR = "auditor",
  USER = "user",
}

/**
 * Basic User profile information
 */
export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  isEmailVerified?: boolean;
  stellarPublicKey?: string;
  organization?: string;
  username?: string;
  phone?: string;
  metadata?: Record<string, unknown>;
  profilePicture?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Authentication Response from login/register
 */
export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  requiresEmailVerification?: boolean;
}

/**
 * Certificate data model
 */
export interface Certificate {
  id: string;
  serialNumber: string;
  recipientName: string;
  recipientEmail: string;
  title: string;
  courseName: string;
  issuerName: string;
  issueDate: string;
  expiryDate?: string;
  status: "active" | "revoked" | "expired" | "frozen";
  pdfUrl?: string; // Link to certificate file
  txHash?: string; // Stellar transaction hash
  cid?: string; // IPFS CID for certificate file/metadata
  metadata?: Record<string, unknown>;
  frozenAt?: string;
  freezeReason?: string;
  unfreezeAt?: string;
}

/**
 * Certificate Transfer model (#286)
 */
export interface CertificateTransfer {
  id: string;
  certificateId: string;
  fromUserId: string;
  toEmail: string;
  toUserId?: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  initiationReason?: string;
  rejectionReason?: string;
  confirmationCode?: string;
  createdAt: string;
  updatedAt: string;
  certificate?: Certificate;
}

export interface InitiateTransferDto {
  certificateId: string;
  newOwnerEmail: string;
  newOwnerName: string;
  reason?: string;
}

export interface ApproveTransferDto {
  transferId: string;
  confirmationCode?: string;
}

export interface RejectTransferDto {
  transferId: string;
  reason?: string;
}

/**
 * Request payload for creating a certificate
 */
export interface CreateCertificateData {
  title: string;
  description: string;
  recipientName: string;
  recipientEmail: string;
  courseName: string;
  issuerName: string;
  issueDate: string;
  issuerId: string;
  recipientId?: string;
  expiryDate?: string;
  templateId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Verification result details
 */
export interface VerificationResult {
  isValid: boolean;
  status?: "valid" | "revoked" | "expired" | "not_found";
  certificate?: Certificate;
  verificationDate?: string;
  verifiedAt?: string;
  stellarProof?: {
    txHash: string;
    ledger: number;
    timestamp: string;
  };
  message?: string;
  verificationId?: string;
}

/**
 * Certificate Template model
 */
export interface CertificateTemplate {
  id: string;
  name: string;
  description?: string;
  layoutUrl: string;
  fields: string[];
  issuerId: string;
}

export interface IssuanceTrendPoint {
  date: string;
  count: number;
}

export interface StatusDistribution {
  active: number;
  revoked: number;
  expired: number;
}

export type ActivityType = "issue" | "verify" | "revoke";

export interface ActivityItem {
  type: ActivityType;
  date: string;
  description: string;
}

/**
 * Dashboard / Analytics Summary
 */
export interface DashboardStats {
  totalCertificates: number;
  activeCertificates: number;
  revokedCertificates: number;
  expiredCertificates?: number;
  totalVerifications: number;
  verifications24h: number;
  totalUsers: number;
  issuanceTrend?: IssuanceTrendPoint[];
  statusDistribution?: StatusDistribution;
  recentActivity: ActivityItem[];
}

export interface UsersByRoleStats {
  users: number;
  issuers: number;
  admins: number;
  total: number;
}

export interface UsersByStatusStats {
  active: number;
  inactive: number;
  suspended: number;
  pendingVerification: number;
}

export interface CertificatesByStatusStats {
  active: number;
  revoked: number;
  expired: number;
  total: number;
}

export interface TopIssuerAnalytics {
  issuerId: string;
  issuerName: string;
  certificateCount: number;
  percentage: number;
}

export interface VerificationTrends {
  total: number;
  successful: number;
  failed: number;
  successRate: number;
  last24Hours: number;
  last7Days: number;
  last30Days: number;
}

export interface TrendPoint {
  date: string;
  count: number;
}

export interface AdminAnalytics {
  usersByRole: UsersByRoleStats;
  usersByStatus: UsersByStatusStats;
  certificatesByStatus: CertificatesByStatusStats;
  topIssuers: TopIssuerAnalytics[];
  verificationTrends: VerificationTrends;
  userRegistrationTrend: TrendPoint[];
  certificateIssuanceTrend: TrendPoint[];
  totalIssuers: number;
}

export interface AuditLogItem {
  id: string;
  action: string;
  description: string;
  userId?: string;
  resourceId?: string;
  resourceType?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
  createdAt?: string;
  errorMessage?: string;
  userEmail?: string;
}

export interface AuditLogSearchResponse {
  data: AuditLogItem[];
  total: number;
}

export interface AuditStatistics {
  total: number;
  byAction?: Record<string, number>;
  byUser?: Record<string, number>;
  byResourceType?: Record<string, number>;
}

/**
 * Standard API error response
 */
export interface ApiErrorResponse {
  message: string;
  statusCode: number;
  error?: string;
  details?: unknown;
}

export type ApiErrorData = ApiErrorResponse;

/**
 * API Error class that extends Error for proper instanceof checks
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly error?: string;
  public readonly details?: unknown;

  constructor(message: string, statusCode: number, error?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.error = error;
    this.details = details;

    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }
}

/**
 * Helper to extract error message from unknown error
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return 'An unexpected error occurred';
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CertificateExportFilters {
  search?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}

export interface LoginCredentials {
  email: string;
  password?: string;
  [key: string]: unknown;
}

export interface RegisterData {
  email: string;
  password?: string;
  firstName: string;
  lastName: string;
  [key: string]: unknown;
}

export interface ProfileUpdateData {
  firstName?: string;
  lastName?: string;
  username?: string;
  phone?: string;
  organization?: string;
  profilePicture?: string;
  stellarPublicKey?: string;
  [key: string]: unknown;
}

// Password reset/request types
export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
  confirmPassword: string;
}

export interface VerifyEmailRequest {
  token: string;
}

export interface DailyVerificationStats {
  count: number;
}

export interface TotalCertificatesStats {
  total: number;
}

export interface TotalActiveUsersStats {
  total: number;
}

export interface IssuerStats {
  totalCertificates: number;
  activeCertificates: number;
  revokedCertificates: number;
  expiredCertificates: number;
  totalVerifications: number;
  lastLogin: string;
}

export interface ActivityLogItem {
  id: string;
  action: string;
  description: string;
  ipAddress?: string;
  userAgent?: string;
  timestamp: string;
}

export interface PaginatedActivityLog {
  activities: ActivityLogItem[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export type NotificationType = "info" | "success" | "error";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationPreferences {
  inAppEnabled: boolean;
  infoEnabled: boolean;
  successEnabled: boolean;
  errorEnabled: boolean;
}
