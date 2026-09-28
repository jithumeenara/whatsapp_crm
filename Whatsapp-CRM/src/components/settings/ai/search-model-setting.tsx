'use client';

/**
 * Which model finds knowledge by meaning — offered, not imposed.
 *
 * gemini-embedding-2 is newer; whether it answers *this* business better
 * is for the accuracy tests to say. Switching re-reads the whole knowledge
 * base with the new model (the two cannot be compared), so this says so
 * before it happens and shows how far the re-read has got.
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type State = { model: string; ready: number; total: number };

const MODELS: Array<{ value: string; label: string }> = [
  { value: 'gemini-embedding-001', label: 'Gemini Embedding 001 (proven)' },
  { value: 'gemini-embedding-2', label: 'Gemini Embedding 2 (newer)' },
];

export function SearchModelSetting({ available }: { available: boolean }) {
  const [state, setState] = useState<State | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-config/embedding-model', { cache: 'no-store' });
      if (res.ok) setState(await res.json());
    } catch {
      /* the setting just stays hidden */
    }
  }, []);

  useEffect(() => {
    if (available) void load();
  }, [available, load]);

  // While a re-read is under way, check on it.
  const reading = state !== null && state.total > 0 && state.ready < state.total;
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [reading, load]);

  async function confirmSwitch() {
    if (!pending) return;
    setSaving(true);
    try {
      const res = await fetch('/api/ai-config/embedding-model', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: pending }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not switch');
      setState(data);
      setPending(null);
      toast.success('Switched. Re-reading your knowledge with the new model.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not switch');
    } finally {
      setSaving(false);
    }
  }

  if (!available || !state) return null;

  return (
    <div className="mt-4 rounded-2xl bg-[#F7F8FC] p-4 ring-1 ring-slate-200/70">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-slate-800">Model that searches by meaning</p>
          <p className="mt-0.5 max-w-[560px] text-[11.5px] leading-relaxed text-slate-500">
            To try the newer model: run your Accuracy tests, switch, let it finish re-reading, run them again — and keep
            whichever scored better.
          </p>
        </div>
        <div className="w-full shrink-0 sm:w-[280px]">
          <Select value={pending ?? state.model} onValueChange={(v) => v && setPending(v === state.model ? null : v)}>
            <SelectTrigger aria-label="Model that searches by meaning" className="h-9 w-full rounded-xl border-slate-200 bg-white text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {pending && (
        <div className="mt-3 flex flex-col gap-2 rounded-xl bg-white p-3 ring-1 ring-amber-200 sm:flex-row sm:items-center">
          <p className="flex-1 text-[12px] leading-relaxed text-amber-900">
            Switching re-reads all {state.total} parts of your knowledge with the new model. It takes a few minutes and
            uses some of your Gemini quota; until it finishes, search by words carries the replies.
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setPending(null)}
              className="h-8 rounded-lg px-3 text-[12px] font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void confirmSwitch()}
              disabled={saving}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-[#5B6CF9] px-3 text-[12px] font-semibold text-white hover:bg-[#4A5AE8] disabled:opacity-60"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Switch
            </button>
          </div>
        </div>
      )}

      {state.total > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-slate-500">
          {reading && <Loader2 className="h-3 w-3 animate-spin" />}
          {reading
            ? `Re-reading: ${state.ready} of ${state.total} parts ready`
            : `All ${state.total} parts read with this model`}
        </p>
      )}
    </div>
  );
}
