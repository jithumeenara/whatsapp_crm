'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  MessageCircle, Eye, CheckCircle2, Send, RotateCcw, PhoneOff, BellOff, SkipForward, Clock,
  MoreHorizontal, ListPlus, Tag as TagIcon, Download, Repeat, CornerLeftUp, Loader2, ChevronRight,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { apiFetch, errorText } from '@/lib/api-fetch';

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(' ') }

interface Group {
  key: string;
  label: string;
  means: string;
  followUp: boolean;
  count: number;
}

interface FollowUp {
  id: string;
  name: string;
  status: string;
  parent_outcome_label: string | null;
  total_recipients: number;
  sent_count?: number;
  replied_count?: number;
  scheduled_at: string | null;
  created_at: string;
}

interface OutcomeData {
  broadcast: { id: string; name: string; status: string };
  outcomes: Group[];
  followUps: FollowUp[];
  parent: { id: string; name: string; outcome_label: string | null } | null;
}

/** Look of each group — soft background + dark text (DESIGN.md §2). */
const LOOK: Record<string, { icon: React.ElementType; tone: string }> = {
  replied:           { icon: MessageCircle, tone: 'bg-violet-50 text-violet-700' },
  read_no_reply:     { icon: Eye,           tone: 'bg-emerald-50 text-emerald-700' },
  not_opened:        { icon: CheckCircle2,  tone: 'bg-indigo-50 text-indigo-700' },
  not_delivered_yet: { icon: Send,          tone: 'bg-sky-50 text-sky-700' },
  not_delivered:     { icon: RotateCcw,     tone: 'bg-amber-50 text-amber-800' },
  cannot_receive:    { icon: PhoneOff,      tone: 'bg-slate-100 text-slate-600' },
  opted_out:         { icon: BellOff,       tone: 'bg-rose-50 text-rose-700' },
  skipped:           { icon: SkipForward,   tone: 'bg-slate-100 text-slate-600' },
  waiting:           { icon: Clock,         tone: 'bg-slate-100 text-slate-600' },
};

const FOLLOW_UP_STATUS: Record<string, string> = {
  draft: 'Draft', scheduled: 'Scheduled', sending: 'Sending…', sent: 'Sent', failed: 'Failed', cancelled: 'Cancelled', cancelling: 'Cancelling…',
};

/**
 * "What happened" on a broadcast's report: everyone it went to, in one
 * group each, and what can be done with a group — send it a follow-up,
 * save it as a list, tag it, download it. Below, the follow-ups already
 * sent from here.
 */
export function OutcomeGroups({ broadcastId, refreshKey }: { broadcastId: string; refreshKey: number }) {
  const [data, setData] = useState<OutcomeData | null>(null);
  const [loadError, setLoadError] = useState('');
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const res = await apiFetch(`/api/broadcasts/${broadcastId}/outcomes`);
      const d = (await res.json()) as OutcomeData;
      if (seq !== loadSeq.current) return;
      setData(d);
      setLoadError('');
    } catch (err) {
      console.error('[broadcast] outcomes failed to load:', err);
      if (seq === loadSeq.current) setLoadError(errorText(err, 'Could not load the groups.'));
    }
  }, [broadcastId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  // Dialogs
  const [listFor, setListFor] = useState<Group | null>(null);
  const [tagFor, setTagFor] = useState<Group | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  async function download(g: Group) {
    setDownloading(g.key);
    try {
      const res = await apiFetch(`/api/broadcasts/${broadcastId}/export?outcome=${encodeURIComponent(g.key)}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(data?.broadcast.name ?? 'broadcast').replace(/[^a-z0-9]/gi, '_')}-${g.key}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error('[broadcast] group download failed:', err);
      toast.error(errorText(err, 'Download failed'));
    } finally {
      setDownloading(null);
    }
  }

  if (loadError && !data) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-[13px] text-rose-700 shadow-sm">
        {loadError} <button type="button" onClick={() => void load()} className="ml-1 font-medium text-indigo-700 hover:underline">Try again</button>
      </div>
    );
  }
  if (!data) return <div className="h-40 animate-pulse rounded-xl bg-white" aria-hidden />;

  const total = data.outcomes.reduce((n, g) => n + g.count, 0);
  const sending = data.broadcast.status === 'sending' || data.broadcast.status === 'cancelling';
  // Before the first broadcast has finished, a follow-up can still be
  // planned — it then goes automatically once the group is known.
  const finished = data.broadcast.status === 'sent' || data.broadcast.status === 'failed' || data.broadcast.status === 'active';
  // Follow-up groups always show (an empty one says so); the rest only
  // when somebody is in them.
  const shown = data.outcomes.filter((g) => g.followUp || g.count > 0);

  return (
    <div className="space-y-5">
      {data.parent && (
        <Link href={`/broadcasts/${data.parent.id}`}
          className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-2.5 text-[12.5px] text-indigo-800 hover:bg-indigo-100">
          <CornerLeftUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">
            Follow-up to “{data.parent.name}”{data.parent.outcome_label ? ` · sent to “${data.parent.outcome_label}”` : ''}
          </span>
        </Link>
      )}

      <section aria-labelledby="outcome-heading" className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-5 py-4">
          <h2 id="outcome-heading" className="text-[14px] font-semibold text-slate-800">What happened</h2>
          <p className="text-[11.5px] text-slate-500">
            Replies count for 3 days after it was sent.
            {sending && ' Still sending — the groups fill in as it goes.'}
          </p>
        </div>
        <ul className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((g) => {
            const look = LOOK[g.key] ?? LOOK.waiting;
            const Icon = look.icon;
            const pct = total ? Math.round((g.count / total) * 100) : 0;
            const canAct = g.count > 0;
            return (
              <li key={g.key} className="flex min-w-0 flex-col rounded-xl border border-slate-200 p-3.5">
                <div className="flex items-start gap-3">
                  <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', look.tone)}>
                    <Icon className="h-4 w-4" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-slate-800">{g.label}</p>
                    <p className="mt-0.5 text-[20px] font-bold leading-none tabular-nums text-slate-900">
                      {g.count.toLocaleString()}
                      <span className="ml-1.5 text-[11.5px] font-normal text-slate-500">{pct}%</span>
                    </p>
                  </div>
                  {canAct && (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 data-[popup-open]:bg-slate-100"
                        aria-label={`More for ${g.label}`}
                      >
                        <MoreHorizontal className="h-4 w-4" aria-hidden />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem onClick={() => setListFor(g)}><ListPlus aria-hidden /> Save as list</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTagFor(g)}><TagIcon aria-hidden /> Add a tag</DropdownMenuItem>
                        <DropdownMenuItem disabled={downloading === g.key} onClick={() => void download(g)}><Download aria-hidden /> Download</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                <p className="mt-2 flex-1 text-[11.5px] leading-snug text-slate-500">{g.means}</p>
                {g.followUp && ((canAct && !sending) || !finished ? (
                  <Link
                    href={`/broadcasts/new?followUp=${encodeURIComponent(broadcastId)}&outcome=${encodeURIComponent(g.key)}`}
                    className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-3 w-full')}
                  >
                    <Repeat aria-hidden /> {finished ? 'Send follow-up' : 'Plan follow-up'}
                  </Link>
                ) : (
                  <Button variant="outline" size="sm" className="mt-3 w-full" disabled>
                    <Repeat aria-hidden /> Send follow-up
                  </Button>
                ))}
              </li>
            );
          })}
        </ul>
      </section>

      {data.followUps.length > 0 && (
        <section aria-labelledby="followups-heading" className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <h2 id="followups-heading" className="border-b border-slate-100 px-5 py-4 text-[14px] font-semibold text-slate-800">
            Follow-ups sent from here
          </h2>
          <ul className="divide-y divide-slate-100">
            {data.followUps.map((f) => (
              <li key={f.id}>
                <Link href={`/broadcasts/${f.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-slate-800">{f.name}</p>
                    <p className="truncate text-[11.5px] text-slate-500">
                      {f.parent_outcome_label ? `To “${f.parent_outcome_label}” · ` : ''}
                      {FOLLOW_UP_STATUS[f.status] ?? f.status}
                      {' · '}
                      <span className="tabular-nums">{(f.sent_count ?? 0).toLocaleString()}</span> sent,{' '}
                      <span className="tabular-nums">{(f.replied_count ?? 0).toLocaleString()}</span> replied
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <SaveListDialog
        group={listFor}
        broadcast={data.broadcast}
        onClose={() => setListFor(null)}
      />
      <AddTagDialog
        group={tagFor}
        broadcastId={broadcastId}
        onClose={() => setTagFor(null)}
      />
    </div>
  );
}

function SaveListDialog({ group, broadcast, onClose }: {
  group: Group | null;
  broadcast: { id: string; name: string };
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (group) setName(`${broadcast.name} — ${group.label}`.slice(0, 120));
  }, [group, broadcast.name]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!group || saving) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/contact-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), fromBroadcast: { broadcastId: broadcast.id, outcome: group.key } }),
      });
      const d = (await res.json()) as { list?: { name: string; member_count: number } };
      toast.success(`Saved “${d.list?.name ?? name.trim()}” with ${(d.list?.member_count ?? 0).toLocaleString()} people`);
      onClose();
    } catch (err) {
      console.error('[broadcast] save as list failed:', err);
      toast.error(errorText(err, 'Could not save the list'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!group} onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Save as list</DialogTitle>
            <DialogDescription>
              Keeps these {group?.count.toLocaleString()} people as a list you can send to later, from Broadcasts → New → Saved list. The list does not change when the broadcast does.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="list-name">List name</Label>
            <Input id="list-name" name="list-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" required />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving && <Loader2 className="animate-spin" aria-hidden />} Save list
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddTagDialog({ group, broadcastId, onClose }: {
  group: Group | null;
  broadcastId: string;
  onClose: () => void;
}) {
  const [tags, setTags] = useState<{ id: string; name: string }[] | null>(null);
  const [tagId, setTagId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!group || tags !== null) return;
    apiFetch('/api/tags', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { tags?: { id: string; name: string }[] }) => setTags(d.tags ?? []))
      .catch((err) => {
        console.error('[broadcast] tags failed to load:', err);
        setTags([]);
        toast.error(errorText(err, 'Could not load your tags'));
      });
  }, [group, tags]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!group || !tagId || saving) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/broadcasts/${broadcastId}/outcomes/tag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome: group.key, tagId }),
      });
      const d = (await res.json()) as { tag: string; inGroup: number; added: number };
      const already = d.inGroup - d.added;
      toast.success(`Tagged ${d.added.toLocaleString()} ${d.added === 1 ? 'person' : 'people'} “${d.tag}”` + (already > 0 ? ` (${already.toLocaleString()} already had it)` : ''));
      onClose();
    } catch (err) {
      console.error('[broadcast] tag group failed:', err);
      toast.error(errorText(err, 'Could not add the tag'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!group} onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add a tag to “{group?.label}”</DialogTitle>
            <DialogDescription>
              Every person in this group gets the tag. Automations that start on “Tag added” run once for each person newly tagged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="group-tag">Tag</Label>
            {tags === null ? (
              <p className="flex items-center gap-1.5 text-[13px] text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading tags…</p>
            ) : tags.length === 0 ? (
              <p className="text-[13px] text-slate-500">No tags yet. Create one in Settings → Contacts first.</p>
            ) : (
              <select id="group-tag" name="group-tag" value={tagId} onChange={(e) => setTagId(e.target.value)} required
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-100">
                <option value="">Choose a tag…</option>
                {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving || !tagId}>
              {saving && <Loader2 className="animate-spin" aria-hidden />} Add tag
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
