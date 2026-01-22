export interface IRequestContext {
  userId?: string;
  userEmail?: string;
  ipAddress: string;
  userAgent?: string;
  correlationId?: string;
  timestamp: number;
}
