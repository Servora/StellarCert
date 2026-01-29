import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { certificateApi, VerificationResult } from '../api';

type VerificationState = {
  loading: boolean;
  result: VerificationResult | null;
  error: string | null;
};

export default function VerifyCertificate(): JSX.Element {
  const [searchParams] = useSearchParams();
  const [serial, setSerial] = useState('');
  const [state, setState] = useState<VerificationState>({
    loading: false,
    result: null,
    error: null,
  });
  const isVerifyingRef = useRef(false);

  const handleVerify = useCallback(async (serialToVerify: string) => {
    const serialNumber = serialToVerify.trim();

    // Validation
    if (!serialNumber) {
      setState({
        loading: false,
        result: null,
        error: 'Please enter a certificate serial number.',
      });
      return;
    }

    // Prevent duplicate calls
    if (isVerifyingRef.current) {
      return;
    }

    isVerifyingRef.current = true;
    setState({
      loading: true,
      result: null,
      error: null,
    });

    try {
      const response = await certificateApi.verify(serialNumber);
      setState({
        loading: false,
        result: response,
        error: response.isValid ? null : response.message || 'Verification failed',
      });
    } catch (error) {
      setState({
        loading: false,
        result: null,
        error: 'An unexpected error occurred. Please try again.',
      });
    } finally {
      isVerifyingRef.current = false;
    }
  }, []);

  // Auto-verify when serial is provided in URL query parameter
  useEffect(() => {
    const serialParam = searchParams.get('serial');
    if (serialParam && serialParam.trim()) {
      setSerial(serialParam.trim());
      handleVerify(serialParam.trim());
    }
  }, [searchParams, handleVerify]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (serial.trim()) {
      handleVerify(serial.trim());
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
        return 'bg-slate-500/20 text-slate-300';
    }
  };

  return (
    <section className="space-y-8">
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
          <h2 className="text-2xl font-semibold text-white">Verify Certificate</h2>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-slate-300">
          Enter a certificate serial number to verify its authenticity and view details.
        </p>
      </div>

      <div className="space-y-6">
        {/* Verification Form */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="serial"
                className="text-xs font-semibold uppercase tracking-wide text-slate-400"
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
                  className="flex-1 rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-primary"
                  disabled={state.loading}
                  aria-label="Certificate Serial Number"
                  aria-required="true"
                />
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

        {/* Results Display */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
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
              <p className="mt-4 text-sm text-slate-300">Verifying certificate...</p>
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
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Recipient Name
                  </p>
                  <p className="text-sm font-medium text-white">
                    {state.result.certificate.recipientName || 'N/A'}
                  </p>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Course Name
                  </p>
                  <p className="text-sm font-medium text-white">
                    {state.result.certificate.courseName || 'N/A'}
                  </p>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Issue Date
                  </p>
                  <p className="text-sm font-medium text-white">
                    {formatDate(state.result.certificate.issueDate)}
                  </p>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Issuer
                  </p>
                  <p className="text-sm font-medium text-white">
                    {state.result.certificate.issuerName || 'N/A'}
                  </p>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Certificate Number
                  </p>
                  <p className="text-sm font-medium text-white break-all">
                    {state.result.certificate.id || 'N/A'}
                  </p>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
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
            </div>
          )}

          {!state.loading && !state.result && !state.error && (
            <div className="text-center py-12">
              <p className="text-sm text-slate-400">
                Enter a certificate serial number to view verification results.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
