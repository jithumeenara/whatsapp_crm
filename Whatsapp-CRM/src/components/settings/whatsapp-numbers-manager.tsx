'use client';

/**
 * Settings → Channels → WhatsApp: every connected number as a card with
 * its live health (quality, throughput, name review, Business app or Cloud
 * API), the business's shared messaging limit, renaming and the default
 * number — and two ways to add one: a new number, or a number already used
 * in the WhatsApp Business app, which keeps working on the phone
 * (coexistence; its chats and contacts are imported once).
 *
 * The selected number's full setup (`WhatsAppConfig`) shows below the
 * cards. docs/plans/whatsapp-multi-number-coexistence-plan.md.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Star, Smartphone, RefreshCw, Loader2, Pencil, Check, X, Cloud, AlertTriangle } from 'lucide-react';
import { WhatsAppConfig } from './whatsapp-config';
import { EmbeddedSignupButton } from './embedded-signup-button';
import { Button } from '@/components/ui/button';
import { apiFetch, errorText } from '@/lib/api-fetch';
import { everyWhileVisible } from '@/lib/visible-interval';

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(' '); }

interface Health {
  display_phone_number: string | null;
  verified_name: string | null;
  name_status: string | null;
  quality_rating: string | null;
  throughput: string | null;
  platform_type: string | null;
  is_on_biz_app: boolean;
  messaging_limit: string | null;
  error: string | null;
}
interface Coexistence {
  history_status: string;
  history_progress: number;
  history_messages: number;
  contacts_synced: number;
}
interface NumberRow {
  id: string;
  phone_number_id: string;
  label: string | null;
  is_default: boolean;
  status: string;
  connect_method: string;
  problem: string | null;
  token_ok: boolean;
  health: Health | null;
  coexistence: Coexistence | null;
}

const QUALITY: Record<string, { text: string; cls: string }> = {
  GREEN: { text: 'Quality high', cls: 'bg-emerald-50 text-emerald-700' },
  YELLOW: { text: 'Quality medium', cls: 'bg-amber-50 text-amber-800' },
  RED: { text: 'Quality low', cls: 'bg-rose-50 text-rose-700' },
};

/** Meta's limit names → what a person reads. */
function limitText(v: string | null): string | null {
  if (!v) return null;
  const m: Record<string, string> = {
    TIER_250: '250', TIER_1K: '1,000', TIER_2K: '2,000', TIER_10K: '10,000', TIER_100K: '1,00,000', TIER_UNLIMITED: 'Unlimited',
    UNLIMITED: 'Unlimited',
  };
  return m[v] ?? v.replace(/^TIER_/, '');
}

function importText(c: Coexistence): string {
  if (c.history_status === 'declined') return 'Chat history was not shared on the phone — only new messages appear.';
  if (c.history_status === 'failed') return 'Meta did not start the chat import. New messages still appear.';
  if (c.history_status === 'done') return `Imported ${c.history_messages.toLocaleString('en-IN')} past messages and ${c.contacts_synced.toLocaleString('en-IN')} contacts.`;
  if (c.history_status === 'importing') return `Importing past chats… ${c.history_progress}% · keep WhatsApp open on the phone.`;
  return 'Waiting for the phone to share chats and contacts (can take minutes to a few hours).';
}

export function WhatsAppNumbersManager(props: { defaultConnectMethod?: 'quick' | 'manual' }) {
  const [numbers, setNumbers] = useState<NumberRow[] | null>(null);
  const [limit, setLimit] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const loadSeq = useRef(0);

  const load = useCallback(async (fresh = false) => {
    const seq = ++loadSeq.current;
    try {
      const res = await apiFetch(`/api/whatsapp/numbers${fresh ? '?fresh=1' : ''}`, { cache: 'no-store' });
      const data = (await res.json()) as { numbers?: NumberRow[]; messaging_limit?: string | null };
      if (seq !== loadSeq.current) return;
      const list = Array.isArray(data.numbers) ? data.numbers : [];
      setNumbers(list);
      setLimit(data.messaging_limit ?? null);
      setLoadError(false);
      setSelectedId((prev) => {
        if (prev === null) return null;
        if (prev && list.some((n) => n.id === prev)) return prev;
        return (list.find((n) => n.is_default) ?? list[0])?.id ?? null;
      });
    } catch (err) {
      console.error('[whatsapp-numbers] load failed:', err);
      if (seq === loadSeq.current) { setLoadError(true); setNumbers((n) => n ?? []); }
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // While a Business app number is importing, check its progress now and then.
  const importing = (numbers ?? []).some((n) => n.coexistence && ['pending', 'importing'].includes(n.coexistence.history_status));
  useEffect(() => {
    if (!importing) return;
    return everyWhileVisible(() => { void load(); }, 20_000);
  }, [importing, load]);

  async function refresh() {
    setRefreshing(true);
    try { await load(true); } finally { setRefreshing(false); }
  }

  async function setDefault(id: string) {
    if (busy) return;
    setBusy(id);
    try {
      await apiFetch('/api/whatsapp/config/set-default', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
      });
      toast.success('Default number updated.');
      await load();
    } catch (err) {
      console.error('[whatsapp-numbers] set default failed:', err);
      toast.error(errorText(err, 'Could not set the default number.'));
    } finally {
      setBusy(null);
    }
  }

  async function saveLabel(id: string) {
    if (busy) return;
    setBusy(id);
    try {
      await apiFetch(`/api/whatsapp/numbers/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: draft }),
      });
      setEditing(null);
      toast.success('Name saved.');
      await load();
    } catch (err) {
      console.error('[whatsapp-numbers] rename failed:', err);
      toast.error(errorText(err, 'Could not save the name.'));
    } finally {
      setBusy(null);
    }
  }

  if (numbers === null) {
    return (
      <div className="flex items-center justify-center py-8 text-slate-400" role="status">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /><span className="sr-only">Loading numbers…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {numbers.length > 0 && (
        <section aria-labelledby="wa-numbers-title" className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
            <h3 id="wa-numbers-title" className="text-[14px] font-semibold text-slate-800">WhatsApp numbers</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 tabular-nums">{numbers.length}</span>
            {limitText(limit) && (
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700" title="Since Oct 2025 Meta gives one daily limit to the whole business, shared by every number.">
                Business limit {limitText(limit)} people a day · shared by all numbers
              </span>
            )}
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void refresh()} disabled={refreshing} aria-label="Check health again">
              <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} aria-hidden="true" />
              <span className="hidden sm:inline">Check again</span>
            </Button>
          </header>
          {loadError && <p className="px-5 pt-3 text-[12px] text-rose-700" role="alert">Could not load the numbers. Check again in a moment.</p>}
          <ul className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-3">
            {numbers.map((n) => {
              const h = n.health;
              const businessApp = n.connect_method === 'coexistence' || h?.is_on_biz_app;
              const q = h?.quality_rating ? QUALITY[h.quality_rating] : null;
              const title = n.label || h?.verified_name || 'WhatsApp number';
              const selected = selectedId === n.id;
              const disconnected = n.status !== 'connected';
              return (
                <li key={n.id} className={cn('flex min-w-0 flex-col gap-2 rounded-xl border p-3.5', selected ? 'border-indigo-500 bg-indigo-50/40' : 'border-slate-200 bg-white')}>
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', businessApp ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600')} aria-hidden="true">
                      {businessApp ? <Smartphone className="h-4 w-4" /> : <Cloud className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      {editing === n.id ? (
                        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); void saveLabel(n.id); }}>
                          <label htmlFor={`wa-label-${n.id}`} className="sr-only">Name for this number</label>
                          <input id={`wa-label-${n.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={40} autoFocus
                            placeholder="Admissions, Support…" className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 px-2 text-[13px]" />
                          <Button type="submit" size="icon-sm" variant="ghost" aria-label="Save name" disabled={busy === n.id}><Check className="h-4 w-4" aria-hidden="true" /></Button>
                          <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancel" onClick={() => setEditing(null)}><X className="h-4 w-4" aria-hidden="true" /></Button>
                        </form>
                      ) : (
                        <div className="flex min-w-0 items-center gap-1">
                          <p className="truncate text-[13.5px] font-semibold text-slate-800" title={title}>{title}</p>
                          {n.is_default && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label="Default number" />}
                          <Button size="icon-xs" variant="ghost" aria-label={`Rename ${title}`} onClick={() => { setEditing(n.id); setDraft(n.label ?? ''); }}>
                            <Pencil className="h-3 w-3" aria-hidden="true" />
                          </Button>
                        </div>
                      )}
                      <p className="text-[12px] text-slate-500 tabular-nums">{h?.display_phone_number ?? `ID ${n.phone_number_id}`}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {disconnected ? (
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">Disconnected</span>
                    ) : (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Connected</span>
                    )}
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', businessApp ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600')}>
                      {businessApp ? 'Business app + CRM · 20/s' : 'Cloud API'}
                    </span>
                    {q && <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', q.cls)}>{q.text}</span>}
                    {h?.throughput === 'HIGH' && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">High speed · 1,000/s</span>}
                    {h?.name_status && h.name_status !== 'APPROVED' && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Name {h.name_status.toLowerCase().replace(/_/g, ' ')}</span>
                    )}
                  </div>

                  {(n.problem && disconnected) && <p className="text-[11.5px] leading-relaxed text-rose-700">{n.problem}</p>}
                  {!n.token_ok && <p className="flex items-start gap-1 text-[11.5px] text-rose-700"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />The saved access for this number cannot be read. Connect it again.</p>}
                  {h?.error && n.token_ok && <p className="text-[11.5px] text-amber-800">{h.error === 'token' ? 'Meta did not accept the saved access — connect this number again.' : 'Could not read live health from Meta right now.'}</p>}

                  {n.coexistence && (
                    <div className="space-y-1">
                      {['pending', 'importing'].includes(n.coexistence.history_status) && (
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={n.coexistence.history_progress} aria-label="Chat import">
                          <div className="h-full rounded-full bg-emerald-500 transition-[width] motion-reduce:transition-none" style={{ width: `${Math.max(4, n.coexistence.history_progress)}%` }} />
                        </div>
                      )}
                      <p className="text-[11.5px] leading-relaxed text-slate-500" role="status">{importText(n.coexistence)}</p>
                      <p className="text-[11px] leading-relaxed text-slate-400">Open WhatsApp Business on the phone at least once every 2 weeks, or Meta disconnects it.</p>
                    </div>
                  )}

                  <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                    <Button size="sm" variant={selected ? 'secondary' : 'outline'} onClick={() => setSelectedId(n.id)} aria-pressed={selected}>
                      {selected ? 'Showing setup' : 'Manage'}
                    </Button>
                    {!n.is_default && (
                      <Button size="sm" variant="ghost" onClick={() => void setDefault(n.id)} disabled={busy === n.id}>
                        {busy === n.id ? 'Saving…' : 'Make default'}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}

            <li className={cn('flex min-w-0 flex-col gap-2 rounded-xl border border-dashed p-3.5', selectedId === null ? 'border-indigo-500 bg-indigo-50/40' : 'border-slate-300')}>
              <p className="flex items-center gap-1.5 text-[13.5px] font-semibold text-slate-800"><Plus className="h-4 w-4" aria-hidden="true" />Add number</p>
              <Button size="sm" variant="outline" className="justify-start" onClick={() => setSelectedId(null)}>
                <Cloud className="h-3.5 w-3.5" aria-hidden="true" />A new number (Cloud API)
              </Button>
              <EmbeddedSignupButton mode="business_app" label="My WhatsApp Business app number" onConnected={() => void load(true)}
                className="h-8 justify-start rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[12.5px] font-semibold text-emerald-800 hover:bg-emerald-100" />
              <p className="text-[11px] leading-relaxed text-slate-500">
                Keep using WhatsApp Business on the phone; chats show here too. Needs app 2.24.17+. WhatsApp Web logs out once (link it again);
                broadcast lists become read-only; disappearing and view-once messages turn off. Past 6 months of chats are imported once.
              </p>
            </li>
          </ul>
        </section>
      )}

      <WhatsAppConfig
        key={selectedId ?? 'new'}
        defaultConnectMethod={props.defaultConnectMethod}
        configId={selectedId === undefined ? undefined : selectedId}
        onChanged={() => void load()}
      />
    </div>
  );
}
