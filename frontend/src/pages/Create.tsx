import { useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export default function Create(): JSX.Element {
  const [formData, setFormData] = useState({
    recipientName: '',
    recipientEmail: '',
    title: '',
    certificateId: `STC-${new Date().getFullYear()}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`,
    issuedAt: new Date().toISOString().split('T')[0],
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`${API_URL}/certificates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          certificateId: formData.certificateId,
          title: formData.title,
          issuerName: 'StellarCert Issuer', // This would normally come from auth context
          recipientEmail: formData.recipientEmail,
          // In the real app, we'd add description etc.
        }),
      });

      if (response.ok) {
        setMessage({ type: 'success', text: 'Certificate issued successfully on Stellar!' });
        // Reset form or redirect
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.message || 'Failed to issue certificate' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'An unexpected error occurred' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-white">Create a Certificate</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-300">
          Build a new certificate template with structured data and a print-ready preview.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Recipient Name
              </label>
              <input
                name="recipientName"
                value={formData.recipientName}
                onChange={handleChange}
                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none focus:border-primary"
                placeholder="Jordan Lewis"
                required
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Recipient Email
              </label>
              <input
                name="recipientEmail"
                type="email"
                value={formData.recipientEmail}
                onChange={handleChange}
                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none focus:border-primary"
                placeholder="jordan@example.com"
                required
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Program / Course
              </label>
              <input
                name="title"
                value={formData.title}
                onChange={handleChange}
                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none focus:border-primary"
                placeholder="Blockchain Fundamentals"
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Issue Date
                </label>
                <input
                  name="issuedAt"
                  type="date"
                  value={formData.issuedAt}
                  onChange={handleChange}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Certificate ID
                </label>
                <input
                  name="certificateId"
                  value={formData.certificateId}
                  onChange={handleChange}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none focus:border-primary"
                  placeholder="STC-2026-00023"
                  required
                />
              </div>
            </div>

            {message && (
              <div className={`rounded-xl px-4 py-3 text-sm ${message.type === 'success' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                {message.text}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:opacity-50"
            >
              {loading ? 'Generating...' : 'Generate Certificate'}
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Preview</p>
          <div className="mt-4 rounded-2xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6">
            <div className="certificate-text text-center">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Certificate of Completion</p>
              <h3 className="mt-4 text-2xl font-bold text-white">{formData.recipientName || 'Recipient Name'}</h3>
              <p className="mt-3 text-sm text-slate-300">
                has successfully completed the {formData.title || 'Program Name'} program.
              </p>
              <p className="mt-6 text-xs text-slate-400">Issued {formData.issuedAt} · ID {formData.certificateId}</p>
            </div>
          </div>
          <p className="mt-4 text-xs text-slate-400">
            Print layout is optimized with dedicated print styles.
          </p>
        </div>
      </div>
    </section>
  );
}
