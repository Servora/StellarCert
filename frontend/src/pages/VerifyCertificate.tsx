import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { CheckCircle, AlertTriangle } from 'lucide-react';
import { VerificationResult } from '../api';
import { useVerifyCertificateQuery } from '../api/queries';
import { useDebounce } from '../hooks/useDebounce';

type VerificationState = {
  loading: boolean;
  result: VerificationResult | null;
  error: string | null;
};

type ToastState = {
  type: 'success' | 'error';
  message: string;
};

export default function VerifyCertificate(): JSX.Element {
  const [searchParams] = useSearchParams();
  // Seed from the URL so a shared link is verified without a keystroke.
  const [serial, setSerial] = useState(
    () => searchParams.get('serial')?.trim() ?? '',
  );
  const debouncedSerial = useDebounce(serial, 300);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const qrScannerRef = useRef<Html5QrcodeScanner | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  // Verification is keyed by serial, so re-checking the same certificate is
  // answered from cache, and concurrent lookups of one serial collapse into a
  // single request (no hand-rolled in-flight guard needed).
  const verificationQuery = useVerifyCertificateQuery(debouncedSerial);

  const state: VerificationState = useMemo(() => {
    if (verificationQuery.isError) {
      return {
        loading: false,
        result: null,
        error: 'An unexpected error occurred. Please try again.',
      };
    }

    const result = verificationQuery.data ?? null;

    if (result && !result.isValid) {
      return {
        loading: false,
        result,
        error: result.message || 'Verification failed',
      };
    }

    return {
      loading: verificationQuery.isFetching,
      result,
      error: null,
    };
  }, [
    verificationQuery.isError,
    verificationQuery.data,
    verificationQuery.isFetching,
  ]);

  // Copy text to the clipboard and drive the toast on success/failure.
  // The async Clipboard API is unavailable over plain HTTP and can be
  // denied by the browser, so fall back to the legacy copy path before
  // surfacing the failure to the user.
  const copyToClipboard = useCallback(async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast({ type: 'success', message: successMessage });
    } catch {
      try {
        const el = document.createElement('textarea');
        el.value = text;
        el.setAttribute('readonly', '');
        el.style.position = 'absolute';
        el.style.left = '-9999px';
        document.body.appendChild(el);
        el.select();
        const copied =
          typeof document.execCommand === 'function' &&
          document.execCommand('copy');
        document.body.removeChild(el);
        setToast(
          copied
            ? { type: 'success', message: successMessage }
            : { type: 'error', message: 'Copy failed. Please copy the link manually.' }
        );
      } catch {
        setToast({ type: 'error', message: 'Copy failed. Please copy the link manually.' });
      }
    }
  }, []);

  // Keep the input in step with the URL when the query string changes.
  useEffect(() => {
    const serialParam = searchParams.get('serial')?.trim();
    if (serialParam) {
      setSerial(serialParam);
    }
  }, [searchParams]);

  // Auto-dismiss toast after 3 seconds
  useEffect(() => {
    if (!toast) return;
    const timeoutId = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  // Initialize QR scanner
  useEffect(() => {
    if (showQrScanner && !qrScannerRef.current) {
      qrScannerRef.current = new Html5QrcodeScanner(
        'qr-reader',
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        },
        false
      );

      qrScannerRef.current.render(
        (decodedText) => {
          setSerial(decodedText);
          setShowQrScanner(false);
          qrScannerRef.current?.clear();
          qrScannerRef.current = null;
        },
        () => {
          // Called continuously while no QR code is in view; intentionally
          // ignored rather than surfaced, since it fires on nearly every
          // scan frame and isn't a user-actionable error.
        }
      );
    }

    return () => {
      if (qrScannerRef.current) {
        qrScannerRef.current.clear();
        qrScannerRef.current = null;
      }
    };
  }, [showQrScanner]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (serial.trim()) {
      // Explicit submit forces a re-check rather than reading the cache.
      void verificationQuery.refetch();
    }
  };

  const formatDate = (dateString: string | undefined): string => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  const getStatusBadgeColor = (status: string | undefined): string => {
    switch (status?.toLowerCase()) {
      case 'active':
        return 'bg-emerald-500/20 text-emerald-300';
      case 'revoked':
        return 'bg-red-500/20 text-red-300';
      case 'expired':
        return 'bg-yellow-500/20 text-yellow-300';
      default:
        return 'bg-slate-500/20 text-gray-600 dark:text-slate-300';
    }
  };

  return (
    <section className="space-y-8">
      {/* Toast Notification */}
      {toast && (
        <div
          className="fixed right-4 top-4 z-50 animate-in fade-in slide-in-from-top-2 duration-300"
          role="status"
          aria-live="polite"
        >
          <div
            className={`flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg ${
              toast.type === 'success'
                ? 'border-green-200 bg-green-50 dark:border-green-900/40 dark:bg-green-900/30'
                : 'border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/30'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle className="h-5 w-5 flex-shrink-0 text-green-500" />
            ) : (
              <AlertTriangle className="h-5 w-5 flex-shrink-0 text-red-500" />
            )}
            <p
              className={`text-sm font-medium ${
                toast.type === 'success'
                  ? 'text-green-900 dark:text-green-100'
                  : 'text-red-900 dark:text-red-100'
              }`}
            >
              {toast.message}
            </p>
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center gap-3">
          <svg
            className="h-6 w-6 text-primary"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">Verify Certificate</h2>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-gray-600 dark:text-slate-300">
          Enter a certificate serial number to verify its authenticity and view details.
        </p>
      </div>

      <div className="space-y-6">
        {/* Verification Form */}
        <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="serial"
                className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400"
              >
                Certificate Serial Number
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  id="serial"
                  type="text"
                  value={serial}
                  onChange={(e) => setSerial(e.target.value)}
                  placeholder="44c2adef-b514-4a37-ba07-6cef7bffba87"
                  className="flex-1 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-slate-950/70 px-4 py-3 text-sm text-gray-900  outline-none placeholder:text-gray-400 dark:text-slate-500 focus:border-primary"
                  disabled={state.loading}
                  aria-label="Certificate Serial Number"
                  aria-required="true"
                />
                <button
                  type="button"
                  onClick={() => setShowQrScanner(!showQrScanner)}
                  className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-slate-950/70 px-4 py-3 text-sm text-gray-900 dark:text-white hover:bg-slate-900/70 transition"
                  aria-label="Scan QR Code"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M12 12l3-3m-3 3l-3-3m-3 7h2.01M12 12l-3 3m3-3l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span>Scan QR</span>
                </button>
                <button
                  type="submit"
                  disabled={state.loading || !serial.trim()}
                  className="flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Verify Certificate"
                >
                  {state.loading ? (
                    <>
                      <svg
                        className="h-4 w-4 animate-spin"
                        fill="none"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      <span>Verifying...</span>
                    </>
                  ) : (
                    <>
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                        />
                      </svg>
                      <span>Verify</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* QR Scanner */}
        {showQrScanner && (
          <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Scan QR Code</h3>
                <button
                  onClick={() => setShowQrScanner(false)}
                  className="text-gray-500 dark:text-slate-400 hover:text-gray-900"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div id="qr-reader" className="w-full max-w-sm mx-auto"></div>
              <p className="text-sm text-gray-500 dark:text-slate-400 text-center">
                Point your camera at a certificate QR code to scan it.
              </p>
            </div>
          </div>
        )}

        {/* Results Display */}
        <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 p-6">
          {state.loading && (
            <div className="flex flex-col items-center justify-center py-12">
              <svg
                className="h-8 w-8 animate-spin text-primary"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <p className="mt-4 text-sm text-gray-600 dark:text-slate-300">Verifying certificate...</p>
            </div>
          )}

          {!state.loading && state.error && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4">
                <svg
                  className="h-5 w-5 text-red-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div>
                  <h3 className="text-sm font-semibold text-red-300">Verification Failed</h3>
                  <p className="mt-1 text-xs text-red-200">{state.error}</p>
                </div>
              </div>
            </div>
          )}

          {!state.loading && state.result?.isValid && state.result.certificate && (
            <div className="space-y-6">
              {/* Success Header */}
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20">
                  <svg
                    className="h-6 w-6 text-emerald-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-emerald-300">Certificate Verified</h3>
              </div>

              {/* Certificate Details */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                    Recipient Name
                  </p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {state.result.certificate.recipientName || 'N/A'}
                  </p>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                    Course Name
                  </p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {state.result.certificate.courseName || 'N/A'}
                  </p>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                    Issue Date
                  </p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {formatDate(state.result.certificate.issueDate)}
                  </p>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                    Issuer
                  </p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {state.result.certificate.issuerName || 'N/A'}
                  </p>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                    Certificate Number
                  </p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white break-all">
                    {state.result.certificate.id || 'N/A'}
                  </p>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                    Certificate Status
                  </p>
                  <span
                    className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${getStatusBadgeColor(
                      state.result.certificate.status
                    )}`}
                  >
                    {state.result.certificate.status
                      ? state.result.certificate.status.charAt(0).toUpperCase() +
                      state.result.certificate.status.slice(1)
                      : 'Unknown'}
                  </span>
                </div>
              </div>

              {/* Share Verification Result */}
              <div className="border-t border-gray-200 dark:border-white/10 pt-6">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Share Verification Result</h4>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const url = `${window.location.origin}/verify?serial=${encodeURIComponent(serial)}`;
                      void copyToClipboard(url, 'Link copied to clipboard!');
                    }}
                    className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-white/10 bg-gray-100 dark:bg-slate-800/50 px-3 py-2 text-sm text-gray-900 dark:text-white hover:bg-slate-700/50 transition"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy Link
                  </button>
                  <button
                    onClick={() => {
                      const text = `Certificate Verified: ${state.result?.certificate?.recipientName || 'N/A'} - ${state.result?.certificate?.courseName || 'N/A'}`;
                      const url = `${window.location.origin}/verify?serial=${encodeURIComponent(serial)}`;
                      if (navigator.share) {
                        navigator
                          .share({
                            title: 'Certificate Verification',
                            text: text,
                            url: url,
                          })
                          .catch(() => {
                            // The user dismissing the share sheet is not a
                            // failure worth surfacing.
                          });
                      } else {
                        void copyToClipboard(`${text}\n${url}`, 'Link copied to clipboard!');
                      }
                    }}
                    className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-white/10 bg-gray-100 dark:bg-slate-800/50 px-3 py-2 text-sm text-gray-900 dark:text-white hover:bg-slate-700/50 transition"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
                    </svg>
                    Share
                  </button>
                </div>
              </div>
            </div>
          )}

          {!state.loading && !state.result && !state.error && (
            <div className="text-center py-12">
              <p className="text-sm text-gray-500 dark:text-slate-400">
                Enter a certificate serial number to view verification results.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
