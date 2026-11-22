'use client';

/**
 * "Connect Instagram" (Instagram card) and "Connect Messenger" (Facebook
 * card) — the one-click way (Facebook Login for Business, one configuration
 * per channel; each button connects only its own channel), the chooser when
 * several Pages / accounts were shared, and the
 * connection health card: what works, what to do, Reconnect, Human agent
 * replies, Disconnect. The token paste (Manual Connect) stays beside it.
 * Everything is checked again on the server (/api/meta/social-connect/*).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, CircleHelp, Loader2, Plug, RefreshCw, Unplug, XCircle, Download } from 'lucide-react';
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
interface Status { oneClickReady: boolean; oneClick?: Record<Channel, boolean>; facebook: ChannelStatus; instagram: ChannelStatus }

const LABEL: Record<Channel, string> = { facebook: 'Messenger', instagram: 'Instagram' };

/** Whether this channel's one-click button can be shown on this server. */
function canConnect(s: Status, channel: Channel): boolean {
  return s.oneClick ? s.oneClick[channel] === true : s.oneClickReady === true;
}

async function startConnect(channel: Channel): Promise<void> {
  const res = await apiFetch('/api/meta/social-connect/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel }),
  });
  const { url } = (await res.json()) as { url?: string };
  if (!url || !url.startsWith('https://www.facebook.com/')) throw new Error('Meta did not return a login address.');
  window.location.assign(url);
}

/**
 * "Connect Instagram" / "Connect Messenger" — shown only when the server
 * owner has set up that channel's configuration. `unavailableText` is shown
 * instead when it is not (otherwise nothing).
 */
export function MetaSocialConnectButton({ channel, className, unavailableText }: Readonly<{ channel: Channel; className?: string; unavailableText?: string }>) {
  const [ready, setReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    apiFetch('/api/meta/social-connect')
      .then((r) => r.json())
      .then((s: Status) => { if (alive) setReady(canConnect(s, channel)); })
      .catch(() => { if (alive) setReady(false); });
    return () => { alive = false; };
  }, [channel]);
  if (ready === false && unavailableText) return <p className="text-[12.5px] text-slate-500">{unavailableText}</p>;
  if (!ready) return null;
  return (
    <Button type="button" disabled={busy} className={className}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try { await startConnect(channel); } catch (err) {
          console.error('[meta connect] start failed:', err);
          toast.error(errorText(err, 'Could not start the connection.'));
          setBusy(false);
        }
      }}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plug className="h-4 w-4" aria-hidden="true" />}
      Connect {LABEL[channel]}
    </Button>
  );
}

/**
 * What each ?code=… from the connect redirect means. Only these fixed
 * texts are ever shown: free text in the URL is ignored, so a crafted
 * link cannot put its own words on this screen.
 */
const CONNECT_ERRORS: Record<string, string> = {
  not_owner: 'Sign in as the workspace owner, then press Connect again.',
  expired: 'This connection link is not valid or has expired. Press Connect again.',
  no_code: 'Meta did not finish the sign-in. Press Connect again.',
  no_app: 'The Meta App is not set up on this server yet.',
  bad_token: 'Meta returned a sign-in that is not valid. Press Connect again.',
  nothing_shared: 'No Facebook Page or Instagram professional account was shared. Press Connect again and tick your Page or Instagram account.',
  no_instagram: 'No Instagram professional account was shared. Press Connect Instagram again and tick your Instagram account.',
  no_page: 'No Facebook Page was shared. Press Connect Messenger again and tick your Page.',
  failed: 'The connection did not finish. Press Connect again.',
};

/** Reads ?meta_connect=… after Meta's redirect: a message, or the chooser. */
export function MetaConnectReturn({ onDone }: Readonly<{ onDone: () => void }>) {
  const params = useSearchParams();
  const router = useRouter();
  const result = params.get('meta_connect');
  const session = params.get('session');
  const code = params.get('code');
  const shown = useRef(false);
  const [choices, setChoices] = useState<{ channel: Channel | null; pages: Array<{ id: string; name: string; igId: string | null }>; instagram: Array<{ id: string; username: string | null; name: string | null }> } | null>(null);
  const [pageId, setPageId] = useState<string>('');
  const [igId, setIgId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const clearQuery = useCallback(() => router.replace('/settings?tab=channels', { scroll: false }), [router]);

  useEffect(() => {
    if (!result || shown.current) return;
    shown.current = true;
    if (result === 'connected') { toast.success('Connected.'); onDone(); clearQuery(); }
    else if (result === 'partial') { toast.warning('Connected, but something needs attention — see the status below.'); onDone(); clearQuery(); }
    else if (result === 'cancelled') { toast.info('Connection cancelled — nothing was changed.'); clearQuery(); }
    else if (result === 'error') { toast.error((code && Object.hasOwn(CONNECT_ERRORS, code) ? CONNECT_ERRORS[code] : null) ?? CONNECT_ERRORS.failed); clearQuery(); }
    else if (result === 'choose' && session && /^[0-9a-f-]{36}$/i.test(session)) {
      apiFetch(`/api/meta/social-connect/finish?session=${encodeURIComponent(session)}`)
        .then((r) => r.json())
        .then((c: NonNullable<typeof choices>) => {
          const channel = c?.channel === 'facebook' || c?.channel === 'instagram' ? c.channel : null;
          const pages = channel === 'instagram' ? [] : Array.isArray(c?.pages) ? c.pages : [];
          const instagram = channel === 'facebook' ? [] : Array.isArray(c?.instagram) ? c.instagram : [];
          setChoices({ channel, pages, instagram });
          setPageId(pages[0]?.id ?? '');
          setIgId(channel === 'instagram' ? instagram[0]?.id ?? '' : pages[0]?.igId ?? instagram[0]?.id ?? '');
        })
        .catch((err) => { console.error('[meta connect] choices failed:', err); toast.error(errorText(err, 'This choice has expired. Press Connect again.')); clearQuery(); });
    }
  }, [result, session, code, onDone, clearQuery]);

  if (!choices) return null;
  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/meta/social-connect/finish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session,
          page_id: choices?.channel === 'instagram' ? null : pageId || null,
          instagram_id: choices?.channel === 'facebook' ? null : igId || null,
        }),
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
          <DialogTitle>{choices.channel === 'instagram' ? 'Choose the Instagram account' : choices.channel === 'facebook' ? 'Choose the Facebook Page' : 'Choose what to connect'}</DialogTitle>
          <DialogDescription>
            {choices.channel === 'instagram'
              ? 'You shared more than one. Pick the Instagram account for this workspace.'
              : choices.channel === 'facebook'
                ? 'You shared more than one. Pick the Page whose Messenger chats come to this workspace.'
                : 'You shared more than one. Pick the Facebook Page and Instagram account for this workspace.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {choices.channel !== 'instagram' && (
          <fieldset className="min-w-0 space-y-1.5">
            <legend className="mb-1 text-[12px] font-semibold text-slate-600">Facebook Page (Messenger)</legend>
            {[...(choices.channel === null ? [{ id: '', name: 'Do not connect a Page', igId: null }] : []), ...choices.pages].map((p) => (
              <label key={p.id || 'none'} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-[13px] hover:bg-slate-50">
                <input type="radio" name="meta-page" value={p.id} checked={pageId === p.id} onChange={() => { setPageId(p.id); if (p.igId && choices.channel === null) setIgId(p.igId); }} />
                <span className="min-w-0 truncate" title={p.name}>{p.name}</span>
              </label>
            ))}
          </fieldset>
          )}
          {choices.channel !== 'facebook' && (
          <fieldset className="min-w-0 space-y-1.5">
            <legend className="mb-1 text-[12px] font-semibold text-slate-600">Instagram account</legend>
            {[...(choices.channel === null ? [{ id: '', username: null, name: 'Do not connect Instagram' }] : []), ...choices.instagram].map((a) => (
              <label key={a.id || 'none'} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-[13px] hover:bg-slate-50">
                <input type="radio" name="meta-ig" value={a.id} checked={igId === a.id} onChange={() => setIgId(a.id)} />
                <span className="min-w-0 truncate">{a.username ? `@${a.username}` : a.name}</span>
              </label>
            ))}
          </fieldset>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => { setChoices(null); clearQuery(); }}>Cancel</Button>
          <Button type="button" disabled={saving || (choices.channel === 'instagram' ? !igId : choices.channel === 'facebook' ? !pageId : !pageId && !igId)} onClick={() => void save()}>
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

  async function importChats() {
    if (busy) return;
    setBusy('import');
    try {
      const res = await apiFetch('/api/meta/social-import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel }) });
      const r = (await res.json()) as { conversations?: number; messages?: number };
      toast.success(`Imported ${r.conversations ?? 0} chats and ${r.messages ?? 0} new messages into the Inbox.`);
    } catch (err) {
      console.error('[meta connect] import failed:', err);
      toast.error(errorText(err, 'Could not import the chats.'));
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
              ? <>Connected{s.name ? <> to <span className="font-medium text-slate-700">{s.name}</span></> : null}{s.via === 'login' ? ` with Connect ${LABEL[channel]}` : ' with a pasted token'}.</>
              : 'Not connected.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canConnect(status, channel) && (
            <Button type="button" variant="outline" size="sm" disabled={busy !== null}
              onClick={async () => { setBusy('reconnect'); try { await startConnect(channel); } catch (err) { console.error(err); toast.error(errorText(err, 'Could not start the connection.')); setBusy(null); } }}>
              {busy === 'reconnect' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
              {s.connected ? 'Reconnect' : 'Connect'}
            </Button>
          )}
          {s.connected && (
            <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void importChats()}
              title="Brings the 50 most recent chats into the Inbox. Safe to run again.">
              {busy === 'import' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Download className="h-3.5 w-3.5" aria-hidden="true" />}
              Import recent chats
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
