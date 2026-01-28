import { useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export default function Verify(): JSX.Element {
  const [serial, setSerial] = useState('');
  const [loading, setLoading] = useState(false);
  interface VerificationResult {
    isValid: boolean;
    issuedAt: string;
    recipientEmail: string;
    title: string;
  }

  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serial) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(`${API_URL}/certificates/verify/${serial}`);
      if (response.ok) {
        const data = await response.json();
        setResult(data.data || data);
      } else {
        const errData = await response.json();
        setError(errData.message || 'Certificate not found or invalid');
      }
    } catch (err) {
      setError('An error occurred during verification');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-white">Verify a Certificate</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-300">
          Enter a certificate ID or scan a verification code to confirm authenticity.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <form className="space-y-4" onSubmit={handleVerify}>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Certificate ID or Tx Hash
              </label>
              <input
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none focus:border-primary"
                placeholder="STC-2026-00023 or 0x..."
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Verify Certificate'}
            </button>
          </form>

          {error && (
            <div className="mt-4 rounded-xl bg-rose-500/20 px-4 py-3 text-sm text-rose-300">
              {error}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 via-white/10 to-white/5 p-6">
          <h3 className="text-lg font-semibold text-white">Verification results</h3>
          <p className="mt-2 text-sm text-slate-300">
            {result ? 'Real-time blockchain verification complete.' : 'Verification responses will include issuer details, certificate status, and metadata integrity.'}
          </p>

          {result && (
            <div className="mt-6 space-y-3 text-sm text-slate-200">
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3">
                <span>Status</span>
                <span className={`rounded-full px-3 py-1 text-xs ${result.isValid ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                  {result.isValid ? 'Authentic' : 'Invalid/Revoked'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3">
                <span>Issued</span>
                <span>{new Date(result.issuedAt).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3">
                <span>Recipient</span>
                <span>{result.recipientEmail}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3">
                <span>Program</span>
                <span>{result.title}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
