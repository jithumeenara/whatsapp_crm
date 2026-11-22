'use client';

/**
 * "Connect Ads" / "Connect Catalog" — one-click Meta login for that asset
 * kind only, the checkbox chooser when several were shared, and the list of
 * connected ad accounts / catalogs: health in plain words, the default,
 * Check, Remove. Everything is checked again on the server
 * (/api/meta/social-connect/start, /api/meta/assets*).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, CircleHelp, Loader2, Plug, RefreshCw, Star, Trash2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useConfirm } from '@/hooks/use-confirm';
import { apiFetch, errorText } from '@/lib/api-fetch';

type Kind = 'ads' | 'catalog';
interface Item {
  id: string; externalId: string; name: string | null; currency: string | null; timezone: string | null;
  isDefault: boolean; productCount: number | null; lastCheckedAt: string | null;
  health: { level: 'ok' | 'warn' | 'error' | 'unknown'; text: string };
}
interface Choice { id: string; name: string; currency?: string | null; productCount?: number | null }

const WORD: Record<Kind, { one: string; many: string; button: string }> = {
  ads: { one: 'ad account', many: 'ad accounts', button: 'Connect Ads' },
  catalog: { one: 'catalog', many: 'catalogs', button: 'Connect Catalog' },
};

/** Fixed texts for ?code= — free text in the URL is never shown. */
const ERRORS: Record<string, string> = {
  not_owner: 'Sign in as the workspace owner, then press Connect again.',
  expired: 'This connection link is not valid or has expired. Press Connect again.',
  no_code: 'Meta did not finish the sign-in. Press Connect again.',
  no_app: 'One-click connect is not set up on this server yet.',
  bad_token: 'Meta returned a sign-in that is not valid. Press Connect again.',
  no_ads_permission: 'Meta did not grant ads access. Press Connect Ads again and allow it.',
  no_catalog_permission: 'Meta did not grant catalog access. Press Connect Catalog again and allow it.',
  no_ad_account: 'No ad account was shared. Press Connect Ads again and tick your ad accounts.',
  no_catalog: 'No catalog was shared. Press Connect Catalog again and tick your catalogs.',
  failed: 'The connection did not finish. Press Connect again.',
};

export function MetaAssetPanel({ kind, onChanged }: Readonly<{ kind: Kind; onChanged?: () => void }>) {
  const confirm = useConfirm();
  const router = useRouter();
  const params = useSearchParams();
  const w = WORD[kind];
  const [items, setItems] = useState<Item[] | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const session = useRef<string | null>(null);
  const shown = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/meta/assets?kind=${kind}`);
      const data = (await res.json()) as { items?: Item[]; oneClickReady?: boolean };
      setItems(Array.isArray(data.items) ? data.items : []);
      setReady(data.oneClickReady === true);
      setError(null);
    } catch (err) {
      console.error(`[meta ${kind}] list failed:`, err);
      setError(errorText(err, `Could not load the connected ${w.many}.`));
      setItems([]);
    }
  }, [kind, w.many]);
  useEffect(() => { void load(); }, [load]);

  const clearQuery = useCallback(() => router.replace(`/settings?tab=${kind}`, { scroll: false }), [router, kind]);

  // After Meta sends the browser back here.
  useEffect(() => {
    const result = params.get('meta_connect');
    if (!result || params.get('kind') !== kind || shown.current) return;
    shown.current = true;
    const code = params.get('code');
    const sid = params.get('session');
    if (result === 'connected') { toast.success(`${w.button.replace('Connect ', '')} connected.`); void load(); onChanged?.(); clearQuery(); }
    else if (result === 'cancelled') { toast.info('Connection cancelled — nothing was changed.'); clearQuery(); }
    else if (result === 'error') { toast.error((code && Object.hasOwn(ERRORS, code) ? ERRORS[code] : null) ?? ERRORS.failed); clearQuery(); }
    else if (result === 'choose_asset' && sid && /^[0-9a-f-]{36}$/i.test(sid)) {
      session.current = sid;
      apiFetch(`/api/meta/assets/finish?session=${encodeURIComponent(sid)}`)
        .then((r) => r.json())
        .then((c: { assets?: Choice[] }) => {
          const list = Array.isArray(c.assets) ? c.assets : [];
          setChoices(list);
          setPicked(list.map((a) => a.id));
        })
        .catch((err) => { console.error(`[meta ${kind}] choices failed:`, err); toast.error(errorText(err, 'This choice has expired. Press Connect again.')); clearQuery(); });
    }
  }, [params, kind, w.button, load, onChanged, clearQuery]);

  async function connect() {
    if (busy) return;
    setBusy('connect');
    try {
      const res = await apiFetch('/api/meta/social-connect/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: kind }) });
      const { url } = (await res.json()) as { url?: string };
      if (!url || !url.startsWith('https://www.facebook.com/')) throw new Error('Meta did not return a login address.');
      window.location.assign(url);
    } catch (err) {
      console.error(`[meta ${kind}] start failed:`, err);
      toast.error(errorText(err, 'Could not start the connection.'));
      setBusy(null);
    }
  }

  async function finish() {
    if (busy || !session.current || picked.length === 0) return;
    setBusy('finish');
    try {
      const res = await apiFetch('/api/meta/assets/finish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: session.current, ids: picked }) });
      const out = (await res.json()) as { saved?: number };
      toast.success(`Connected ${out.saved ?? picked.length} ${(out.saved ?? picked.length) === 1 ? w.one : w.many}.`);
      setChoices(null);
      await load();
      onChanged?.();
      clearQuery();
    } catch (err) {
      console.error(`[meta ${kind}] finish failed:`, err);
      toast.error(errorText(err, 'Could not save the connection.'));
    } finally { setBusy(null); }
  }

  async function act(item: Item, action: 'default' | 'check') {
    if (busy) return;
    setBusy(`${action}:${item.id}`);
    try {
      await apiFetch(`/api/meta/assets/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, action }) });
      if (action === 'default') toast.success(`${item.name ?? item.externalId} is now the default.`);
      await load();
      if (action === 'default') onChanged?.();
    } catch (err) {
      console.error(`[meta ${kind}] ${action} failed:`, err);
      toast.error(errorText(err, action === 'default' ? 'Could not change the default.' : 'Could not check it.'));
    } finally { setBusy(null); }
  }

  async function remove(item: Item) {
    if (busy) return;
    const ok = await confirm({
      title: `Remove ${item.name ?? item.externalId}?`,
      description: kind === 'ads'
        ? 'Its spend stops showing in reports here. Nothing changes in Meta, and past leads keep their ad.'
        : 'Products from this catalog stop being offered here. Nothing changes in Meta.',
      confirmLabel: 'Remove', variant: 'destructive',
    });
    if (!ok) return;
    setBusy(`remove:${item.id}`);
    try {
      await apiFetch(`/api/meta/assets/${item.id}?kind=${kind}`, { method: 'DELETE' });
      toast.success('Removed.');
      await load();
      onChanged?.();
    } catch (err) {
      console.error(`[meta ${kind}] remove failed:`, err);
      toast.error(errorText(err, 'Could not remove it.'));
    } finally { setBusy(null); }
  }

  return (
    <section aria-labelledby={`meta-assets-${kind}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`meta-assets-${kind}`} className="text-[14px] font-semibold text-slate-800">Connected {w.many}</h3>
          <p className="mt-0.5 text-[12px] text-slate-500">
            {kind === 'ads'
              ? 'Connect one or more ad accounts. Spend and cost per lead use all of them; the default is used where one account is needed.'
              : 'Connect one or more catalogs. The default is used when sending products.'}
          </p>
        </div>
        {ready ? (
          <Button type="button" onClick={() => void connect()} disabled={busy !== null} className="h-10 rounded-xl bg-[#0866FF] px-4 text-[13px] font-semibold text-white hover:bg-[#0655d1]">
            {busy === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plug className="h-4 w-4" aria-hidden="true" />}
            {items && items.length > 0 ? `Add ${w.many}` : w.button}
          </Button>
        ) : null}
      </div>

      {!ready && items !== null && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
          One-click {w.button.replace('Connect ', '').toLowerCase()} connect is not set up on this server yet. Use Manual Connect below, or ask the server owner to add the {kind === 'ads' ? 'Ads' : 'Catalog'} configuration ID (Settings → Embedded Signup).
        </p>
      )}

      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-800">{error}</p>}

      {items === null ? (
        <div className="mt-3 h-16 animate-pulse rounded-xl bg-slate-100" aria-busy="true" aria-label={`Loading ${w.many}`} />
      ) : items.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-slate-500">No {w.many} connected yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((it) => (
            <li key={it.id} className="flex flex-col gap-2 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
              <div className="w-full min-w-0 sm:flex-1">
                <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-slate-800">
                  <span className="truncate" title={it.name ?? it.externalId}>{it.name ?? it.externalId}</span>
                  {it.isDefault && <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-indigo-700"><Star className="h-3 w-3" aria-hidden="true" />Default</span>}
                </p>
                <p className="truncate text-[11.5px] text-slate-500">
                  {[`ID ${it.externalId}`, it.currency, it.timezone, it.productCount != null ? `${it.productCount} products` : null].filter(Boolean).join(' · ')}
                </p>
                <p className={`mt-0.5 inline-flex items-center gap-1 text-[11.5px] ${it.health.level === 'ok' ? 'text-emerald-700' : it.health.level === 'warn' ? 'text-amber-700' : it.health.level === 'error' ? 'text-rose-700' : 'text-slate-500'}`}>
                  {it.health.level === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : it.health.level === 'warn' ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> : it.health.level === 'error' ? <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> : <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />}
                  {it.health.text}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5 sm:shrink-0">
                {!it.isDefault && (
                  <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void act(it, 'default')}>
                    {busy === `default:${it.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Star className="h-3.5 w-3.5" aria-hidden="true" />} Make default
                  </Button>
                )}
                <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void act(it, 'check')} aria-label={`Check ${it.name ?? it.externalId}`}>
                  {busy === `check:${it.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} Check
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void remove(it)} className="text-rose-700 hover:text-rose-800" aria-label={`Remove ${it.name ?? it.externalId}`}>
                  {busy === `remove:${it.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />} Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {choices && (
        <Dialog open onOpenChange={(o) => { if (!o && busy !== 'finish') { setChoices(null); clearQuery(); } }}>
          <DialogContent className="bg-white sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Choose the {w.many} to connect</DialogTitle>
              <DialogDescription>You shared more than one. Tick the ones this workspace should use.</DialogDescription>
            </DialogHeader>
            <fieldset className="min-w-0 max-h-[50vh] space-y-1.5 overflow-y-auto overscroll-contain">
              <legend className="sr-only">{w.many}</legend>
              {choices.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-[13px] hover:bg-slate-50">
                  <input type="checkbox" checked={picked.includes(c.id)} onChange={(e) => setPicked((p) => e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id))} />
                  <span className="min-w-0 flex-1 truncate" title={c.name}>{c.name}</span>
                  <span className="shrink-0 text-[11px] text-slate-500">{c.currency ?? (c.productCount != null ? `${c.productCount} products` : '')}</span>
                </label>
              ))}
            </fieldset>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy === 'finish'} onClick={() => { setChoices(null); clearQuery(); }}>Cancel</Button>
              <Button type="button" disabled={busy === 'finish' || picked.length === 0} onClick={() => void finish()}>
                {busy === 'finish' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Connect {picked.length || ''}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
