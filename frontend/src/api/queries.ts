import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  ApproveTransferDto,
  CertificateTemplate,
  CreateCertificateData,
  InitiateTransferDto,
  Notification,
  NotificationPreferences,
  ProfileUpdateData,
  RejectTransferDto,
  User,
  VerifyEmailRequest,
} from "./types";
import {
  adminAnalyticsApi,
  analyticsApi,
  apiClient,
  auditApi,
  authApi,
  certificateApi,
  createCertificate,
  fetchDefaultTemplate,
  getUserCertificates,
  issuerProfileApi,
  revokeCertificate,
  templateApi,
  userApi,
} from "./endpoints";

/**
 * Central registry of cache keys.
 *
 * Keys are nested so a mutation can invalidate a whole family of queries with
 * a prefix match, e.g. `queryKeys.certificates.root` matches the admin list,
 * a user's wallet and any per-certificate lookup.
 */
export const queryKeys = {
  session: () => ["auth", "session"] as const,
  notifications: {
    root: ["notifications"] as const,
    list: () => ["notifications", "list"] as const,
    preferences: () => ["notifications", "preferences"] as const,
  },
  users: {
    root: ["users"] as const,
    list: (params: unknown) => ["users", "list", params] as const,
    profile: () => ["users", "profile"] as const,
  },
  certificates: {
    root: ["certificates"] as const,
    list: (params: unknown) => ["certificates", "list", params] as const,
    user: (userId: string) => ["certificates", "user", userId] as const,
    verification: (serialNumber: string) =>
      ["certificates", "verify", serialNumber] as const,
    history: (certificateId: string) =>
      ["certificates", "history", certificateId] as const,
  },
  templates: () => ["templates"] as const,
  analytics: {
    root: ["analytics"] as const,
    dashboardSummary: (params: unknown) =>
      ["analytics", "dashboard-summary", params] as const,
    admin: (params: unknown) => ["analytics", "admin", params] as const,
  },
  audit: {
    root: ["audit"] as const,
    statistics: (params: unknown) => ["audit", "statistics", params] as const,
    search: (params: unknown) => ["audit", "search", params] as const,
  },
  issuer: {
    root: ["issuer"] as const,
    stats: () => ["issuer", "stats"] as const,
    activity: (params: unknown) => ["issuer", "activity", params] as const,
  },
} as const;

export type CertificateListParams = {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  startDate?: string;
  endDate?: string;
};

export type DateRangeParams = { startDate?: string; endDate?: string };

// ── Session ────────────────────────────────────────────────────────────────

/**
 * Session bootstrap: rehydrates from the HttpOnly refresh cookie.
 *
 * `authApi.refresh` already coalesces concurrent callers and rate-limits, so the
 * query layer must not add retries, and the result never goes stale.
 */
export const useSessionQuery = (enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.session(),
    queryFn: () => authApi.refresh(),
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });

// ── Certificates ───────────────────────────────────────────────────────────

/**
 * Certificates held by one user. Shared by the recipient dashboard and the
 * wallet page, so moving between those routes costs at most one request.
 */
export const useUserCertificatesQuery = (userId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.certificates.user(userId ?? ""),
    queryFn: () => getUserCertificates(userId as string),
    enabled: !!userId,
  });

export const useCertificatesQuery = (params: CertificateListParams) =>
  useQuery({
    queryKey: queryKeys.certificates.list(params),
    queryFn: () => certificateApi.list(params),
    // Keep the previous page on screen while the next one loads, so paging
    // through results doesn't flash an empty table.
    placeholderData: keepPreviousData,
  });

export const useCertificateHistoryQuery = (certificateId: string | null) =>
  useQuery({
    queryKey: queryKeys.certificates.history(certificateId ?? ""),
    queryFn: () => auditApi.getCertificateHistory(certificateId as string),
    enabled: !!certificateId,
  });

/**
 * Verifies a serial number. Keyed by serial, so re-checking the same
 * certificate is answered from cache and in-flight lookups are de-duplicated.
 */
export const useVerifyCertificateQuery = (serialNumber: string) =>
  useQuery({
    queryKey: queryKeys.certificates.verification(serialNumber),
    queryFn: () => certificateApi.verify(serialNumber),
    enabled: serialNumber.trim().length > 2,
  });

// ── Templates ──────────────────────────────────────────────────────────────

export const useTemplatesQuery = () =>
  useQuery({
    queryKey: queryKeys.templates(),
    queryFn: async (): Promise<{
      templates: CertificateTemplate[];
      defaultTemplate: CertificateTemplate;
    }> => {
      const [templates, defaultTemplate] = await Promise.all([
        templateApi.list(),
        fetchDefaultTemplate(),
      ]);
      return { templates, defaultTemplate };
    },
  });

// ── Analytics & audit ──────────────────────────────────────────────────────

export const useDashboardSummaryQuery = (params: DateRangeParams) =>
  useQuery({
    queryKey: queryKeys.analytics.dashboardSummary(params),
    queryFn: () => analyticsApi.getDashboardSummary(params),
  });

export const useAdminAnalyticsQuery = (params: DateRangeParams) =>
  useQuery({
    queryKey: queryKeys.analytics.admin(params),
    queryFn: () => adminAnalyticsApi.getAnalytics(params),
  });

export const useAuditStatisticsQuery = (params: DateRangeParams) =>
  useQuery({
    queryKey: queryKeys.audit.statistics(params),
    queryFn: () => auditApi.getStatistics(params),
  });

export const useAuditSearchQuery = (
  params: DateRangeParams & { limit?: number },
) =>
  useQuery({
    queryKey: queryKeys.audit.search(params),
    queryFn: () => auditApi.searchLogs(params),
  });

// ── Users ──────────────────────────────────────────────────────────────────

// The authenticated user lives under the session key, which AuthProvider seeds
// from the login/refresh response. Sharing the key means a mounted
// `useUserProfileQuery` renders the already-cached user instead of re-fetching.
export const useUserProfileQuery = () =>
  useQuery({
    queryKey: queryKeys.session(),
    queryFn: () => userApi.getProfile(),
  });

export const useUserListQuery = (params: Record<string, string | number | boolean>) =>
  useQuery({
    queryKey: queryKeys.users.list(params),
    queryFn: async (): Promise<User[]> => {
      const data = await userApi.getAll(params);
      if (Array.isArray(data)) return data;
      if ("users" in data && Array.isArray(data.users)) return data.users;
      return data.data;
    },
  });

export const useIssuerStatsQuery = () =>
  useQuery({
    queryKey: queryKeys.issuer.stats(),
    queryFn: () => issuerProfileApi.getStats(),
  });

export const useIssuerActivityQuery = (page = 1, limit = 10) =>
  useQuery({
    queryKey: queryKeys.issuer.activity({ page, limit }),
    queryFn: () => issuerProfileApi.getActivity(page, limit),
  });

// ── Notifications ──────────────────────────────────────────────────────────

export const useNotificationsQuery = (enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.notifications.list(),
    queryFn: () => apiClient<Notification[]>("/notifications"),
    enabled,
  });

export const useNotificationPreferencesQuery = () =>
  useQuery({
    queryKey: queryKeys.notifications.preferences(),
    queryFn: () => apiClient<NotificationPreferences>("/notifications/preferences"),
  });

// ── Invalidation helpers ───────────────────────────────────────────────────

/**
 * Anything derived from a certificate - lists, wallets, dashboards, audit
 * trails - is stale once a certificate is created, revoked or re-statused.
 */
export const useInvalidateCertificates = () => {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.certificates.root }),
      queryClient.invalidateQueries({ queryKey: queryKeys.analytics.root }),
      queryClient.invalidateQueries({ queryKey: queryKeys.audit.root }),
    ]);
  };
};

export const useInvalidateUsers = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.users.root });
};

// ── Mutations ──────────────────────────────────────────────────────────────

// Mutation functions are wrapped rather than referenced directly: `useMutation`
// calls `mutationFn(variables, context)`, and a bare reference would hand the
// QueryClient context to a fetcher that has no business knowing about it.
export const useCreateCertificateMutation = () => {
  const invalidateCertificates = useInvalidateCertificates();
  return useMutation({
    mutationFn: (data: CreateCertificateData) => createCertificate(data),
    onSuccess: invalidateCertificates,
  });
};

export const useRevokeCertificateMutation = () => {
  const invalidateCertificates = useInvalidateCertificates();
  return useMutation({
    mutationFn: ({
      id,
      reason,
    }: {
      id: string;
      reason: string;
    }) => revokeCertificate(id, reason),
    onSuccess: invalidateCertificates,
  });
};

export const useBulkRevokeCertificatesMutation = () => {
  const invalidateCertificates = useInvalidateCertificates();
  return useMutation({
    mutationFn: ({
      certificateIds,
      reason,
    }: {
      certificateIds: string[];
      reason?: string;
    }) => certificateApi.bulkRevoke(certificateIds, reason),
    onSuccess: invalidateCertificates,
  });
};

export const useFreezeCertificateMutation = () => {
  const invalidateCertificates = useInvalidateCertificates();
  return useMutation({
    mutationFn: ({
      certificateId,
      reason,
      durationDays,
    }: {
      certificateId: string;
      reason: string;
      durationDays: number;
    }) => certificateApi.freeze(certificateId, reason, durationDays),
    onSuccess: invalidateCertificates,
  });
};

export const useUnfreezeCertificateMutation = () => {
  const invalidateCertificates = useInvalidateCertificates();
  return useMutation({
    mutationFn: (certificateId: string) => certificateApi.unfreeze(certificateId),
    onSuccess: invalidateCertificates,
  });
};

export const useInitiateTransferMutation = () => {
  const invalidateCertificates = useInvalidateCertificates();
  return useMutation({
    mutationFn: (data: InitiateTransferDto) =>
      certificateApi.transfer.initiate(data),
    onSuccess: invalidateCertificates,
  });
};

export const useApproveTransferMutation = () => {
  const invalidateCertificates = useInvalidateCertificates();
  return useMutation({
    mutationFn: (data: ApproveTransferDto) => certificateApi.transfer.approve(data),
    onSuccess: invalidateCertificates,
  });
};

export const useRejectTransferMutation = () => {
  const invalidateCertificates = useInvalidateCertificates();
  return useMutation({
    mutationFn: (data: RejectTransferDto) => certificateApi.transfer.reject(data),
    onSuccess: invalidateCertificates,
  });
};

export const useUpdateIssuerProfileMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profile: ProfileUpdateData) =>
      issuerProfileApi.updateProfile(profile),
    onSuccess: async (profile) => {
      // The profile form and the header both render the authenticated user.
      queryClient.setQueryData(queryKeys.users.profile(), profile);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.users.root }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issuer.root }),
      ]);
    },
  });
};

export const useSaveNotificationPreferencesMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (preferences: NotificationPreferences) =>
      apiClient<NotificationPreferences>("/notifications/preferences", {
        method: "PATCH",
        body: JSON.stringify(preferences),
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.notifications.preferences(), saved);
    },
  });
};

export const useMarkNotificationReadMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient(`/notifications/${id}/read`, { method: "PATCH" }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notifications.list() });
      const previous = queryClient.getQueryData<Notification[]>(
        queryKeys.notifications.list(),
      );
      queryClient.setQueryData<Notification[]>(
        queryKeys.notifications.list(),
        (current) =>
          current?.map((n) => (n.id === id ? { ...n, isRead: true } : n)) ?? current,
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      queryClient.setQueryData(queryKeys.notifications.list(), context?.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list() });
    },
  });
};

export const useMarkAllNotificationsReadMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient("/notifications/read-all", { method: "PATCH" }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notifications.list() });
      const previous = queryClient.getQueryData<Notification[]>(
        queryKeys.notifications.list(),
      );
      queryClient.setQueryData<Notification[]>(
        queryKeys.notifications.list(),
        (current) => current?.map((n) => ({ ...n, isRead: true })) ?? current,
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(queryKeys.notifications.list(), context?.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list() });
    },
  });
};

/**
 * Explicit, user-triggered verification (the verifier dashboard's button).
 * The debounced auto-verify on the verify page uses the query above instead.
 */
export const useVerifyCertificateMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (serialNumber: string) => certificateApi.verify(serialNumber),
    onSuccess: (result, serialNumber) => {
      // Seed the cache so a later lookup of the same serial renders from cache
      // instead of re-verifying against the API.
      queryClient.setQueryData(
        queryKeys.certificates.verification(serialNumber),
        result,
      );
    },
  });
};

export const useVerifyEmailMutation = () =>
  useMutation({
    mutationFn: (data: VerifyEmailRequest) => authApi.verifyEmail(data),
    // Retrying a one-shot email confirmation would re-submit the token.
    retry: false,
  });
