'use client';

/**
 * Top of the Accuracy tab.
 *
 *  1 · What the assistant knows about the business — each company detail,
 *      filled or not, what a missing one costs, and the exact text it
 *      reads with every reply.
 *  2 · Accuracy rules (lib/ai/accuracy-rules.ts) — answer mode, prices,
 *      promises, sensitive topics, blocked phrases, and what happens to a
 *      reply that breaks them. The phrase and price rules are checked in
 *      code on every reply, not only asked for.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Building2, CheckCircle2, ChevronDown, CircleAlert, Loader2, ShieldCheck, X } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { apiFetch, errorText } from '@/lib/api-fetch';
import type { AccuracyRules, SensitiveTopic } from '@/lib/ai/accuracy-rules';
import type { UnderstandingItem } from '@/lib/ai/company-profile';
import { AiButton, AiCard, AiCardHeader, AiIconTile, AiBadge, AiInput } from './ui-kit';

type View = {
  rules: AccuracyRules;
  suggested_topics: SensitiveTopic[];
  category: string | null;
  understanding: { items: UnderstandingItem[]; score: number };
  company_block: string;
  rules_block: string;
};

const TOPICS: Array<{ id: SensitiveTopic; label: string; hint: string }> = [
  { id: 'medical', label: 'Health & medical', hint: 'No diagnosis, treatment, medicine or dose.' },
  { id: 'legal', label: 'Legal', hint: 'No legal advice about their case.' },
  { id: 'financial', label: 'Money, loans & investment', hint: 'No investment, tax or credit advice; no predicted returns.' },
  { id: 'guarantees', label: 'Results & guarantees', hint: 'No promised job, admission, pass, cure or result.' },
];

function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string; hint: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
            value === o.value ? 'border-[#5B6CF9] bg-[#EEF0FF]/60' : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <span className="block text-[12.5px] font-semibold text-slate-800">{o.label}</span>
          <span className="mt-0.5 block text-[11.5px] leading-relaxed text-slate-500">{o.hint}</span>
        </button>
      ))}
    </div>
  );
}

function Toggle({ title, hint, checked, onChange }: { title: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-slate-800">{title}</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}

export function AccuracyRulesPanel() {
  const [view, setView] = useState<View | null>(null);
  const [rules, setRules] = useState<AccuracyRules | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [showBlock, setShowBlock] = useState(false);

  useEffect(() => {
    let live = true;
    apiFetch('/api/ai-config/accuracy-rules', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: View) => {
        if (!live) return;
        setView(d);
        setRules(d.rules);
      })
      .catch((err) => {
        console.error('[accuracy rules] load failed:', err);
        if (live) setLoadError(errorText(err, 'Could not load the accuracy rules.'));
      });
    return () => {
      live = false;
    };
  }, []);

  const set = <K extends keyof AccuracyRules>(k: K, v: AccuracyRules[K]) => setRules((r) => (r ? { ...r, [k]: v } : r));
  const dirty = Boolean(view && rules && JSON.stringify(view.rules) !== JSON.stringify(rules));

  async function save() {
    if (!rules || saving) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/ai-config/accuracy-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules }),
      });
      const d = (await res.json()) as View;
      setView(d);
      setRules(d.rules);
      toast.success('Accuracy rules saved');
    } catch (err) {
      console.error('[accuracy rules] save failed:', err);
      toast.error(errorText(err, 'Could not save the accuracy rules.'));
    } finally {
      setSaving(false);
    }
  }

  function addPhrase() {
    const p = phrase.trim();
    if (!rules || p.length < 2) return;
    if (!rules.blocked_phrases.some((x) => x.toLowerCase() === p.toLowerCase())) set('blocked_phrases', [...rules.blocked_phrases, p.slice(0, 80)]);
    setPhrase('');
  }

  if (loadError) {
    return (
      <AiCard>
        <p className="p-4 text-[12.5px] text-rose-700">{loadError}</p>
      </AiCard>
    );
  }
  if (!view || !rules) {
    return (
      <AiCard>
        <div className="flex justify-center p-6">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      </AiCard>
    );
  }

  const { items, score } = view.understanding;
  const missing = items.filter((i) => !i.filled);
  const unsuggested = view.suggested_topics.filter((t) => !rules.sensitive_topics.includes(t));

  return (
    <div className="space-y-5">
      {/* 1 · What it knows */}
      <AiCard>
        <AiCardHeader
          title={
            <span className="flex items-center gap-2">
              <AiIconTile tint="indigo" size="sm">
                <Building2 className="h-4 w-4" />
              </AiIconTile>
              What the AI knows about your business
            </span>
          }
          subtitle="These company details go into every customer reply. Each empty one is a question the AI can only hand over — or guess."
          action={<AiBadge tone={score >= 80 ? 'emerald' : score >= 50 ? 'amber' : 'rose'}>{score}% complete</AiBadge>}
        />
        <div className="space-y-3 px-5 pb-5">
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {items.map((i) => (
              <li key={i.key} className="flex items-start gap-2 text-[12px]">
                {i.filled ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                ) : (
                  <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                )}
                <span className="min-w-0">
                  <span className={i.filled ? 'text-slate-700' : 'font-medium text-slate-800'}>{i.label}</span>
                  {!i.filled && <span className="block text-[11px] text-slate-500">{i.without}</span>}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            {missing.length > 0 && (
              <a href="/settings?tab=profile" className="text-[12px] font-semibold text-[#4A5CE8] hover:underline">
                Fill in the {missing.length} missing detail{missing.length === 1 ? '' : 's'} →
              </a>
            )}
            <button
              type="button"
              onClick={() => setShowBlock((s) => !s)}
              className="flex items-center gap-1 text-[12px] font-medium text-slate-500 hover:text-slate-800"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showBlock ? '' : '-rotate-90'}`} /> Show exactly what the AI reads
            </button>
          </div>
          {showBlock && (
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-[11.5px] leading-relaxed text-slate-700">
              {view.company_block || 'Nothing yet — no company details have been filled in.'}
              {'\n\n'}
              {view.rules_block}
            </pre>
          )}
        </div>
      </AiCard>

      {/* 2 · Rules */}
      <AiCard>
        <AiCardHeader
          title={
            <span className="flex items-center gap-2">
              <AiIconTile tint="emerald" size="sm">
                <ShieldCheck className="h-4 w-4" />
              </AiIconTile>
              Accuracy rules
            </span>
          }
          subtitle="What this business's AI may say. Blocked phrases and the price rule are checked on every reply before it is sent."
        />
        <div className="space-y-5 px-5 pb-5">
          <section className="space-y-2">
            <p className="text-[12px] font-semibold text-slate-700">How strictly it answers</p>
            <Choice
              value={rules.answer_mode}
              onChange={(v) => set('answer_mode', v)}
              options={[
                { value: 'strict', label: 'Strict — only what you taught it', hint: 'Anything not in your details or knowledge: "I\'ll check with the team." Safest for regulated businesses.' },
                { value: 'balanced', label: 'Balanced', hint: 'Facts about the business only from your material; ordinary conversation in its own words.' },
              ]}
            />
          </section>

          <section className="space-y-2">
            <p className="text-[12px] font-semibold text-slate-700">Prices</p>
            <Choice
              value={rules.price_policy}
              onChange={(v) => set('price_policy', v)}
              options={[
                { value: 'knowledge', label: 'Only as written in the knowledge', hint: 'Exact figures only — never calculated, rounded or estimated.' },
                { value: 'never', label: 'Never quote a price', hint: 'A colleague shares prices. Any amount in a reply is caught before sending.' },
              ]}
            />
          </section>

          <section className="space-y-3">
            <Toggle
              title="No promises it was not given"
              hint="No discount, offer, refund, free extra or exception unless your material states it."
              checked={rules.no_promises}
              onChange={(v) => set('no_promises', v)}
            />
            <Toggle
              title="Ask when a question is unclear"
              hint="One short question to find out which one they mean, instead of guessing — e.g. which branch, which course."
              checked={rules.clarify_first}
              onChange={(v) => set('clarify_first', v)}
            />
          </section>

          <section className="space-y-2">
            <p className="text-[12px] font-semibold text-slate-700">Sensitive topics — never advise, offer a person</p>
            {unsuggested.length > 0 && (
              <p className="text-[11.5px] text-amber-700">
                Suggested for {view.category ?? 'your industry'}: {TOPICS.filter((t) => unsuggested.includes(t.id)).map((t) => t.label).join(', ')}.
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {TOPICS.map((t) => {
                const on = rules.sensitive_topics.includes(t.id);
                return (
                  <label
                    key={t.id}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 ${on ? 'border-[#5B6CF9] bg-[#EEF0FF]/60' : 'border-slate-200 bg-white'}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-[#5B6CF9]"
                      checked={on}
                      onChange={(e) =>
                        set('sensitive_topics', e.target.checked ? [...rules.sensitive_topics, t.id] : rules.sensitive_topics.filter((x) => x !== t.id))
                      }
                    />
                    <span>
                      <span className="block text-[12.5px] font-medium text-slate-800">{t.label}</span>
                      <span className="block text-[11.5px] text-slate-500">{t.hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="space-y-2">
            <p className="text-[12px] font-semibold text-slate-700">Blocked words and phrases</p>
            <p className="text-[11.5px] text-slate-500">A competitor&apos;s name, &quot;guaranteed&quot;, &quot;100% placement&quot; — never sent, whatever the customer asks.</p>
            <div className="flex gap-2">
              <AiInput
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addPhrase();
                  }
                }}
                placeholder="Type a word or phrase, then Enter"
                className="h-9 flex-1"
              />
              <AiButton type="button" tone="outline" onClick={addPhrase} disabled={phrase.trim().length < 2}>
                Add
              </AiButton>
            </div>
            {rules.blocked_phrases.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {rules.blocked_phrases.map((p) => (
                  <span key={p} className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-1 text-[11.5px] font-medium text-rose-700">
                    {p}
                    <button
                      type="button"
                      aria-label={`Remove ${p}`}
                      onClick={() => set('blocked_phrases', rules.blocked_phrases.filter((x) => x !== p))}
                      className="text-rose-400 hover:text-rose-700"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <p className="text-[12px] font-semibold text-slate-700">When a reply breaks a rule or has a detail it cannot back up</p>
            <Choice
              value={rules.on_unsupported}
              onChange={(v) => set('on_unsupported', v)}
              options={[
                { value: 'retry', label: 'Rewrite once, then hand over', hint: 'The AI is told exactly what was wrong and writes it again. Still wrong: a person takes over.' },
                { value: 'handoff', label: 'Hand over at once', hint: 'A person takes every such reply. Fewer AI answers, nothing rewritten.' },
              ]}
            />
          </section>

          <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
            {dirty && <span className="text-[11.5px] text-amber-700">Unsaved changes</span>}
            <AiButton type="button" onClick={() => void save()} disabled={saving || !dirty}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save rules
            </AiButton>
          </div>
        </div>
      </AiCard>
    </div>
  );
}
