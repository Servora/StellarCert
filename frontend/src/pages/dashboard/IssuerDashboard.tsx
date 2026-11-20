import { Link } from "react-router-dom";
import { Award, Download, Search, ShieldAlert, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { useDashboardSummaryQuery } from "../../api/queries";
import type { StatusDistribution } from "../../api";
import {
  ActivityFeed,
  IssuanceChart,
  MetricCard,
  StatusPieChart,
  createInitialDateRange,
  type DateRange,
} from "./shared";

const IssuerDashboard = () => {
  // `dateRange` is the editor's draft; `appliedDateRange` is what the query is
  // keyed on. Keeping them separate preserves the original behaviour where
  // nothing is fetched until Apply is pressed — keying the query on the draft
  // would fire a request per date edit.
  const [dateRange, setDateRange] = useState<DateRange>(createInitialDateRange);
  const [appliedDateRange, setAppliedDateRange] = useState<DateRange>(
    createInitialDateRange,
  );
  const [filterDirty, setFilterDirty] = useState(false);

  const {
    data: stats = null,
    isPending,
    isFetching,
    isError,
    error: loadError,
  } = useDashboardSummaryQuery(appliedDateRange);

  const loading = isPending || isFetching;
  const error = isError
    ? ((loadError as { message?: string } | null)?.message ??
      "Failed to load analytics")
    : null;
  const revokedCount = stats?.revokedCertificates ?? 0;

  const statusDistribution: StatusDistribution = useMemo(() => {
    if (stats?.statusDistribution) {
      return stats.statusDistribution;
    }

    return {
      active: stats?.activeCertificates ?? 0,
      revoked: stats?.revokedCertificates ?? 0,
      expired: stats?.expiredCertificates ?? 0,
    };
  }, [stats]);

  const handleDateChange = (field: keyof DateRange, value: string) => {
    setDateRange((prev) => ({
      ...prev,
      [field]: value,
    }));
    setFilterDirty(true);
  };

  // Apply promotes the draft to the applied range, which is what re-keys the
  // query. The fetch, loading flag and error state all come from the query layer.
  const handleApplyFilters = () => {
    setAppliedDateRange((prev) =>
      prev.startDate === dateRange.startDate &&
      prev.endDate === dateRange.endDate
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

  const handleExportCsv = () => {
    if (!stats) return;

    const rows: string[][] = [];

    rows.push(["Metric", "Value"]);
    rows.push(["Total Certificates", String(stats.totalCertificates)]);
    rows.push(["Active Certificates", String(statusDistribution.active)]);
    rows.push(["Revoked Certificates", String(statusDistribution.revoked)]);
    rows.push(["Expired Certificates", String(statusDistribution.expired)]);
    rows.push(["Total Verifications", String(stats.totalVerifications)]);
    rows.push(["Verifications (24h)", String(stats.verifications24h)]);
    rows.push([]);

    rows.push(["Issuance Date", "Certificates Issued"]);
    (stats.issuanceTrend ?? []).forEach((point) => {
      rows.push([point.date, String(point.count)]);
    });
    rows.push([]);

    rows.push(["Status", "Count"]);
    rows.push(["Active", String(statusDistribution.active)]);
    rows.push(["Revoked", String(statusDistribution.revoked)]);
    rows.push(["Expired", String(statusDistribution.expired)]);

    const csvContent = rows
      .map((row) =>
        row
          .map((field) => {
            const value = String(field).replace(/"/g, '""');
            return `"${value}"`;
          })
          .join(","),
      )
      .join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "issuer-analytics.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white transition-colors duration-250">
            Issuer Analytics Dashboard
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400 transition-colors duration-250">
            Track certificate issuance trends, status distribution, and recent
            issuer activity.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!stats}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 shadow-sm hover:bg-gray-50 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 transition-colors duration-250"
          >
            <Download className="h-4 w-4" />
            Export CSV
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
                htmlFor="startDate"
                className="text-xs font-medium text-gray-500 dark:text-slate-400 transition-colors duration-250"
              >
                Start
              </label>
              <input
                id="startDate"
                type="date"
                value={dateRange.startDate}
                onChange={(e) => handleDateChange("startDate", e.target.value)}
                className="mt-1 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-sm text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors duration-250"
              />
            </div>
            <div className="flex flex-col">
              <label
                htmlFor="endDate"
                className="text-xs font-medium text-gray-500 dark:text-slate-400 transition-colors duration-250"
              >
                End
              </label>
              <input
                id="endDate"
                type="date"
                value={dateRange.endDate}
                onChange={(e) => handleDateChange("endDate", e.target.value)}
                className="mt-1 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-sm text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors duration-250"
              />
            </div>
            <div className="mt-4 flex items-center gap-2 md:mt-6">
              <button
                type="button"
                onClick={handleApplyFilters}
                disabled={
                  loading ||
                  !dateRange.startDate ||
                  !dateRange.endDate ||
                  !filterDirty
                }
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
          {loading && <span>Loading analytics…</span>}
          {error && !loading && (
            <span className="text-red-500 dark:text-red-400 transition-colors duration-250">
              {error}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
        <MetricCard
          label="Total Certificates"
          value={stats?.totalCertificates ?? 0}
          accentClassName="text-blue-600"
        />
        <MetricCard
          label="Active Certificates"
          value={statusDistribution.active}
          accentClassName="text-emerald-600"
        />
        <MetricCard
          label="Revoked Certificates"
          value={statusDistribution.revoked}
          accentClassName="text-red-600"
        />
        <MetricCard
          label="Verifications (24h)"
          value={stats?.verifications24h ?? 0}
          accentClassName="text-purple-600"
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-lg bg-white dark:bg-slate-900 p-6 shadow-md dark:shadow-lg dark:border dark:border-slate-700 transition-colors duration-250">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white transition-colors duration-250">
            Issuance over time
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400 transition-colors duration-250">
            Daily certificate issuance for the selected date range.
          </p>
          <div className="mt-4">
            <IssuanceChart data={stats?.issuanceTrend ?? []} />
          </div>
        </div>
        <div className="rounded-lg bg-white dark:bg-slate-900 p-6 shadow-md dark:shadow-lg dark:border dark:border-slate-700 transition-colors duration-250">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white transition-colors duration-250">
            Status distribution
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400 transition-colors duration-250">
            Breakdown of certificates by current status.
          </p>
          <div className="mt-4">
            <StatusPieChart distribution={statusDistribution} />
          </div>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[3fr,2fr]">
        <div className="rounded-lg bg-white dark:bg-slate-900 p-6 shadow-md dark:shadow-lg dark:border dark:border-slate-700 transition-colors duration-250">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white transition-colors duration-250">
            Recent activity
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400 transition-colors duration-250">
            Latest certificate issuance and revocation events.
          </p>
          <div className="mt-4">
            <ActivityFeed items={stats?.recentActivity ?? []} />
          </div>
        </div>
        <div className="rounded-lg bg-white dark:bg-slate-900 p-6 shadow-md dark:shadow-lg dark:border dark:border-slate-700 transition-colors duration-250">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white transition-colors duration-250">
            Quick actions
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400 transition-colors duration-250">
            Common issuer workflows you can access from here.
          </p>
          <div className="mt-4 space-y-3">
            <Link
              to="/issue"
              className="flex items-center justify-between rounded-md border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-4 py-3 text-sm font-medium text-gray-800 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors duration-250"
            >
              <span>Issue new certificate</span>
              <Award className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </Link>
            <Link
              to="/verify"
              className="flex items-center justify-between rounded-md border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-4 py-3 text-sm font-medium text-gray-800 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors duration-250"
            >
              <span>Verify existing certificate</span>
              <Search className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </Link>
            <Link
              to="/wallet"
              className="flex items-center justify-between rounded-md border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-4 py-3 text-sm font-medium text-gray-800 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors duration-250"
            >
              <span>Open certificate wallet</span>
              <Wallet className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-6">
        <Link
          to="/issue"
          className="bg-white dark:bg-slate-900 p-6 rounded-lg shadow-md dark:shadow-lg dark:border dark:border-slate-700 hover:shadow-lg dark:hover:shadow-xl transition-all duration-250"
        >
          <Award className="w-12 h-12 text-blue-600 dark:text-blue-400 mb-4 transition-colors duration-250" />
          <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white transition-colors duration-250">
            Issue Certificate
          </h3>
          <p className="text-sm text-gray-600 dark:text-slate-400 transition-colors duration-250">
            Create and issue new digital certificates
          </p>
        </Link>

        <Link
          to="/verify"
          className="bg-white dark:bg-slate-900 p-6 rounded-lg shadow-md dark:shadow-lg dark:border dark:border-slate-700 hover:shadow-lg dark:hover:shadow-xl transition-all duration-250"
        >
          <Search className="w-12 h-12 text-green-600 dark:text-green-400 mb-4 transition-colors duration-250" />
          <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white transition-colors duration-250">
            Verify Certificate
          </h3>
          <p className="text-sm text-gray-600 dark:text-slate-400 transition-colors duration-250">
            Verify the authenticity of certificates
          </p>
        </Link>

        <Link
          to="/wallet"
          className="bg-white dark:bg-slate-900 p-6 rounded-lg shadow-md dark:shadow-lg dark:border dark:border-slate-700 hover:shadow-lg dark:hover:shadow-xl transition-all duration-250"
        >
          <Wallet className="w-12 h-12 text-purple-600 dark:text-purple-400 mb-4 transition-colors duration-250" />
          <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white transition-colors duration-250">
            Certificate Wallet
          </h3>
          <p className="text-sm text-gray-600 dark:text-slate-400 transition-colors duration-250">
            View and manage your certificates
          </p>
        </Link>

        <Link
          to="/revoke"
          className="bg-white dark:bg-slate-900 p-6 rounded-lg shadow-md dark:shadow-lg border border-red-200 dark:border-red-900/50 hover:shadow-lg dark:hover:shadow-xl transition-all duration-250"
        >
          <ShieldAlert className="w-12 h-12 text-red-600 dark:text-red-400 mb-4 transition-colors duration-250" />
          <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white transition-colors duration-250">
            Revoke Certificate
          </h3>
          <p className="text-sm text-gray-600 dark:text-slate-400 transition-colors duration-250">
            Manage certificate revocation list
          </p>
          <div className="mt-2 text-sm text-red-600 dark:text-red-400 font-medium transition-colors duration-250">
            CRL Active • {revokedCount} revoked
          </div>
        </Link>
      </div>
    </div>
  );
};

export default IssuerDashboard;
