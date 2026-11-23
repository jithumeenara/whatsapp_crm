'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Wallet } from 'lucide-react';
import { AiButton, AiCard, AiCardHeader } from './ui-kit';
import { apiFetch, errorText } from '@/lib/api-fetch';
import { Switch } from '@/components/ui/switch';

interface Budget {
  currency: string;
  usd_rate: number | null;
  rate_source: 'live' | 'saved' | 'suggested';
  rate_fetched_at: string | null;
  rate_auto: boolean;
  rate_is_suggested: boolean;
  rates_as_of: string;
  limit_amount: number | null;
  spent_amount: number | null;
  monthly_limit_usd: number | null;
  spent_usd: number;
  month: string;
  ratio: number;
  over: boolean;
  warn_ratio: number;
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: amount < 10 ? 2 : 0 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/**
 * Settings → AI Config → Usage: the monthly AI spending limit, in the
 * business's own currency (Business profile). AI is billed in USD, so the
 * card shows the rate it converts with, which the admin can correct.
 * At 80% admins are told; at 100% automatic replies pause and chats go to
 * the team until the 1st (business time zone) or until the limit is raised.
 */
export function BudgetCard() {
  const amountId = useId();
  const rateId = useId();
  const [budget, setBudget] = useState<Budget | null>(null);
  const [loadError, setLoadError] = useState('');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [auto, setAuto] = useState(true);
  const [saving, setSaving] = useState(false);

  const apply = (b: Budget) => {
    setBudget(b);
    setAmount(b.limit_amount ? String(b.limit_amount) : '');
    setRate(b.usd_rate ? String(b.usd_rate) : '');
    setAuto(b.rate_auto);
  };

  const load = useCallback(async () => {
    setLoadError('');
    try {
      apply((await (await apiFetch('/api/ai-usage/budget', { cache: 'no-store' })).json()) as Budget);
    } catch (err) {
      console.error('[ai-budget] load failed:', err);
      setLoadError(errorText(err, 'Could not load the AI budget.'));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (saving || !budget) return;
    const a = Number(amount);
    const r = Number(rate);
    if (!Number.isFinite(a) || a <= 0) {
      toast.error('Enter a monthly limit above 0.');
      return;
    }
    if (!auto && (!Number.isFinite(r) || r <= 0)) {
      toast.error(`Enter how much 1 US dollar is in ${budget.currency}.`);
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch('/api/ai-usage/budget', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: a, usd_rate: Number.isFinite(r) && r > 0 ? r : undefined, rate_auto: auto }),
      });
      apply((await res.json()) as Budget);
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

  const cur = budget?.currency ?? 'USD';
  const hasLimit = budget?.monthly_limit_usd !== null && budget?.monthly_limit_usd !== undefined;
  const pct = budget && hasLimit ? Math.min(100, Math.round(budget.ratio * 100)) : 0;
  const barTone = budget?.over ? 'bg-red-500' : budget && budget.ratio >= (budget.warn_ratio ?? 0.8) ? 'bg-amber-500' : 'bg-emerald-500';
  const spentText = budget
    ? budget.spent_amount !== null ? money(budget.spent_amount, cur) : money(budget.spent_usd, 'USD')
    : '';
  const isUsd = cur === 'USD';
  const inputClass =
    'mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[16px] text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-[#4A5CE8]/40 sm:text-[13px]';

  return (
    <AiCard className="p-5">
      <AiCardHeader
        title={<span className="inline-flex items-center gap-2"><Wallet className="h-4 w-4 text-slate-500" aria-hidden="true" />Monthly AI limit</span>}
        subtitle="At 80% admins get a notification. At the limit, automatic replies pause and chats go to your team until the 1st."
      />

      {loadError && <p role="alert" className="mt-3 text-[12.5px] text-red-600">{loadError}</p>}

      {!budget && !loadError && (
        <div className="mt-4 flex items-center gap-2 text-[12.5px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Loading…</div>
      )}

      {budget && (
        <div className="mt-4 space-y-4">
          {hasLimit && budget.limit_amount !== null ? (
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                <span className="font-semibold tabular-nums text-slate-800">{spentText} <span className="font-normal text-slate-500">of {money(budget.limit_amount, cur)} this month</span></span>
                <span className={budget.over ? 'font-semibold text-red-600' : 'text-slate-500'}>{budget.over ? 'Limit reached: automatic replies paused' : `${pct}% used`}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="AI budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                <div className={`h-full rounded-full ${barTone}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          ) : (
            <p className="text-[12.5px] text-slate-600">No limit set. This month so far: <span className="font-semibold tabular-nums">{spentText}</span> (estimated).</p>
          )}

          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <div className={`grid gap-3 ${isUsd ? '' : 'sm:grid-cols-2'}`}>
              <div>
                <label htmlFor={amountId} className="block text-[12px] font-medium text-slate-600">Limit per month ({cur})</label>
                <input id={amountId} name="amount" type="number" inputMode="decimal" min={0} step="0.01" autoComplete="off" placeholder={isUsd ? 'e.g. 20' : 'e.g. 2000'} value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
              </div>
              {!isUsd && (
                <div>
                  <label htmlFor={rateId} className="block text-[12px] font-medium text-slate-600">1 US dollar = how many {cur}</label>
                  <input id={rateId} name="usd_rate" type="number" inputMode="decimal" min={0} step="0.0001" autoComplete="off" value={rate} onChange={(e) => setRate(e.target.value)} disabled={auto} className={`${inputClass} disabled:bg-slate-50 disabled:text-slate-500`} />
                </div>
              )}
            </div>
            {!isUsd && (
              <div className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                <div className="min-w-0">
                  <label htmlFor={`${rateId}-auto`} className="block text-[12.5px] font-medium text-slate-700">Update the rate automatically</label>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">
                    AI is billed in US dollars, so spending is converted at this rate.{' '}
                    {auto
                      ? budget.rate_source === 'live' && budget.rate_fetched_at
                        ? `Today's market rate, updated ${new Date(budget.rate_fetched_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}. Checked twice a day.`
                        : `Fetched twice a day; until the first update, the rate shown is used.`
                      : budget.rate_is_suggested
                        ? `Suggested rate (${budget.rates_as_of}); change it to match your bill.`
                        : 'The rate you saved is used.'}
                    {' '}Your currency is set in Settings → Profile.
                  </p>
                </div>
                <Switch id={`${rateId}-auto`} checked={auto} onCheckedChange={setAuto} aria-label="Update the rate automatically" />
              </div>
            )}
            <div className="flex gap-2">
              <AiButton type="submit" size="md" disabled={saving}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                {hasLimit ? 'Update limit' : 'Set limit'}
              </AiButton>
              {hasLimit && (
                <AiButton tone="outline" size="md" disabled={saving} onClick={() => void remove()}>Remove</AiButton>
              )}
            </div>
          </form>
        </div>
      )}
    </AiCard>
  );
}
