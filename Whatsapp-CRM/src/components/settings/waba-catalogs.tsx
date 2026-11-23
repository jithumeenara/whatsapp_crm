'use client';

/**
 * "Catalog for each WhatsApp number" — Meta allows one catalog per WhatsApp
 * Business Account, shared by its numbers. Choose which connected catalog
 * each account uses and whether the catalog / cart show on its numbers.
 * Checked again on the server (/api/catalog/waba-link).
 */

import { useCallback, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/hooks/use-confirm';
import { apiFetch, errorText } from '@/lib/api-fetch';

interface Waba { wabaId: string; numbers: string[]; catalogId: string | null; catalogVisible: boolean; cartEnabled: boolean; lastError: string | null }
interface Catalog { id: string; name: string | null; isDefault: boolean }
type Draft = { catalogId: string; catalogVisible: boolean; cartEnabled: boolean };

export function WabaCatalogs({ refreshKey = 0 }: Readonly<{ refreshKey?: number }>) {
  const uid = useId();
  const confirm = useConfirm();
  const [wabas, setWabas] = useState<Waba[] | null>(null);
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/catalog/waba-link');
      const d = (await res.json()) as { wabas?: Waba[]; catalogs?: Catalog[] };
      const ws = Array.isArray(d.wabas) ? d.wabas : [];
      const cs = Array.isArray(d.catalogs) ? d.catalogs : [];
      setWabas(ws);
      setCatalogs(cs);
      setDrafts(Object.fromEntries(ws.map((w) => [w.wabaId, { catalogId: w.catalogId ?? cs.find((c) => c.isDefault)?.id ?? '', catalogVisible: w.catalogVisible, cartEnabled: w.cartEnabled }])));
    } catch (err) {
      console.error('[waba catalogs] load failed:', err);
      toast.error(errorText(err, 'Could not load the WhatsApp numbers.'));
      setWabas([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load, refreshKey]);

  async function save(w: Waba) {
    const d = drafts[w.wabaId];
    if (busy || !d?.catalogId) return;
    if (w.catalogId && w.catalogId !== d.catalogId) {
      const ok = await confirm({
        title: 'Change this number’s catalog?',
        description: 'Customers of these numbers will see the new catalog’s products from now on. Products already sent in chats stay as they were.',
        confirmLabel: 'Change catalog', variant: 'default',
      });
      if (!ok) return;
    }
    setBusy(w.wabaId);
    try {
      await apiFetch('/api/catalog/waba-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waba_id: w.wabaId, catalog_id: d.catalogId, catalog_visible: d.catalogVisible, cart_enabled: d.cartEnabled }),
      });
      toast.success('Catalog linked to this WhatsApp account.');
      await load();
    } catch (err) {
      console.error('[waba catalogs] save failed:', err);
      toast.error(errorText(err, 'Could not link the catalog.'));
      await load();
    } finally { setBusy(null); }
  }

  if (wabas === null) return <div className="h-20 animate-pulse rounded-2xl bg-slate-100" aria-busy="true" aria-label="Loading WhatsApp numbers" />;
  if (wabas.length === 0 || catalogs.length === 0) return null;

  return (
    <section aria-labelledby={`${uid}-h`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h3 id={`${uid}-h`} className="text-[14px] font-semibold text-slate-800">Catalog for each WhatsApp number</h3>
      <p className="mt-0.5 text-[12px] text-slate-500">Meta allows one catalog per WhatsApp account; every number under it shows that catalog. Products sent from a chat come from its number’s catalog.</p>
      <ul className="mt-3 space-y-3">
        {wabas.map((w) => {
          const d = drafts[w.wabaId] ?? { catalogId: '', catalogVisible: true, cartEnabled: true };
          return (
            <li key={w.wabaId} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              <p className="truncate text-[13px] font-medium text-slate-800" title={w.numbers.join(', ')}>{w.numbers.join(', ')}</p>
              <p className="text-[11.5px] text-slate-500">WhatsApp account {w.wabaId}</p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <label htmlFor={`${uid}-${w.wabaId}`} className="sr-only">Catalog</label>
                  <select id={`${uid}-${w.wabaId}`} value={d.catalogId} onChange={(e) => setDrafts({ ...drafts, [w.wabaId]: { ...d, catalogId: e.target.value } })}
                    className="h-9 w-full truncate rounded-lg border border-slate-200 bg-white px-2 text-[13px] text-slate-800">
                    <option value="" disabled>Choose a catalog</option>
                    {catalogs.map((c) => <option key={c.id} value={c.id}>{c.name ?? `Catalog ${c.id}`}{c.isDefault ? ' (default)' : ''}</option>)}
                  </select>
                </div>
                <Button type="button" disabled={busy !== null || !d.catalogId} onClick={() => void save(w)} className="h-9 px-4 text-[13px]">
                  {busy === w.wabaId && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Save
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-slate-700">
                <label className="inline-flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" checked={d.catalogVisible} onChange={(e) => setDrafts({ ...drafts, [w.wabaId]: { ...d, catalogVisible: e.target.checked } })} /> Show catalog on these numbers
                </label>
                <label className="inline-flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" checked={d.cartEnabled} onChange={(e) => setDrafts({ ...drafts, [w.wabaId]: { ...d, cartEnabled: e.target.checked } })} /> Allow cart
                </label>
              </div>
              {w.lastError && <p className="mt-2 flex items-start gap-1.5 text-[12px] text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{w.lastError}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
