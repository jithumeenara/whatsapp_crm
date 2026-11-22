'use client';

/**
 * "Results sent back to Meta" — on/off, the stage names Meta sees for Lead
 * Ads leads, the Lead Ads dataset, and the send log with Retry. Checked
 * again on the server (/api/meta-ads/conversions).
 */

import { useCallback, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { apiFetch, errorText } from '@/lib/api-fetch';

type Stage = 'raw' | 'qualified' | 'won' | 'lost';
interface EventRow { id: string; target: string; channel: string | null; stage: Stage; event_name: string; status: string; attempts: number; last_error: string | null; created_at: string; sent_at: string | null }
interface Data { enabled: boolean; stageNames: Record<Stage, string>; crmDatasetId: string; events: EventRow[]; counts: Record<string, number> }

const STAGE_LABEL: Record<Stage, string> = { raw: 'New lead', qualified: 'Qualified', won: 'Won', lost: 'Lost' };
const STATUS: Record<string, { text: string; cls: string }> = {
  sent: { text: 'Sent', cls: 'bg-emerald-50 text-emerald-800' },
  pending: { text: 'Waiting', cls: 'bg-slate-100 text-slate-700' },
  sending: { text: 'Sending', cls: 'bg-slate-100 text-slate-700' },
  failed: { text: 'Failed', cls: 'bg-rose-50 text-rose-800' },
  skipped: { text: 'Skipped', cls: 'bg-amber-50 text-amber-900' },
};
const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function MetaConversionsCard() {
  const uid = useId();
  const [data, setData] = useState<Data | null>(null);
  const [names, setNames] = useState<Record<Stage, string> | null>(null);
  const [dataset, setDataset] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/meta-ads/conversions');
      const d = (await res.json()) as Data;
      setData({ ...d, events: Array.isArray(d.events) ? d.events : [], counts: d.counts ?? {} });
      setNames(d.stageNames);
      setDataset(d.crmDatasetId ?? '');
    } catch (err) {
      console.error('[conversions] load failed:', err);
      toast.error(errorText(err, 'Could not load the results settings.'));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(body: Record<string, unknown>, what: string) {
    if (busy) return;
    setBusy(what);
    try {
      const res = await apiFetch('/api/meta-ads/conversions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const out = (await res.json()) as { retried?: number };
      toast.success(what === 'retry' ? `${out.retried ?? 0} sent back to the queue.` : 'Saved.');
      await load();
    } catch (err) {
      console.error('[conversions] save failed:', err);
      toast.error(errorText(err, 'Could not save.'));
    } finally { setBusy(null); }
  }

  if (!data || !names) return <div className="h-24 animate-pulse rounded-2xl bg-slate-100" aria-busy="true" aria-label="Loading results settings" />;

  return (
    <section aria-labelledby={`${uid}-h`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`${uid}-h`} className="text-[14px] font-semibold text-slate-800">Results sent back to Meta</h3>
          <p className="mt-0.5 text-[12px] text-slate-500">
            When a lead from an ad is qualified, won or lost, Meta is told — on WhatsApp, Instagram, Messenger and Lead Ads — so it shows your ads to people who become real customers.
          </p>
        </div>
        <Switch checked={data.enabled} disabled={busy !== null} onCheckedChange={(v) => void save({ enabled: Boolean(v) }, 'enabled')} aria-label="Send results back to Meta" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(['raw', 'qualified', 'won', 'lost'] as Stage[]).map((k) => (
          <div key={k} className="min-w-0">
            <label htmlFor={`${uid}-${k}`} className="mb-1 block text-[12px] font-medium text-slate-600">{STAGE_LABEL[k]} → name Meta sees</label>
            <Input id={`${uid}-${k}`} name={`stage-${k}`} autoComplete="off" maxLength={50} value={names[k]} onChange={(e) => setNames({ ...names, [k]: e.target.value })} className="h-9 text-[13px]" />
          </div>
        ))}
        <div className="min-w-0 sm:col-span-2">
          <label htmlFor={`${uid}-ds`} className="mb-1 block text-[12px] font-medium text-slate-600">Lead Ads dataset ID (optional)</label>
          <Input id={`${uid}-ds`} name="crm-dataset" autoComplete="off" inputMode="numeric" value={dataset} onChange={(e) => setDataset(e.target.value.replace(/\D/g, ''))} placeholder="From Meta Events Manager → your CRM dataset" className="h-9 font-mono text-[13px]" />
          <p className="mt-1 text-[11px] text-slate-500">Needed only for Lead Ads form leads (Conversion Leads). Chats from ads need nothing extra.</p>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button type="button" disabled={busy !== null} onClick={() => void save({ stageNames: names, crmDatasetId: dataset }, 'settings')} className="h-9 px-4 text-[13px]">
          {busy === 'settings' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Save
        </Button>
      </div>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12.5px] font-semibold text-slate-700">
            Send log <span className="font-normal text-slate-500">· {data.counts.sent ?? 0} sent · {data.counts.failed ?? 0} failed · {(data.counts.pending ?? 0) + (data.counts.sending ?? 0)} waiting</span>
          </p>
          {(data.counts.failed ?? 0) > 0 && (
            <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void save({ action: 'retry' }, 'retry')}>
              {busy === 'retry' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} Retry failed
            </Button>
          )}
        </div>
        {data.events.length === 0 ? (
          <p className="mt-2 text-[12px] text-slate-500">Nothing sent yet. Results appear here when a lead from an ad changes stage.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {data.events.map((e) => (
              <li key={e.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-0.5 py-2 text-[12px] sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[e.status]?.cls ?? 'bg-slate-100 text-slate-700'}`}>{STATUS[e.status]?.text ?? e.status}</span>
                <span className="min-w-0 text-slate-700 [overflow-wrap:anywhere]">
                  {STAGE_LABEL[e.stage] ?? e.stage} · {e.target === 'crm' ? 'Lead Ads' : e.channel === 'messenger' ? 'Messenger' : e.channel === 'instagram' ? 'Instagram' : 'WhatsApp'}
                  {e.last_error && e.status !== 'sent' ? <span className="block text-slate-500">{e.last_error}</span> : null}
                </span>
                <time className="col-start-2 text-slate-400 sm:col-start-auto" dateTime={e.created_at}>{fmt.format(new Date(e.created_at))}</time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
