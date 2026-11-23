'use client';

/**
 * "Re-rank search results" — a small fast model re-orders the knowledge
 * the search found by how well it answers the exact question
 * (lib/ai/rerank.ts). Off by default; it adds a model call to each reply.
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ListOrdered } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { apiFetch, errorText } from '@/lib/api-fetch';

type State = { rerank: boolean; ready: boolean };

export function RerankSetting() {
  const [state, setState] = useState<State | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setState((await (await apiFetch('/api/ai-config/retrieval', { cache: 'no-store' })).json()) as State);
    } catch (err) {
      console.error('[rerank-setting] load failed:', err);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function change(rerank: boolean) {
    if (saving || !state) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/ai-config/retrieval', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rerank }),
      });
      setState((await res.json()) as State);
      toast.success(rerank ? 'Re-ranking turned on' : 'Re-ranking turned off');
    } catch (err) {
      console.error('[rerank-setting] save failed:', err);
      toast.error(errorText(err, 'Could not save.'));
    } finally {
      setSaving(false);
    }
  }

  if (!state) return null;

  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl bg-[#F7F8FC] p-3.5 ring-1 ring-slate-200/70">
      <div className="flex min-w-0 items-start gap-2.5">
        <ListOrdered className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
        <div className="min-w-0">
          <label htmlFor="rerank-switch" className="block text-[13px] font-medium text-slate-800">Re-rank search results</label>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">
            A small, fast model puts the knowledge that best answers the exact question first. Helps when
            several entries look alike. Adds about a second and a small cost to each reply — check the
            Accuracy tab before and after.
          </p>
          {!state.ready && (
            <p className="mt-1 text-[11.5px] text-amber-700">Needs a Gemini key and search by meaning.</p>
          )}
        </div>
      </div>
      <Switch
        id="rerank-switch"
        checked={state.rerank}
        disabled={saving || (!state.ready && !state.rerank)}
        onCheckedChange={(v) => void change(v)}
        aria-label="Re-rank search results"
      />
    </div>
  );
}
