'use client';

/**
 * The AI template kit: drafts the templates this business needs (staff
 * alerts, customer reminders, an offer), checked against Meta's rules,
 * editable, then submitted for approval — nothing goes to Meta until the
 * person chooses which and presses Submit.
 */

import { useState } from 'react';
import { Loader2, Sparkles, CheckCircle2, AlertCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { apiFetch, errorText } from '@/lib/api-fetch';
import { checkKitDraft, type KitDraft, type KitPurpose } from '@/lib/whatsapp/template-kit';
import { ALERT_FIELD_LABEL } from '@/lib/whatsapp/alert-fields';
import { cn } from '@/lib/utils';

const PURPOSE: Record<KitPurpose, { label: string; cls: string }> = {
  handoff_alert: { label: 'Staff alert · needs a person', cls: 'bg-violet-50 text-violet-700' },
  new_contact_alert: { label: 'Staff alert · new contact', cls: 'bg-violet-50 text-violet-700' },
  customer_utility: { label: 'Customer · update', cls: 'bg-sky-50 text-sky-700' },
  customer_marketing: { label: 'Customer · offer', cls: 'bg-amber-50 text-amber-800' },
};

type Row = KitDraft & { selected: boolean; result?: { ok: boolean; message: string } };

const FIELD = 'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-800 focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30';

export function TemplateKitDialog({ open, onOpenChange, onSubmitted }: Readonly<{ open: boolean; onOpenChange: (o: boolean) => void; onSubmitted: () => void }>) {
  const [language, setLanguage] = useState<'en' | 'ml' | 'both'>('both');
  const [rows, setRows] = useState<Row[]>([]);
  const [writing, setWriting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function write() {
    if (writing) return;
    setWriting(true);
    setError('');
    try {
      const res = await apiFetch('/api/whatsapp/templates/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language }),
      });
      const j = (await res.json()) as { drafts?: KitDraft[] };
      const drafts = Array.isArray(j.drafts) ? j.drafts : [];
      setRows(drafts.map((d) => ({ ...d, selected: d.problems.length === 0 })));
      if (drafts.length === 0) setError('The AI wrote nothing usable. Try again, or fill in your business profile first (Settings → Profile).');
    } catch (err) {
      console.error('[template kit] write failed:', err);
      setError(errorText(err, 'Could not write templates.'));
    } finally {
      setWriting(false);
    }
  }

  /** An edit re-checks the draft against Meta's rules at once. */
  function update(i: number, patch: Partial<Pick<Row, 'name' | 'body' | 'samples' | 'selected'>>) {
    setRows((prev) => prev.map((r, j) => {
      if (j !== i) return r;
      const next = { ...r, ...patch, result: undefined };
      if (patch.body !== undefined) {
        // One example per variable, always: added or dropped with the text.
        const count = new Set([...next.body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => m[1])).size;
        next.samples = Array.from({ length: count }, (_, k) => next.samples[k] ?? '');
      }
      if (patch.name !== undefined || patch.body !== undefined || patch.samples !== undefined) {
        const base = { problems: [] as string[], warnings: r.warnings.filter((w) => /not labelled/.test(w)) };
        const checked = checkKitDraft(next);
        next.problems = [...base.problems, ...checked.problems];
        next.warnings = [...base.warnings, ...checked.warnings];
        if (next.problems.length > 0) next.selected = false;
      }
      return next;
    }));
  }

  const chosen = rows.filter((r) => r.selected && r.problems.length === 0 && !r.result?.ok);

  async function submit() {
    if (submitting || chosen.length === 0) return;
    setSubmitting(true);
    let okCount = 0;
    for (const r of chosen) {
      const idx = rows.indexOf(r);
      try {
        await apiFetch('/api/whatsapp/templates/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: r.name,
            category: r.category,
            language: r.language,
            body_text: r.body,
            sample_values: { body: r.samples },
            ...(r.variable_fields ? { variable_fields: r.variable_fields } : {}),
          }),
        });
        okCount++;
        setRows((prev) => prev.map((x, j) => (j === idx ? { ...x, result: { ok: true, message: 'Sent to Meta for approval' } } : x)));
      } catch (err) {
        console.error('[template kit] submit failed:', r.name, err);
        setRows((prev) => prev.map((x, j) => (j === idx ? { ...x, result: { ok: false, message: errorText(err, 'Meta did not accept it.') } } : x)));
      }
    }
    setSubmitting(false);
    if (okCount > 0) {
      toast.success(`${okCount} template${okCount !== 1 ? 's' : ''} sent to Meta for approval`);
      onSubmitted();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!submitting) onOpenChange(o); }}>
      <DialogContent className="bg-white text-slate-800 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-900"><Sparkles className="size-4 text-violet-600" aria-hidden /> Template kit</DialogTitle>
          <DialogDescription className="text-slate-500">
            The AI writes the templates your business needs — staff alerts, customer reminders and an offer — checked against Meta’s rules.
            Edit anything, choose which to keep, then submit. Nothing goes to Meta until you press Submit.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="kit-language" className="mb-1 block text-[12px] font-medium text-slate-500">Language</label>
            <select id="kit-language" value={language} onChange={(e) => setLanguage(e.target.value as typeof language)} className={FIELD}>
              <option value="both">English and Malayalam</option>
              <option value="en">English</option>
              <option value="ml">Malayalam</option>
            </select>
          </div>
          <Button type="button" onClick={() => void write()} disabled={writing || submitting} className="gap-1.5">
            {writing ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
            {rows.length ? 'Write again' : 'Write templates'}
          </Button>
        </div>

        {error && <p role="alert" className="text-[12.5px] text-rose-700">{error}</p>}

        {rows.length > 0 && (
          <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
            {rows.map((r, i) => (
              <div key={`${r.name}-${i}`} className={cn('rounded-xl border p-3', r.selected ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-200 bg-white')}>
                <div className="flex flex-wrap items-center gap-2">
                  <input id={`kit-sel-${i}`} type="checkbox" checked={r.selected} disabled={r.problems.length > 0 || r.result?.ok}
                    onChange={(e) => update(i, { selected: e.target.checked })} className="size-4 accent-indigo-600" />
                  <label htmlFor={`kit-sel-${i}`} className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', PURPOSE[r.purpose].cls)}>{PURPOSE[r.purpose].label}</label>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{r.category} · {r.language === 'ml' ? 'Malayalam' : 'English'}</span>
                  {r.result && (
                    <span className={cn('inline-flex items-center gap-1 text-[12px]', r.result.ok ? 'text-emerald-700' : 'text-rose-700')}>
                      {r.result.ok ? <CheckCircle2 className="size-3.5" aria-hidden /> : <AlertCircle className="size-3.5" aria-hidden />} {r.result.message}
                    </span>
                  )}
                </div>
                {r.why && <p className="mt-1 text-[12px] text-slate-500">{r.why}</p>}
                <div className="mt-2 grid gap-2">
                  <input aria-label={`Name of template ${i + 1}`} className={cn(FIELD, 'font-mono')} value={r.name} maxLength={512}
                    onChange={(e) => update(i, { name: e.target.value })} />
                  <textarea aria-label={`Text of template ${i + 1}`} className={cn(FIELD, 'min-h-[84px]')} value={r.body} maxLength={1024}
                    onChange={(e) => update(i, { body: e.target.value })} />
                  {r.samples.length > 0 && (
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {r.samples.map((s, k) => (
                        <label key={k} className="flex items-center gap-2 text-[12px] text-slate-500">
                          <span className="w-10 shrink-0 font-mono">{`{{${k + 1}}}`}</span>
                          <span className="w-28 shrink-0 truncate" title={r.variable_fields?.[k] ? ALERT_FIELD_LABEL[r.variable_fields[k]] : 'Example'}>
                            {r.variable_fields?.[k] ? ALERT_FIELD_LABEL[r.variable_fields[k]] : 'Example'}
                          </span>
                          <input className={FIELD} value={s} maxLength={60}
                            onChange={(e) => update(i, { samples: r.samples.map((x, j) => (j === k ? e.target.value : x)) })} />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                {r.problems.map((p) => (
                  <p key={p} className="mt-1.5 flex items-start gap-1.5 text-[12px] text-rose-700"><AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {p}</p>
                ))}
                {r.warnings.map((w) => (
                  <p key={w} className="mt-1 flex items-start gap-1.5 text-[12px] text-amber-800"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {w}</p>
                ))}
              </div>
            ))}
          </div>
        )}

        {rows.some((r) => r.purpose.endsWith('_alert')) && (
          <p className="text-[12px] text-slate-500">
            Once Meta approves a staff alert, choose it in Settings → AI → Handover alert (or Contact → New contact alert): its variables fill themselves.
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Close</Button>
          {rows.length > 0 && (
            <Button type="button" onClick={() => void submit()} disabled={submitting || writing || chosen.length === 0} className="gap-1.5">
              {submitting && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
              Submit {chosen.length || ''} to Meta
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
