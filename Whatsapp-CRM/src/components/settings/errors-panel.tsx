'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Bug, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { apiFetch, errorText } from '@/lib/api-fetch';

interface AppErrorRow {
  id: string;
  source: 'server' | 'browser';
  where_at: string;
  message: string;
  count: number;
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
  server_wide: boolean;
}

const when = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * Settings → Errors: what went wrong for real people (app_errors). One row
 * per distinct error with how often it happened. Owners and admins also
 * get a push when a new error keeps happening (alert-sweep.ts).
 */
export function ErrorsPanel() {
  const [rows, setRows] = useState<AppErrorRow[] | null>(null);
  const [serverOwner, setServerOwner] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const res = await apiFetch(`/api/system/errors?show=${showAll ? 'all' : 'open'}`, { cache: 'no-store' });
      const data = (await res.json()) as { errors?: AppErrorRow[]; server_owner?: boolean };
      setRows(Array.isArray(data.errors) ? data.errors : []);
      setServerOwner(Boolean(data.server_owner));
    } catch (err) {
      console.error('[errors-panel] load failed:', err);
      setLoadError(errorText(err, 'Could not load errors.'));
      setRows((r) => r ?? []);
    }
  }, [showAll]);

  useEffect(() => { void load(); }, [load]);

  async function resolve(id: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      await apiFetch('/api/system/errors', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'resolve' }),
      });
      toast.success('Marked as resolved. You will hear again if it comes back.');
      await load();
    } catch (err) {
      console.error('[errors-panel] resolve failed:', err);
      toast.error(errorText(err, 'Could not mark it as resolved.'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-slate-500">
          {serverOwner ? 'Your workspace and server-wide errors.' : 'Errors your team ran into in this workspace.'}
        </p>
        <div className="flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 text-[12.5px] text-slate-600">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show resolved
          </label>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh
          </button>
        </div>
      </div>

      {loadError && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-[12.5px] text-red-700">{loadError}</p>}

      {rows === null && (
        <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-6 text-[13px] text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading…
        </div>
      )}

      {rows !== null && rows.length === 0 && !loadError && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-500" aria-hidden="true" />
          <p className="mt-2 text-[14px] font-semibold text-slate-700">No open errors</p>
          <p className="mt-1 text-[12.5px] text-slate-500">When something fails for someone, it shows up here.</p>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Bug className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                  <span className="break-all text-[12.5px] font-semibold text-slate-800">{r.where_at || 'Error'}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{r.source === 'browser' ? 'Browser' : 'Server'}</span>
                  {r.server_wide && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">Server-wide</span>}
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium tabular-nums text-indigo-700">{r.count}×</span>
                </div>
                <p className="mt-1 break-words font-mono text-[11.5px] leading-relaxed text-slate-600">{r.message}</p>
                <p className="mt-1 text-[11px] text-slate-400">
                  Last {when.format(new Date(r.last_seen))} · first {when.format(new Date(r.first_seen))}
                  {r.resolved_at ? ` · resolved ${when.format(new Date(r.resolved_at))}` : ''}
                </p>
              </div>
              {!r.resolved_at && (
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void resolve(r.id)}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-lg border border-slate-200 px-3 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  {busyId === r.id && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                  Mark resolved
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
