import { useState } from 'react';
import { Download } from 'lucide-react';
import { auditApi, tokenStorage } from '../api';
import { useAuditSearchQuery } from '../api/queries';
import type { AuditLogItem } from '../api';
import { ApiError } from '../api/types';

type AuditFilters = {
  userId: string;
  userEmail: string;
  action: string;
  resourceType: string;
  resourceId: string;
  startDate: string;
  endDate: string;
};

const emptyFilters: AuditFilters = {
  userId: '',
  userEmail: '',
  action: '',
  resourceType: '',
  resourceId: '',
  startDate: '',
  endDate: '',
};

const actions = [
  'USER_LOGIN',
  'USER_LOGOUT',
  'USER_REGISTER',
  'USER_PROFILE_UPDATE',
  'USER_PASSWORD_CHANGE',
  'USER_EMAIL_VERIFY',
  'CERTIFICATE_ISSUE',
  'CERTIFICATE_VERIFY',
  'CERTIFICATE_REVOKE',
  'CERTIFICATE_UPDATE',
  'CERTIFICATE_EXPIRE',
  'CERTIFICATE_FREEZE',
  'CERTIFICATE_UNFREEZE',
  'CERTIFICATE_TRANSFER',
  'ISSUER_AUTHORIZE',
  'ISSUER_DEAUTHORIZE',
  'ISSUER_PROFILE_UPDATE',
  'USER_ROLE_CHANGE',
  'USER_DEACTIVATE',
  'SYSTEM_CONFIG_UPDATE',
  'LOGIN_FAILED',
  'UNAUTHORIZED_ACCESS',
  'RATE_LIMIT_EXCEEDED',
  'BACKGROUND_JOB_START',
  'BACKGROUND_JOB_COMPLETE',
  'BACKGROUND_JOB_FAILED',
  'SYSTEM_ERROR',
];

const resourceTypes = ['USER', 'CERTIFICATE', 'ISSUER', 'SYSTEM', 'AUTH'];
const pageSize = 25;

function formatTimestamp(timestamp: string) {
  const parsed = /^\d+$/.test(timestamp)
    ? new Date(Number(timestamp))
    : new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? timestamp : parsed.toLocaleString();
}

async function downloadAuditCsv(filters: AuditFilters) {
  const url = auditApi.exportCsvUrl(filters);
  const token = tokenStorage.getAccessToken();
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token ?? ''}` },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      message: response.statusText || 'Failed to export audit logs',
      statusCode: response.status,
    }));
    throw new ApiError(error.message, error.statusCode, error.error);
  }

  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

export default function AdminAuditLogs() {
  const [filters, setFilters] = useState<AuditFilters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<AuditFilters>(emptyFilters);
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const cursor = cursorHistory[cursorHistory.length - 1];
  const query = useAuditSearchQuery({
    ...appliedFilters,
    cursor,
    take: pageSize,
  });
  const logs: AuditLogItem[] = query.data?.data ?? [];
  const hasInvalidDateRange =
    !!filters.startDate &&
    !!filters.endDate &&
    filters.startDate > filters.endDate;

  const updateFilter = (field: keyof AuditFilters, value: string) => {
    setFilters((current) => ({ ...current, [field]: value }));
  };

  const applyFilters = () => {
    setAppliedFilters(filters);
    setCursorHistory([undefined]);
  };

  const resetFilters = () => {
    setFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setCursorHistory([undefined]);
  };

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadAuditCsv(appliedFilters);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : 'Failed to export audit logs',
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Audit log
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            Search and review recorded platform activity.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <Download className="h-4 w-4" />
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      <section
        aria-label="Audit log filters"
        className="mb-6 rounded-lg bg-white p-4 shadow-sm dark:border dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm font-medium text-gray-700 dark:text-slate-300">
            User email
            <input
              type="search"
              value={filters.userEmail}
              onChange={(event) => updateFilter('userEmail', event.target.value)}
              placeholder="Search email"
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
          </label>
          <label className="text-sm font-medium text-gray-700 dark:text-slate-300">
            User ID
            <input
              type="search"
              value={filters.userId}
              onChange={(event) => updateFilter('userId', event.target.value)}
              placeholder="User UUID"
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
          </label>
          <label className="text-sm font-medium text-gray-700 dark:text-slate-300">
            Action
            <select
              value={filters.action}
              onChange={(event) => updateFilter('action', event.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            >
              <option value="">All actions</option>
              {actions.map((action) => (
                <option key={action} value={action}>
                  {action.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700 dark:text-slate-300">
            Resource type
            <select
              value={filters.resourceType}
              onChange={(event) =>
                updateFilter('resourceType', event.target.value)
              }
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            >
              <option value="">All resource types</option>
              {resourceTypes.map((resourceType) => (
                <option key={resourceType} value={resourceType}>
                  {resourceType}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700 dark:text-slate-300">
            Resource ID
            <input
              type="search"
              value={filters.resourceId}
              onChange={(event) => updateFilter('resourceId', event.target.value)}
              placeholder="Search resource ID"
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
          </label>
          <label className="text-sm font-medium text-gray-700 dark:text-slate-300">
            Start date
            <input
              type="date"
              value={filters.startDate}
              onChange={(event) => updateFilter('startDate', event.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
          </label>
          <label className="text-sm font-medium text-gray-700 dark:text-slate-300">
            End date
            <input
              type="date"
              value={filters.endDate}
              onChange={(event) => updateFilter('endDate', event.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={applyFilters}
            disabled={query.isFetching || hasInvalidDateRange}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-700 dark:hover:bg-blue-600"
          >
            Apply filters
          </button>
          <button
            type="button"
            onClick={resetFilters}
            disabled={query.isFetching}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Reset
          </button>
          {hasInvalidDateRange && (
            <span role="alert" className="text-sm text-red-600 dark:text-red-400">
              Start date must be on or before the end date.
            </span>
          )}
        </div>
      </section>

      {(query.isError || exportError) && (
        <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">
          {exportError ??
            (query.error instanceof Error
              ? query.error.message
              : 'Failed to load audit logs')}
        </p>
      )}

      <section
        aria-label="Audit log results"
        className="overflow-hidden rounded-lg bg-white shadow-sm dark:border dark:border-slate-700 dark:bg-slate-900"
      >
        {query.isPending ? (
          <p className="p-8 text-center text-sm text-gray-500 dark:text-slate-400">
            Loading audit logs…
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-left text-sm dark:divide-slate-700">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    <th scope="col" className="px-4 py-3">Date</th>
                    <th scope="col" className="px-4 py-3">User</th>
                    <th scope="col" className="px-4 py-3">Action</th>
                    <th scope="col" className="px-4 py-3">Resource</th>
                    <th scope="col" className="px-4 py-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {logs.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-10 text-center text-gray-500 dark:text-slate-400"
                      >
                        No audit events found.
                      </td>
                    </tr>
                  ) : (
                    logs.map((log) => (
                      <tr key={log.id}>
                        <td className="whitespace-nowrap px-4 py-3 text-gray-600 dark:text-slate-300">
                          {formatTimestamp(log.timestamp)}
                        </td>
                        <td className="px-4 py-3 text-gray-900 dark:text-white">
                          {log.userEmail || log.userId || 'System'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900 dark:text-white">
                          {log.action.replace(/_/g, ' ')}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
                          {log.resourceType || '—'}
                          {log.resourceId && (
                            <span className="block break-all text-xs text-gray-500 dark:text-slate-400">
                              {log.resourceId}
                            </span>
                          )}
                        </td>
                        <td className="max-w-sm px-4 py-3 text-gray-600 dark:text-slate-300">
                          {log.description || log.errorMessage || '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-slate-700">
              <p className="text-sm text-gray-500 dark:text-slate-400">
                {query.data?.total ?? 0} matching events
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setCursorHistory((history) => history.slice(0, -1))
                  }
                  disabled={cursorHistory.length <= 1 || query.isFetching}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const nextCursor = query.data?.nextCursor;
                    if (nextCursor) {
                      setCursorHistory((history) => [...history, nextCursor]);
                    }
                  }}
                  disabled={!query.data?.nextCursor || query.isFetching}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
