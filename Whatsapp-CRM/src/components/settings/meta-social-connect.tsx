'use client';

/**
 * "Connect Facebook & Instagram" — the one-click way (Facebook Login for
 * Business), the chooser when several Pages / accounts were shared, and the
 * connection health card: what works, what to do, Reconnect, Human agent
 * replies, Disconnect. The token paste (Manual Connect) stays beside it.
 * Everything is checked again on the server (/api/meta/social-connect/*).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, CircleHelp, Loader2, Plug, RefreshCw, Unplug, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useConfirm } from '@/hooks/use-confirm';
import { apiFetch, errorText } from '@/lib/api-fetch';

type Channel = 'facebook' | 'instagram';
interface Feature { key: string; label: string; granted: boolean | null }
interface ChannelStatus {
  connected: boolean; name: string | null; via: string | null; humanAgent: boolean
  tokenValid: boolean | null; features: Feature[]; hints: string[]
}
interface Status { oneClickReady: boolean; facebook: ChannelStatus; instagram: ChannelStatus }

const LABEL: Record<Channel, string> = { facebook: 'Messenger', instagram: 'Instagram' };

async function startConnect(): Promise<void> {
  const res = await apiFetch('/api/meta/social-connect/start', { method: 'POST' });
  const { url } = (await res.json()) as { url?: string };
  if (!url || !url.startsWith('https://www.facebook.com/')) throw new Error('Meta did not return a login address.');
  window.location.assign(url);
}

/** The one-click button (shown only when the server owner has set it up). */
export function MetaSocialConnectButton({ className }: Readonly<{ className?: string }>) {
  const [ready, setReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    apiFetch('/api/meta/social-connect')
      .then((r) => r.json())
      .then((s: Status) => { if (alive) setReady(s.oneClickReady === true); })
      .catch(() => { if (alive) setReady(false); });
    return () => { alive = false; };
  }, []);
  if (!ready) return null;
  return (
    <Button type="button" disabled={busy} className={className}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try { await startConnect(); } catch (err) {
          console.error('[meta connect] start failed:', err);
          toast.error(errorText(err, 'Could not start the connection.'));
          setBusy(false);
        }
      }}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plug className="h-4 w-4" aria-hidden="true" />}
      Connect Facebook &amp; Instagram
    </Button>
  );
}

/** Reads ?meta_connect=… after Meta's redirect: a message, or the chooser. */
export function MetaConnectReturn({ onDone }: Readonly<{ onDone: () => void }>) {
  const params = useSearchParams();
  const router = useRouter();
  const result = params.get('meta_connect');
  const session = params.get('session');
  const reason = params.get('reason');
  const shown = useRef(false);
  const [choices, setChoices] = useState<{ pages: Array<{ id: string; name: string; igId: string | null }>; instagram: Array<{ id: string; username: string | null; name: string | null }> } | null>(null);
  const [pageId, setPageId] = useState<string>('');
  const [igId, setIgId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const clearQuery = useCallback(() => router.replace('/settings?tab=channels', { scroll: false }), [router]);

  useEffect(() => {
    if (!result || shown.current) return;
    shown.current = true;
    if (result === 'connected') { toast.success('Facebook & Instagram connected.'); onDone(); clearQuery(); }
    else if (result === 'partial') { toast.warning(reason ?? 'Connected, but something needs attention.'); onDone(); clearQuery(); }
    else if (result === 'cancelled') { toast.info('Connection cancelled — nothing was changed.'); clearQuery(); }
    else if (result === 'error') { toast.error(reason ?? 'The connection did not finish. Press Connect again.'); clearQuery(); }
    else if (result === 'choose' && session && /^[0-9a-f-]{36}$/i.test(session)) {
      apiFetch(`/api/meta/social-connect/finish?session=${encodeURIComponent(session)}`)
        .then((r) => r.json())
        .then((c: NonNullable<typeof choices>) => {
          const pages = Array.isArray(c?.pages) ? c.pages : [];
          const instagram = Array.isArray(c?.instagram) ? c.instagram : [];
          setChoices({ pages, instagram });
          setPageId(pages[0]?.id ?? '');
          setIgId(pages[0]?.igId ?? instagram[0]?.id ?? '');
        })
        .catch((err) => { console.error('[meta connect] choices failed:', err); toast.error(errorText(err, 'This choice has expired. Press Connect again.')); clearQuery(); });
    }
  }, [result, session, reason, onDone, clearQuery]);

  if (!choices) return null;
  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/meta/social-connect/finish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session, page_id: pageId || null, instagram_id: igId || null }),
      });
      const out = (await res.json()) as { facebook?: { connected: boolean; error?: string } | null; instagram?: { connected: boolean; error?: string } | null };
      const problems = [out.facebook?.error, out.instagram?.error].filter(Boolean);
      if (problems.length) toast.warning(problems.join(' '));
      else toast.success('Connected.');
      setChoices(null);
      onDone();
      clearQuery();
    } catch (err) {
      console.error('[meta connect] finish failed:', err);
      toast.error(errorText(err, 'Could not save the connection.'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) { setChoices(null); clearQuery(); } }}>
      <DialogContent className="bg-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose what to connect</DialogTitle>
          <DialogDescription>You shared more than one. Pick the Facebook Page and Instagram account for this workspace.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-[12px] font-semibold text-slate-600">Facebook Page (Messenger)</legend>
            {[{ id: '', name: 'Do not connect a Page', igId: null }, ...choices.pages].map((p) => (
              <label key={p.id || 'none'} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-[13px] hover:bg-slate-50">
                <input type="radio" name="meta-page" value={p.id} checked={pageId === p.id} onChange={() => { setPageId(p.id); if (p.igId) setIgId(p.igId); }} />
                <span className="min-w-0 truncate">{p.name}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-[12px] font-semibold text-slate-600">Instagram account</legend>
            {[{ id: '', username: null, name: 'Do not connect Instagram' }, ...choices.instagram].map((a) => (
              <label key={a.id || 'none'} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-[13px] hover:bg-slate-50">
                <input type="radio" name="meta-ig" value={a.id} checked={igId === a.id} onChange={() => setIgId(a.id)} />
                <span className="min-w-0 truncate">{a.username ? `@${a.username}` : a.name}</span>
              </label>
            ))}
          </fieldset>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => { setChoices(null); clearQuery(); }}>Cancel</Button>
          <Button type="button" disabled={saving || (!pageId && !igId)} onClick={() => void save()}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What works for this channel, what to do, Reconnect / Human agent / Disconnect. */
export function MetaSocialHealth({ channel }: Readonly<{ channel: Channel }>) {
  const confirm = useConfirm();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/meta/social-connect');
      setStatus((await res.json()) as Status);
      setError(null);
    } catch (err) {
      console.error('[meta connect] status failed:', err);
      setError(errorText(err, 'Could not read the connection status.'));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (error) return <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">{error}</p>;
  if (!status) return <div className="h-24 animate-pulse rounded-2xl bg-slate-100" aria-busy="true" aria-label="Loading connection status" />;
  const s = status[channel];

  async function toggleHumanAgent(on: boolean) {
    if (busy) return;
    if (on) {
      const ok = await confirm({
        title: 'Turn on Human agent replies?',
        description: 'Lets your team reply up to 7 days after the customer’s last message. Only turn this on after Meta has approved the Human Agent feature for your app — otherwise Meta refuses those replies.',
        confirmLabel: 'Turn on', variant: 'default',
      });
      if (!ok) return;
    }
    setBusy('human');
    try {
      await apiFetch('/api/meta/social-connect', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, human_agent: on }) });
      toast.success(on ? 'Human agent replies on.' : 'Human agent replies off.');
      await load();
    } catch (err) {
      console.error('[meta connect] human agent failed:', err);
      toast.error(errorText(err, 'Could not change the setting.'));
    } finally { setBusy(null); }
  }

  async function disconnect() {
    if (busy) return;
    const ok = await confirm({
      title: `Disconnect ${LABEL[channel]}?`,
      description: 'New messages stop arriving and replies stop going out. Your contacts, chats and history stay.',
      confirmLabel: 'Disconnect', variant: 'destructive',
    });
    if (!ok) return;
    setBusy('disconnect');
    try {
      await apiFetch('/api/meta/social-connect', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel }) });
      toast.success(`${LABEL[channel]} disconnected.`);
      await load();
    } catch (err) {
      console.error('[meta connect] disconnect failed:', err);
      toast.error(errorText(err, 'Could not disconnect.'));
    } finally { setBusy(null); }
  }

  return (
    <section aria-labelledby={`meta-health-${channel}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`meta-health-${channel}`} className="text-[14px] font-semibold text-slate-800">{LABEL[channel]} connection</h3>
          <p className="mt-0.5 text-[12px] text-slate-500">
            {s.connected
              ? <>Connected{s.name ? <> to <span className="font-medium text-slate-700">{s.name}</span></> : null}{s.via === 'login' ? ' with Connect Facebook & Instagram' : ' with a pasted token'}.</>
              : 'Not connected.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {status.oneClickReady && (
            <Button type="button" variant="outline" size="sm" disabled={busy !== null}
              onClick={async () => { setBusy('reconnect'); try { await startConnect(); } catch (err) { console.error(err); toast.error(errorText(err, 'Could not start the connection.')); setBusy(null); } }}>
              {busy === 'reconnect' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
              {s.connected ? 'Reconnect' : 'Connect'}
            </Button>
          )}
          {s.connected && (
            <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void disconnect()} className="text-rose-700 hover:text-rose-800">
              <Unplug className="h-3.5 w-3.5" aria-hidden="true" /> Disconnect
            </Button>
          )}
        </div>
      </div>

      {s.connected && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="What works">
          {s.features.map((f) => (
            <li key={f.key} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium ${f.granted === true ? 'bg-emerald-50 text-emerald-800' : f.granted === false ? 'bg-rose-50 text-rose-800' : 'bg-slate-100 text-slate-600'}`}>
              {f.granted === true ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : f.granted === false ? <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> : <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />}
              {f.label}<span className="sr-only">{f.granted === true ? ' allowed' : f.granted === false ? ' not allowed' : ' unknown'}</span>
            </li>
          ))}
        </ul>
      )}

      {s.hints.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {s.hints.map((h) => <li key={h} className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900">{h}</li>)}
        </ul>
      )}

      {s.connected && (
        <div className="mt-4 flex items-start justify-between gap-3 border-t border-slate-100 pt-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-slate-700">Human agent replies (up to 7 days)</p>
            <p className="text-[11.5px] text-slate-500">Only after Meta approves the Human Agent feature for your app.</p>
          </div>
          <Switch checked={s.humanAgent} disabled={busy !== null} onCheckedChange={(v) => void toggleHumanAgent(Boolean(v))} aria-label="Human agent replies" />
        </div>
      )}
    </section>
  );
}
