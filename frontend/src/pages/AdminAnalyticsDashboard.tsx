import { useMemo, useState } from 'react';
import { Download, ShieldCheck, Users, FileText, Activity } from 'lucide-react';
import { auditApi, tokenStorage } from '../api';
import {
  useAdminAnalyticsQuery,
  useAuditSearchQuery,
  useAuditStatisticsQuery,
} from '../api/queries';
import type { AdminAnalytics, AuditLogItem, AuditStatistics } from '../api';
import { ApiError } from '../api/types';

type DateRange = {
  startDate: string;
  endDate: string;
};

const createInitialDateRange = (): DateRange => {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 29);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
};

type MetricCardProps = {
  label: string;
  value: number | string;
  icon: React.ReactNode;
};

const MetricCard = ({ label, value, icon }: MetricCardProps) => (
  <div className="bg-white dark:bg-slate-900 p-6 rounded-lg shadow-md dark:shadow-lg dark:border dark:border-slate-700 transition-colors duration-250">
    <div className="flex items-center justify-between">
      <p className="text-sm font-medium text-gray-500 dark:text-slate-400 transition-colors duration-250">
        {label}
      </p>
      <div className="text-gray-400 dark:text-slate-500">{icon}</div>
    </div>
    <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white transition-colors duration-250">
      {value}
    </p>
  </div>
);

async function downloadAuditCsv(params?: Record<string, string | number | boolean | undefined>) {
  const url = auditApi.exportCsvUrl(params);
  const token = tokenStorage.getAccessToken();

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token ?? ''}`,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({
      message: response.statusText || "Failed to export audit logs",
      statusCode: response.status,
    }));
    throw new ApiError(errorData.message, errorData.statusCode, errorData.error);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

export default function AdminAnalyticsDashboard() {
  // `dateRange` is the editor's draft; `appliedDateRange` is what the queries
  // are keyed on. Keeping them separate preserves the original behaviour where
  // nothing is fetched until Apply is pressed — keying the queries on the draft
  // would fire three requests per date edit.
  const [dateRange, setDateRange] = useState<DateRange>(createInitialDateRange);
  const [appliedDateRange, setAppliedDateRange] = useState<DateRange>(createInitialDateRange);
  const [filterDirty, setFilterDirty] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Three independent queries, each with its own cache entry, so re-opening
  // this dashboard (or returning to a range already seen) is instant.
  const analyticsQuery = useAdminAnalyticsQuery(appliedDateRange);
  const auditStatsQuery = useAuditStatisticsQuery(appliedDateRange);
  const recentAuditQuery = useAuditSearchQuery({ ...appliedDateRange, limit: 20 });

  const analytics: AdminAnalytics | null = analyticsQuery.data ?? null;
  const auditStats: AuditStatistics | null = auditStatsQuery.data ?? null;
  const recentAudit: AuditLogItem[] = recentAuditQuery.data?.data ?? [];

  const loading =
    analyticsQuery.isPending ||
    auditStatsQuery.isPending ||
    recentAuditQuery.isPending;

  const loadError = [analyticsQuery, auditStatsQuery, recentAuditQuery].find(
    (query) => query.isError,
  )?.error as { message?: string } | undefined;

  const error = exportError ?? (loadError ? (loadError.message ?? 'Failed to load admin analytics') : null);

  const handleDateChange = (field: keyof DateRange, value: string) => {
    setDateRange((prev) => ({ ...prev, [field]: value }));
    setFilterDirty(true);
  };

  // Apply promotes the draft to the applied range, which is what re-keys the
  // queries. Repeatedly applying the same range is a no-op.
  const handleApplyFilters = () => {
    setAppliedDateRange((prev) =>
      prev.startDate === dateRange.startDate && prev.endDate === dateRange.endDate
        ? prev
        : dateRange,
    );
    setFilterDirty(false);
  };

  const handleResetFilters = () => {
    const initial = createInitialDateRange();
    setDateRange(initial);
    setAppliedDateRange(initial);
    setFilterDirty(false);
  };

  const topIssuers = useMemo(() => analytics?.topIssuers ?? [], [analytics]);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white transition-colors duration-250">
            Admin Analytics Dashboard
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400 transition-colors duration-250">
            Platform-wide metrics, user stats, and audit log access.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={async () => {
              setExportError(null);
              try {
                await downloadAuditCsv(dateRange);
              } catch (e) {
                setExportError(e instanceof Error ? e.message : 'Failed to export audit logs');
              }
            }}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 shadow-sm hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors duration-250"
          >
            <Download className="h-4 w-4" />
            Export audit CSV
          </button>
        </div>
      </div>

      <div className="mb-6 grid gap-4 rounded-lg bg-white dark:bg-slate-900 p-4 shadow-sm dark:shadow-lg dark:border dark:border-slate-700 md:grid-cols-[2fr,3fr] transition-colors duration-250">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 transition-colors duration-250">
            Date range
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-col">
              <label
                htmlFor="adminStartDate"
                className="text-xs font-medium text-gray-500 dark:text-slate-400 transition-colors duration-250"
              >
                Start
              </label>
              <input
                id="adminStartDate"
                type="date"
                value={dateRange.startDate}
                onChange={(e) => handleDateChange('startDate', e.target.value)}
                className="mt-1 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-sm text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors duration-250"
              />
            </div>
            <div className="flex flex-col">
              <label
                htmlFor="adminEndDate"
                className="text-xs font-medium text-gray-500 dark:text-slate-400 transition-colors duration-250"
              >
                End
              </label>
              <input
                id="adminEndDate"
                type="date"
                value={dateRange.endDate}
                onChange={(e) => handleDateChange('endDate', e.target.value)}
                className="mt-1 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-sm text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors duration-250"
              />
            </div>
            <div className="mt-4 flex items-center gap-2 md:mt-6">
              <button
                type="button"
                onClick={handleApplyFilters}
                disabled={loading || !filterDirty || !dateRange.startDate || !dateRange.endDate}
                className="rounded-md bg-blue-600 dark:bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 dark:hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60 transition-colors duration-250"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={handleResetFilters}
                disabled={loading}
                className="rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 transition-colors duration-250"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-4 text-xs text-gray-500 dark:text-slate-400 transition-colors duration-250">
          {loading && <span>Loading admin analytics…</span>}
          {error && !loading && (
            <span className="text-red-500 dark:text-red-400 transition-colors duration-250">
              {error}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
        <MetricCard
          label="Total users"
          value={analytics?.usersByRole.total ?? 0}
          icon={<Users className="h-5 w-5" />}
        />
        <MetricCard
          label="Total issuers"
          value={analytics?.totalIssuers ?? 0}
          icon={<ShieldCheck className="h-5 w-5" />}
        />
        <MetricCard
          label="Total certificates"
          value={analytics?.certificatesByStatus.total ?? 0}
          icon={<FileText className="h-5 w-5" />}
        />
        <MetricCard
          label="Audit events (total)"
          value={auditStats?.total ?? 0}
          icon={<Activity className="h-5 w-5" />}
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[3fr,2fr]">
        <div className="rounded-lg bg-white dark:bg-slate-900 p-6 shadow-md dark:shadow-lg dark:border dark:border-slate-700 transition-colors duration-250">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white transition-colors duration-250">
            Top issuers
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400 transition-colors duration-250">
            Issuers ranked by certificates issued in this period.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
                <tr>
                  <th className="py-2 text-left">Issuer</th>
                  <th className="py-2 text-right">Certificates</th>
                  <th className="py-2 text-right">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {topIssuers.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-gray-500 dark:text-slate-400">
                      No issuer data available.
                    </td>
                  </tr>
                ) : (
                  topIssuers.map((issuer) => (
                    <tr key={issuer.issuerId}>
                      <td className="py-3 pr-4 text-gray-900 dark:text-white">{issuer.issuerName}</td>
                      <td className="py-3 text-right text-gray-700 dark:text-slate-300">
                        {issuer.certificateCount}
                      </td>
                      <td className="py-3 text-right text-gray-700 dark:text-slate-300">
                        {issuer.percentage}%
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg bg-white dark:bg-slate-900 p-6 shadow-md dark:shadow-lg dark:border dark:border-slate-700 transition-colors duration-250">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white transition-colors duration-250">
            Recent audit events
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400 transition-colors duration-250">
            Latest actions recorded in the audit log.
          </p>
          <div className="mt-4 space-y-3">
            {recentAudit.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-gray-500 dark:text-slate-400">
                No audit events found.
              </div>
            ) : (
              recentAudit.slice(0, 10).map((item) => (
                <div key={item.id} className="rounded-md border border-gray-100 dark:border-slate-800 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{item.action}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{item.description}</p>
                    </div>
                    <p className="text-[11px] text-gray-400 dark:text-slate-500">
                      {new Date(item.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

