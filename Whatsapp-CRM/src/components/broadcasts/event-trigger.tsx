'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Loader2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch, errorText } from '@/lib/api-fetch';
import type { BroadcastSchedule } from '@/hooks/use-broadcast-sending';
import { WaitField, SendWindowField } from './timing-fields';

type EventCfg = NonNullable<BroadcastSchedule['event']>;

/**
 * Step 2 of an event-based message: when it goes — a tag added to or
 * removed from someone — how long after, and in which hours.
 */
export function EventTrigger({ schedule, onChange, onNext, onBack }: {
  schedule: BroadcastSchedule;
  onChange: (s: BroadcastSchedule) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [tags, setTags] = useState<{ id: string; name: string }[] | null>(null);
  const [error, setError] = useState('');
  const ev: EventCfg = schedule.event ?? { trigger: 'tag_added', tagId: '', delayValue: 0, delayUnit: 'minutes', includeExisting: false };
  const set = (patch: Partial<EventCfg>) => onChange({ ...schedule, type: 'event', event: { ...ev, ...patch } });

  useEffect(() => {
    let live = true;
    apiFetch('/api/tags', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { tags?: { id: string; name: string }[] }) => { if (live) setTags(d.tags ?? []); })
      .catch((err) => {
        console.error('[event] tags failed to load:', err);
        if (live) { setTags([]); setError(errorText(err, 'Could not load your tags.')); }
      });
    return () => { live = false; };
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[16px] font-semibold text-slate-900">When it is sent</h2>
        <p className="mt-0.5 text-[13px] text-slate-500">It goes by itself to each person, once, when this happens.</p>
      </div>

      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <fieldset>
          <legend className="mb-1.5 text-[11.5px] font-medium text-slate-600">When a tag is</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['tag_added', 'tag_removed'] as const).map((t) => (
              <label key={t} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[13px] ${ev.trigger === t ? 'border-indigo-500 bg-indigo-50 text-indigo-800' : 'border-slate-200 text-slate-700'}`}>
                <input type="radio" name="event-trigger" value={t} checked={ev.trigger === t} onChange={() => set({ trigger: t, includeExisting: t === 'tag_added' ? ev.includeExisting : false })} className="h-4 w-4 accent-indigo-600" />
                {t === 'tag_added' ? 'Added' : 'Removed'}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="event-tag" className="mb-1 block text-[11.5px] font-medium text-slate-600">Tag</label>
          {tags === null ? (
            <p className="flex items-center gap-1.5 text-[13px] text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading tags…</p>
          ) : tags.length === 0 ? (
            <p className="text-[13px] text-slate-500">{error || 'No tags yet. Create one in Settings → Contacts first.'}</p>
          ) : (
            <select id="event-tag" name="event-tag" value={ev.tagId} onChange={(e) => set({ tagId: e.target.value })}
              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100">
              <option value="">Choose a tag…</option>
              {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
        </div>

        <WaitField id="event-wait" label="Then wait" value={ev.delayValue} unit={ev.delayUnit}
          onChange={(v) => set({ delayValue: v.value, delayUnit: v.unit })} />

        <SendWindowField id="event-window" value={schedule.sendWindow ?? null}
          onChange={(v) => onChange({ ...schedule, type: 'event', event: ev, sendWindow: v })} />

        {ev.trigger === 'tag_added' && (
          <label className="flex cursor-pointer items-start gap-2.5">
            <input type="checkbox" checked={ev.includeExisting} onChange={(e) => set({ includeExisting: e.target.checked })} className="mt-0.5 h-4 w-4 accent-indigo-600" />
            <span className="text-[12.5px] text-slate-700">
              Also send to people who already have this tag
              <span className="block text-[11.5px] text-slate-500">Off: only people tagged from now on.</span>
            </span>
          </label>
        )}

        <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2">
          <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-800" aria-hidden />
          <p className="text-[11.5px] text-amber-900">
            If the {ev.trigger === 'tag_added' ? 'tag is removed' : 'tag is added back'} before the wait is over, that person is left out.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 pt-4">
        <Button variant="outline" onClick={onBack} className="h-9 border-slate-200 text-slate-700">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back
        </Button>
        <Button onClick={onNext} disabled={!ev.tagId} className="h-9 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
          Next: personalize <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

/** "When “Paid” is added, send 1 hour later, between 09:00 and 21:00." */
export function eventSummaryText(schedule: BroadcastSchedule, tagName: string | undefined): string {
  const ev = schedule.event;
  if (!ev) return '';
  const when = `When “${tagName ?? 'the tag'}” is ${ev.trigger === 'tag_added' ? 'added' : 'removed'}`;
  const wait = ev.delayValue > 0 ? `send ${ev.delayValue} ${ev.delayUnit} later` : 'send right away';
  const win = schedule.sendWindow ? `, between ${schedule.sendWindow.replace('-', ' and ')}` : '';
  return `${when}, ${wait}${win}.`;
}
