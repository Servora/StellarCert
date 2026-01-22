export interface IAuditStatistics {
  totalEvents: number;
  eventsByAction: Record<string, number>;
  eventsByResourceType: Record<string, number>;
  eventsByStatus: Record<string, number>;
  eventsPerDay: Record<string, number>;
  topUsers: Array<{ userId: string; userEmail: string; eventCount: number }>;
  topResources: Array<{ resourceId: string; resourceType: string; eventCount: number }>;
}
