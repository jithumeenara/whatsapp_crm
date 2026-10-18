'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Repeat, ShieldCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch, errorText } from '@/lib/api-fetch';
import type { AudienceConfig } from './step2-select-audience';

/**
 * Step 2 of a follow-up: the audience is one group of an earlier broadcast,
 * set by the report's "Send follow-up". Shown, not picked, so the people a
 * reminder goes to are the people the report showed.
 */
export function FollowUpAudience({ audience, onChangeAudience, onNext, onBack }: {
  audience: AudienceConfig;
  onChangeAudience: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    // The group is fixed while this step is open (choosing another
    // audience unmounts it), so there is no earlier count to clear.
    let live = true;
    apiFetch('/api/broadcasts/audience-count', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: audience.type, fromBroadcast: audience.fromBroadcast, listId: audience.listId }),
    })
      .then((r) => r.json())
      .then((j: { count?: number | null }) => { if (live) setCount(j.count ?? 0); })
      .catch((err) => {
        console.error('[follow-up] count failed:', err);
        if (live) setError(errorText(err, 'Could not count this group.'));
      });
    return () => { live = false; };
  }, [audience.type, audience.fromBroadcast, audience.listId]);

  const empty = count === 0;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[16px] font-semibold text-slate-900">Audience</h2>
        <p className="mt-0.5 text-[13px] text-slate-500">This follow-up goes to one group from the first broadcast.</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
            <Repeat className="h-4 w-4 text-indigo-700" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-slate-800 break-words">{audience.label ?? 'Follow-up group'}</p>
            <p className="mt-0.5 text-[12.5px] text-slate-500" aria-live="polite">
              {error ? <span className="text-rose-700">{error}</span>
                : count === null ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Counting…</span>
                : empty ? 'Nobody in this group can get a message now.'
                : <><span className="font-semibold tabular-nums text-slate-700">{count.toLocaleString()}</span> {count === 1 ? 'person' : 'people'} will get it.</>}
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden />
          <p className="text-[11.5px] text-emerald-800">
            Anyone who replies to the first message before this goes out is left out automatically, and people who opted out or are blocked never get it.
          </p>
        </div>
      </div>

      <button type="button" onClick={onChangeAudience} className="text-[12.5px] font-medium text-indigo-700 hover:underline">
        Choose a different audience instead
      </button>

      <div className="flex items-center justify-between border-t border-slate-200 pt-4">
        <Button variant="outline" onClick={onBack} className="h-9 border-slate-200 text-slate-700">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back
        </Button>
        <Button onClick={onNext} disabled={count === null || empty || !!error}
          className="h-9 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
          Next: personalize <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
