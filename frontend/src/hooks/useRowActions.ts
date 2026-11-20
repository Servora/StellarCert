// Per-row pending state and generic bulk actions for table rows. Closes #1339, #1345.
import { useCallback, useState } from 'react';

// Tracks pending actions per row id, so only the row being mutated is disabled.
export function useRowPending() {
  const [pending, setPending] = useState<Record<string, string>>({});

  const run = useCallback(async <T,>(rowId: string, action: string, fn: () => Promise<T>) => {
    setPending((p) => ({ ...p, [rowId]: action }));
    try {
      return await fn();
    } finally {
      setPending((p) => {
        const { [rowId]: _done, ...rest } = p;
        return rest;
      });
    }
  }, []);

  return {
    run,
    isRowPending: (rowId: string) => rowId in pending,
    pendingAction: (rowId: string) => pending[rowId] ?? null,
  };
}

export type BulkResult = { succeeded: string[]; failed: { id: string; error: string }[] };

// Applies one single-row action (freeze, unfreeze, transfer...) to every selected id.
export async function runBulkAction(
  ids: string[],
  action: (id: string) => Promise<unknown>,
): Promise<BulkResult> {
  const settled = await Promise.allSettled(ids.map((id) => action(id)));
  const result: BulkResult = { succeeded: [], failed: [] };
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') result.succeeded.push(ids[i]);
    else result.failed.push({ id: ids[i], error: String(s.reason?.message ?? s.reason) });
  });
  return result;
}
