'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Zap, Plus, Pause, Play, Tag as TagIcon, Clock, ChevronRight, Loader2 } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { apiFetch, errorText } from '@/lib/api-fetch';
import type { Broadcast } from '@/types';

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(' ') }

/** "2 hours", "1 day", "right away". */
export function waitText(minutes: number | null | undefined): string {
  const m = minutes ?? 0;
  if (m <= 0) return 'right away';
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? '' : 's'}`;
  if (m % 60 === 0) return `${m / 60} hour${m === 60 ? '' : 's'}`;
  return `${m} minute${m === 1 ? '' : 's'}`;
}

const STATE: Record<string, { label: string; tone: string }> = {
  active: { label: 'Active', tone: 'bg-emerald-50 text-emerald-700' },
  sending: { label: 'Sending…', tone: 'bg-indigo-50 text-indigo-700' },
  paused: { label: 'Paused', tone: 'bg-slate-100 text-slate-600' },
  failed: { label: 'Stopped', tone: 'bg-rose-50 text-rose-700' },
  cancelled: { label: 'Cancelled', tone: 'bg-slate-100 text-slate-600' },
};

/**
 * Broadcasts → Event-based: messages that go by themselves when a tag is
 * added to or removed from someone (src/lib/broadcasts/events.ts).
 */
export function EventBroadcasts({ items, onChanged }: { items: Broadcast[]; onChanged: (b: Pick<Broadcast, 'id' | 'status'>) => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function act(b: Broadcast, action: 'pause' | 'resume') {
    setBusy(b.id);
    try {
      const res = await apiFetch(`/api/broadcasts/${b.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const d = (await res.json()) as { status: Broadcast['status'] };
      onChanged({ id: b.id, status: d.status });
      toast.success(action === 'pause' ? 'Paused — nothing more goes until you resume' : 'Resumed');
    } catch (err) {
      console.error('[events] change failed:', err);
      toast.error(errorText(err, 'Could not change it'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-slate-800">Send when something happens</p>
          <p className="text-[12.5px] text-slate-500">
            For example: when the tag “Paid” is added, send the welcome message an hour later. Each person gets it once.
          </p>
        </div>
        <Link href="/broadcasts/new?mode=event" className={cn(buttonVariants({ variant: 'default' }))}>
          <Plus aria-hidden /> New event-based message
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-slate-200 bg-white px-6 py-12 text-center">
          <Zap className="mb-3 h-8 w-8 text-slate-300" aria-hidden />
          <p className="text-[14px] font-semibold text-slate-700">No event-based messages yet</p>
          <p className="mt-1 max-w-sm text-[12.5px] text-slate-500">Tags can be added by your team, a chatbot, an automation, an ad form or an import — any of them can start one.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((b) => {
            const st = STATE[b.status] ?? STATE.active;
            const canPause = b.status === 'active' || b.status === 'sending';
            const canResume = b.status === 'paused' || b.status === 'failed';
            return (
              <li key={b.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50">
                    <Zap className="h-4 w-4 text-amber-800" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/broadcasts/${b.id}`} className="truncate text-[14px] font-semibold text-slate-800 hover:underline">{b.name}</Link>
                      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', st.tone)}>{st.label}</span>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-slate-600">
                      <span className="inline-flex items-center gap-1">
                        <TagIcon className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                        When “{b.event_tag?.name ?? 'a deleted tag'}” is {b.event_trigger === 'tag_removed' ? 'removed' : 'added'}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                        send {waitText(b.event_delay_minutes)}{b.event_delay_minutes ? ' later' : ''}
                        {b.send_window ? `, between ${b.send_window.replace('-', ' and ')}` : ''}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[12px] text-slate-500">
                      <span className="tabular-nums">{b.sent_count.toLocaleString()}</span> sent ·{' '}
                      <span className="tabular-nums">{b.replied_count.toLocaleString()}</span> replied · template {b.template_name}
                    </p>
                    {b.status === 'failed' && (
                      <p className="mt-1 text-[12px] text-rose-700">Stopped after a sending problem (often WhatsApp needs reconnecting). Fix it, then resume.</p>
                    )}
                    {!b.event_tag && <p className="mt-1 text-[12px] text-rose-700">Its tag was deleted, so it can no longer start.</p>}
                  </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 pl-12 sm:pl-0">
                    {canPause && (
                      <Button variant="outline" size="sm" disabled={busy === b.id} onClick={() => void act(b, 'pause')}>
                        {busy === b.id ? <Loader2 className="animate-spin" aria-hidden /> : <Pause aria-hidden />} Pause
                      </Button>
                    )}
                    {canResume && (
                      <Button variant="outline" size="sm" disabled={busy === b.id} onClick={() => void act(b, 'resume')}>
                        {busy === b.id ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />} Resume
                      </Button>
                    )}
                    <Link href={`/broadcasts/${b.id}`} className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }))} aria-label={`Open ${b.name}`}>
                      <ChevronRight aria-hidden />
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
