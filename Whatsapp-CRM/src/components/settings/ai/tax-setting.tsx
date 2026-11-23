'use client';

/**
 * "Tax on the AI bill" — added when AI costs are shown and compared with
 * the monthly limit (lib/ai/cost-display.ts). India: 18% GST.
 */

import { useCallback, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Receipt } from 'lucide-react';
import { AiButton, AiCard } from './ui-kit';
import { apiFetch, errorText } from '@/lib/api-fetch';

export function TaxSetting() {
  const id = useId();
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = (await (await apiFetch('/api/ai-usage/cost-settings', { cache: 'no-store' })).json()) as { tax_percent: number };
      setSaved(d.tax_percent);
      setValue(String(d.tax_percent));
    } catch (err) {
      console.error('[tax-setting] load failed:', err);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (saving) return;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      toast.error('Enter a tax percentage from 0 to 100.');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch('/api/ai-usage/cost-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tax_percent: n }),
      });
      const d = (await res.json()) as { tax_percent: number };
      setSaved(d.tax_percent);
      setValue(String(d.tax_percent));
      toast.success('Tax saved. Costs below now include it.');
      // The totals below are worked out with the tax: reload to show them.
      window.dispatchEvent(new Event('ai-cost-settings-changed'));
    } catch (err) {
      console.error('[tax-setting] save failed:', err);
      toast.error(errorText(err, 'Could not save the tax.'));
    } finally {
      setSaving(false);
    }
  }

  if (saved === null) return null;

  return (
    <AiCard className="p-5">
      <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="flex items-center gap-2 text-[13px] font-semibold text-slate-800">
            <Receipt className="h-4 w-4 text-slate-500" aria-hidden="true" />Tax on the AI bill (%)
          </label>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">
            Your AI provider adds tax to its bill (India: 18% GST). It is added to the costs on this tab and to the
            monthly limit, so they read like the bill. Use 0 if your bill has no tax.
          </p>
          <input
            id={id}
            name="tax_percent"
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step="0.01"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-2 h-10 w-full max-w-[160px] rounded-lg border border-slate-200 bg-white px-3 text-[16px] text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-[#4A5CE8]/40 sm:text-[13px]"
          />
        </div>
        <AiButton type="submit" size="md" disabled={saving}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          Save tax
        </AiButton>
      </form>
    </AiCard>
  );
}
