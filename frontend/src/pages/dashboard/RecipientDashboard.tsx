import { Link } from "react-router-dom";
import {
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  FileText,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useMemo } from "react";
import { useUserCertificatesQuery } from "../../api/queries";
import { useAuth } from "../../context/AuthContext";
import {
  MetricCard,
  formatCertificateDate,
  getCertificateStatusClass,
  getCertificateStatusLabel,
  isExpiringSoon,
} from "./shared";

const RecipientDashboard = () => {
  const { user } = useAuth();

  // Same cache entry as the wallet page, so only one of the two routes pays
  // for this request.
  const {
    data: certificates = [],
    isPending: loading,
    isError,
    error: loadError,
  } = useUserCertificatesQuery(user?.id);

  const error = isError
    ? ((loadError as { message?: string } | null)?.message ??
      "Failed to load your certificate wallet")
    : null;

  const summary = useMemo(() => {
    const active = certificates.filter((cert) => cert.status === "active");
    const revoked = certificates.filter((cert) => cert.status === "revoked");
    const expired = certificates.filter((cert) => cert.status === "expired");
    const expiringSoon = certificates.filter(isExpiringSoon);
    const recentCertificates = [...certificates].sort(
      (a, b) =>
        new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime(),
    );

    return {
      total: certificates.length,
      active: active.length,
      revoked: revoked.length,
      expired: expired.length,
      expiringSoon: expiringSoon.length,
      recentCertificates,
    };
  }, [certificates]);

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 transition-colors duration-250 dark:text-white">
            Your Certificate Wallet
          </h1>
          <p className="mt-1 text-sm text-gray-500 transition-colors duration-250 dark:text-slate-400">
            See your certificate summary, recent awards, and quick verification
            actions in one place.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/wallet"
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors duration-250 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Wallet className="h-4 w-4" />
            Open wallet
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <MetricCard
          label="Total Certificates"
          value={summary.total}
          accentClassName="text-blue-600"
        />
        <MetricCard
          label="Active"
          value={summary.active}
          accentClassName="text-emerald-600"
        />
        <MetricCard
          label="Expiring Soon"
          value={summary.expiringSoon}
          accentClassName="text-amber-600"
        />
        <MetricCard
          label="Revoked / Expired"
          value={summary.revoked + summary.expired}
          accentClassName="text-red-600"
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[3fr,2fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-md transition-colors duration-250 dark:border-slate-700 dark:bg-slate-900 dark:shadow-lg">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 transition-colors duration-250 dark:text-white">
                Recent certificates
              </h2>
              <p className="mt-1 text-xs text-gray-500 transition-colors duration-250 dark:text-slate-400">
                Your latest certificates and their current status.
              </p>
            </div>
            <Link
              to="/wallet"
              className="text-sm font-medium text-blue-600 transition-colors duration-250 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              View full wallet
            </Link>
          </div>

          <div className="mt-4">
            {loading ? (
              <div className="flex h-48 items-center justify-center text-sm text-gray-500 dark:text-slate-400">
                Loading your certificates...
              </div>
            ) : summary.recentCertificates.length ? (
              <div className="space-y-3">
                {summary.recentCertificates.slice(0, 5).map((certificate) => (
                  <div
                    key={certificate.id}
                    className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 transition-colors duration-250 dark:border-slate-700 dark:bg-slate-800/60 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-gray-900 transition-colors duration-250 dark:text-white">
                          {certificate.title}
                        </p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getCertificateStatusClass(certificate.status)}`}
                        >
                          {getCertificateStatusLabel(certificate.status)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-gray-600 transition-colors duration-250 dark:text-slate-400">
                        Issued by {certificate.issuerName} on{" "}
                        {formatCertificateDate(certificate.issueDate)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-slate-400">
                      {certificate.expiryDate ? (
                        <span>
                          Expires{" "}
                          {formatCertificateDate(certificate.expiryDate)}
                        </span>
                      ) : (
                        <span>No expiry date</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-gray-500 transition-colors duration-250 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                <FileText className="mb-3 h-6 w-6 text-slate-400" />
                No certificates have been added to your wallet yet.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-md transition-colors duration-250 dark:border-slate-700 dark:bg-slate-900 dark:shadow-lg">
            <h2 className="text-lg font-semibold text-gray-900 transition-colors duration-250 dark:text-white">
              Quick actions
            </h2>
            <div className="mt-4 space-y-3">
              <Link
                to="/wallet"
                className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-800 transition-colors duration-250 hover:bg-gray-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <span>Open wallet</span>
                <Wallet className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </Link>
              <Link
                to="/verify"
                className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-800 transition-colors duration-250 hover:bg-gray-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <span>Verify a certificate</span>
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-md transition-colors duration-250 dark:border-slate-700 dark:bg-slate-900 dark:shadow-lg">
            <h2 className="text-lg font-semibold text-gray-900 transition-colors duration-250 dark:text-white">
              Wallet insights
            </h2>
            <ul className="mt-4 space-y-3 text-sm text-gray-600 transition-colors duration-250 dark:text-slate-400">
              <li className="flex items-start gap-3">
                <BadgeCheck className="mt-0.5 h-4 w-4 text-emerald-500" />
                Keep the wallet page bookmarked for quick access to your
                certificates.
              </li>
              <li className="flex items-start gap-3">
                <BookOpen className="mt-0.5 h-4 w-4 text-blue-500" />
                Use the verify page to confirm certificate authenticity with a
                serial number or hash.
              </li>
              <li className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-amber-500" />
                Review expiry dates regularly so you do not miss certificates
                that need renewal.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RecipientDashboard;
