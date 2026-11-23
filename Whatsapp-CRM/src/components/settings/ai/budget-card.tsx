'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Wallet } from 'lucide-react';
import { AiButton, AiCard, AiCardHeader } from './ui-kit';
import { apiFetch, errorText } from '@/lib/api-fetch';

interface Budget {
  monthly_limit_usd: number | null;
  spent_usd: number;
  month: string;
  ratio: number;
  over: boolean;
  warn_ratio: number;
}

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * Settings → AI Config → Usage: the monthly AI spending limit (src/lib/ai/budget.ts).
 * At 80% admins are told; at 100% automatic replies pause and chats go to
 * the team until the 1st (business time zone) or until the limit is raised.
 */
export function BudgetCard() {
  const inputId = useId();
  const [budget, setBudget] = useState<Budget | null>(null);
  const [loadError, setLoadError] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const b = (await (await apiFetch('/api/ai-usage/budget', { cache: 'no-store' })).json()) as Budget;
      setBudget(b);
      setValue(b.monthly_limit_usd ? String(b.monthly_limit_usd) : '');
    } catch (err) {
      console.error('[ai-budget] load failed:', err);
      setLoadError(errorText(err, 'Could not load the AI budget.'));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (saving) return;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) {
      toast.error('Enter a monthly limit of at least $1.');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch('/api/ai-usage/budget', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthly_limit_usd: n }),
      });
      const b = (await res.json()) as Budget;
      setBudget(b);
      setValue(b.monthly_limit_usd ? String(b.monthly_limit_usd) : '');
      toast.success('Monthly AI limit saved');
    } catch (err) {
      console.error('[ai-budget] save failed:', err);
      toast.error(errorText(err, 'Could not save the limit.'));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (saving) return;
    setSaving(true);
    try {
      await apiFetch('/api/ai-usage/budget', { method: 'DELETE' });
      toast.success('Monthly AI limit removed');
      await load();
    } catch (err) {
      console.error('[ai-budget] remove failed:', err);
      toast.error(errorText(err, 'Could not remove the limit.'));
    } finally {
      setSaving(false);
    }
  }

  const limit = budget?.monthly_limit_usd ?? null;
  const pct = budget && limit ? Math.min(100, Math.round(budget.ratio * 100)) : 0;
  const barTone = budget?.over ? 'bg-red-500' : budget && budget.ratio >= (budget.warn_ratio ?? 0.8) ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <AiCard className="p-5">
      <AiCardHeader
        title={<span className="inline-flex items-center gap-2"><Wallet className="h-4 w-4 text-slate-500" aria-hidden="true" />Monthly AI limit</span>}
        subtitle="At 80% admins get a notification. At the limit, automatic replies pause and chats go to your team until the 1st."
      />

      {loadError && <p role="alert" className="mt-3 text-[12.5px] text-red-600">{loadError}</p>}

      {!budget && !loadError && (
        <div className="mt-4 flex items-center gap-2 text-[12.5px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading…</div>
      )}

      {budget && (
        <div className="mt-4 space-y-4">
          {limit !== null ? (
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                <span className="font-semibold text-slate-800 tabular-nums">{money(budget.spent_usd)} <span className="font-normal text-slate-500">of {money(limit)} this month</span></span>
                <span className={budget.over ? 'font-semibold text-red-600' : 'text-slate-500'}>{budget.over ? 'Limit reached: automatic replies paused' : `${pct}% used`}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="AI budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                <div className={`h-full rounded-full ${barTone}`} style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1.5 text-[11.5px] text-slate-500">Estimated cost, the same figure as the totals below.</p>
            </div>
          ) : (
            <p className="text-[12.5px] text-slate-600">No limit set. This month so far: <span className="font-semibold tabular-nums">{money(budget.spent_usd)}</span> (estimated).</p>
          )}

          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => { e.preventDefault(); void save(); }}
          >
            <div className="flex-1">
              <label htmlFor={inputId} className="block text-[12px] font-medium text-slate-600">Limit per month (USD)</label>
              <input
                id={inputId}
                name="monthly_limit_usd"
                type="number"
                inputMode="decimal"
                min={1}
                step="0.01"
                autoComplete="off"
                placeholder="e.g. 20"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[16px] text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-[#4A5CE8]/40 sm:text-[13px]"
              />
            </div>
            <div className="flex gap-2">
              <AiButton type="submit" size="md" disabled={saving}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                {limit !== null ? 'Update limit' : 'Set limit'}
              </AiButton>
              {limit !== null && (
                <AiButton tone="outline" size="md" disabled={saving} onClick={() => void remove()}>Remove</AiButton>
              )}
            </div>
          </form>
        </div>
      )}
    </AiCard>
  );
}
