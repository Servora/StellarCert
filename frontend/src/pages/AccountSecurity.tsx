import { useCallback, useEffect, useState } from 'react';
import {
  listSessions,
  revokeAllSessions,
  revokeSession,
  type AuthSessionDto,
} from '../api/endpoints';

/**
 * Account security panel (#1184): active sessions + sign out everywhere + 2FA status.
 * Embed under the profile page as a "Security" tab.
 */
export default function AccountSecurity({
  twoFactorEnabled = false,
}: {
  twoFactorEnabled?: boolean;
}) {
  const [sessions, setSessions] = useState<AuthSessionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSessions(await listSessions());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onRevoke = async (id: string) => {
    setBusyId(id);
    try {
      await revokeSession(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke session');
    } finally {
      setBusyId(null);
    }
  };

  const onRevokeAll = async () => {
    if (!window.confirm('Sign out of every device? You will need to log in again.')) {
      return;
    }
    setBusyId('all');
    try {
      await revokeAllSessions();
      await reload();
      // Force a full re-login on this device as well.
      window.location.href = '/login';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign out everywhere');
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Security</h2>
      <p className="mt-1 text-sm text-slate-600">
        Manage active sessions and two-factor authentication.
      </p>

      <div className="mt-6 rounded-md bg-slate-50 p-4">
        <h3 className="text-sm font-medium text-slate-800">Two-factor authentication</h3>
        <p className="mt-1 text-sm text-slate-600">
          Status:{' '}
          <span className={twoFactorEnabled ? 'text-green-700' : 'text-amber-700'}>
            {twoFactorEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </p>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-slate-800">Active sessions</h3>
          <button
            type="button"
            onClick={() => void onRevokeAll()}
            disabled={busyId === 'all' || loading}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            Sign out everywhere
          </button>
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="mt-3 text-sm text-slate-500">Loading sessions…</p>
        ) : sessions.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No active sessions.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
            {sessions.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {s.device || s.userAgent || 'Unknown device'}
                    {s.current ? (
                      <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">
                        This device
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-slate-500">
                    IP {s.ipAddress || '—'} · Last used{' '}
                    {new Date(s.lastUsedAt).toLocaleString()}
                  </p>
                </div>
                {!s.current ? (
                  <button
                    type="button"
                    onClick={() => void onRevoke(s.id)}
                    disabled={busyId === s.id}
                    className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Revoke
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
