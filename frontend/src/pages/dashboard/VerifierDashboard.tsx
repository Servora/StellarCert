import { Link } from "react-router-dom";
import {
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  FileText,
  Search,
  ShieldAlert,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { useVerifyCertificateMutation } from "../../api/queries";
import { formatCertificateDate, type VerifierLookupResult } from "./shared";

const VerifierDashboard = () => {
  const [lookupValue, setLookupValue] = useState("");
  const [verificationError, setVerificationError] = useState<string | null>(
    null,
  );
  const verifyMutation = useVerifyCertificateMutation();
  const verificationResult = verifyMutation.data as
    VerifierLookupResult | undefined;
  const verifying = verifyMutation.isPending;

  const handleVerify = () => {
    const trimmed = lookupValue.trim();
    if (!trimmed) {
      setVerificationError("Enter a certificate ID or hash to verify.");
      return;
    }

    setVerificationError(null);
    verifyMutation.mutate(trimmed, {
      onError: (err) => {
        setVerificationError(
          err && typeof err === "object" && "message" in err
            ? String((err as { message?: string }).message)
            : "Verification failed. Please try again.",
        );
      },
    });
  };

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 transition-colors duration-250 dark:text-white">
            Verification Center
          </h1>
          <p className="mt-1 text-sm text-gray-500 transition-colors duration-250 dark:text-slate-400">
            Quickly check certificate authenticity and jump into verification
            workflows.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/verify"
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors duration-250 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Search className="h-4 w-4" />
            Open verifier
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr,2fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-md transition-colors duration-250 dark:border-slate-700 dark:bg-slate-900 dark:shadow-lg">
          <h2 className="text-lg font-semibold text-gray-900 transition-colors duration-250 dark:text-white">
            Verify a certificate
          </h2>
          <p className="mt-1 text-xs text-gray-500 transition-colors duration-250 dark:text-slate-400">
            Enter a serial number, certificate ID, or hash to verify it here.
          </p>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={lookupValue}
              onChange={(event) => setLookupValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleVerify();
                }
              }}
              placeholder="e.g. CERT-2024-XXXXXXXX"
              className="flex-1 rounded-md border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm transition-colors duration-250 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
            <button
              type="button"
              onClick={() => void handleVerify()}
              disabled={verifying}
              className="inline-flex items-center justify-center rounded-md bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors duration-250 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-700 dark:hover:bg-blue-600"
            >
              {verifying ? "Verifying..." : "Verify"}
            </button>
          </div>

          {verificationError && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-500/10 dark:text-red-300">
              {verificationError}
            </div>
          )}

          {verificationResult && (
            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-5 transition-colors duration-250 dark:border-slate-700 dark:bg-slate-800/60">
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-full ${verificationResult.isValid ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"}`}
                >
                  {verificationResult.isValid ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <ShieldAlert className="h-5 w-5" />
                  )}
                </span>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 transition-colors duration-250 dark:text-white">
                    {verificationResult.isValid
                      ? "Certificate verified"
                      : "Certificate could not be verified"}
                  </h3>
                  {verificationResult.verifiedAt && (
                    <p className="text-xs text-gray-500 transition-colors duration-250 dark:text-slate-400">
                      Verified at{" "}
                      {new Date(verificationResult.verifiedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>

              {verificationResult.message && (
                <p className="mt-4 text-sm text-gray-600 transition-colors duration-250 dark:text-slate-300">
                  {verificationResult.message}
                </p>
              )}

              {verificationResult.certificate && (
                <div className="mt-4 grid grid-cols-1 gap-3 text-sm text-gray-600 transition-colors duration-250 dark:text-slate-300 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      Title
                    </p>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {verificationResult.certificate.title ?? "Unknown"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      Recipient
                    </p>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {verificationResult.certificate.recipientName ??
                        "Unknown"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      Issuer
                    </p>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {verificationResult.certificate.issuerName ?? "Unknown"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      Issued
                    </p>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {formatCertificateDate(
                        verificationResult.certificate.issuedDate,
                      )}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-md transition-colors duration-250 dark:border-slate-700 dark:bg-slate-900 dark:shadow-lg">
            <h2 className="text-lg font-semibold text-gray-900 transition-colors duration-250 dark:text-white">
              Quick actions
            </h2>
            <div className="mt-4 space-y-3">
              <Link
                to="/verify"
                className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-800 transition-colors duration-250 hover:bg-gray-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <span>Open verification page</span>
                <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </Link>
              <Link
                to="/wallet"
                className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-800 transition-colors duration-250 hover:bg-gray-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <span>Open wallet</span>
                <Wallet className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-md transition-colors duration-250 dark:border-slate-700 dark:bg-slate-900 dark:shadow-lg">
            <h2 className="text-lg font-semibold text-gray-900 transition-colors duration-250 dark:text-white">
              Verifier checklist
            </h2>
            <ul className="mt-4 space-y-3 text-sm text-gray-600 transition-colors duration-250 dark:text-slate-400">
              <li className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-500" />
                Verify with a serial number or credential hash before sharing
                certificate details.
              </li>
              <li className="flex items-start gap-3">
                <BadgeCheck className="mt-0.5 h-4 w-4 text-blue-500" />
                Use the verification page for a full, dedicated certificate
                authenticity flow.
              </li>
              <li className="flex items-start gap-3">
                <BookOpen className="mt-0.5 h-4 w-4 text-amber-500" />
                Keep notes about the context of the verification for auditing
                and compliance.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VerifierDashboard;
