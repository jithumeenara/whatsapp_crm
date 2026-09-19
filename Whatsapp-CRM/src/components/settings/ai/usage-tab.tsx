'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3, Loader2, MessageSquare, Database, Send, BookOpen, Languages,
  ShieldCheck, TrendingUp, TrendingDown, Minus, AlertTriangle, Download, Info,
  Volume2, Mic, FileScan,
} from 'lucide-react';
import { AiButton, AiCard, AiCardHeader, AiBadge, AiSegmented, AiNotice, AiHint, AiIconTile } from './ui-kit';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RequestsChart, TokensChart, FeatureBars, type DailyPoint } from './usage-chart';

/**
 * Screen 6 — what the AI actually cost and did.
 *
 * Every figure here comes from ai_usage_events, which is written by the
 * real call sites (the WhatsApp reply path, both test modes, knowledge
 * training, inbox translation). Before this existed the tab said so
 * plainly rather than showing invented numbers; now it shows measured
 * ones, and still distinguishes what was measured from what was
 * estimated — token counts come from Gemini's own response, cost is
 * derived from a local price table and is labelled "estimated"
 * everywhere it appears.
 */

interface Totals {
  requests: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  cost_inr: number;
  errors: number;
}

interface FeatureRow {
  feature: string;
  requests: number;
  total_tokens: number;
  cost_usd: number;
  cost_inr: number;
}

interface RecentRow {
  id: string;
  created_at: string;
  feature: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  cost_inr: number;
  status: string;
  error: string | null;
  latency_ms: number | null;
}

interface UsageResponse {
  days: number;
  totals: Totals;
  previous_totals: Totals;
  by_feature: FeatureRow[];
  daily: DailyPoint[];
  recent: RecentRow[];
  /** 'YYYY-MM' for every month with any usage, newest first. */
  recent_months: string[];
  recent_month: string | null;
  inr_rate: number;
  inr_note: string;
}

const FEATURE_META: Record<string, { label: string; Icon: typeof MessageSquare }> = {
  chat_customer: { label: 'Chat (Customer)', Icon: MessageSquare },
  chat_admin: { label: 'Chat (Admin)', Icon: Database },
  test: { label: 'Test AI', Icon: Send },
  embedding: { label: 'Training', Icon: BookOpen },
  translation: { label: 'Translation', Icon: Languages },
  validation: { label: 'Key check', Icon: ShieldCheck },
  eval_grading: { label: 'Evaluation', Icon: ShieldCheck },
  tts: { label: 'Voice — Gemini', Icon: Volume2 },
  tts_cloud: { label: 'Voice — Google Cloud', Icon: Volume2 },
  transcription: { label: 'Voice notes in', Icon: Mic },
  pdf_ocr: { label: 'Scanned PDFs', Icon: FileScan },
};

/** How many calls the Recent list shows at once.
 *
 *  Five by default, which is deliberately small: this list is read to
 *  answer "what did that last reply cost", and the answer is in the
 *  first few rows. Anyone auditing a month changes it. */
const RECENT_SIZES = [5, 10, 20, 50] as const

/** A Select item needs a value, and "" is not one. */
const ALL_MONTHS = '__all__'

const RANGES = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
] as const;

function featureLabel(feature: string): string {
  return FEATURE_META[feature]?.label ?? feature;
}

/** "2026-09" as somebody says it. Built from the string rather than
 *  from a parsed Date so a month never shifts across a timezone. */
function monthLabel(value: string): string {
  const [year, month] = value.split('-').map(Number);
  if (!year || !month) return value;
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

function formatUsd(value: number): string {
  if (value === 0) return '$0.00';
  // Sub-cent totals are real at this volume — showing "$0.00" for a day
  // that genuinely cost something reads as "not tracked".
  // Rupees, because that is the currency the bill arrives in. A single
  // reply costs a few paise and a month costs a few hundred rupees, so
  // one number of decimals cannot serve both: two would round a real
  // per-call cost to zero, four would make the monthly total unreadable.
  if (value === 0) return '\u20B90';
  if (value < 1) return `\u20B9${value.toFixed(3)}`;
  if (value < 100) return `\u20B9${value.toFixed(2)}`;
  return `\u20B9${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

/** Percentage change vs the previous window of the same length. Returns
 *  null when there's no previous baseline — "up 100%" from zero is
 *  noise, not information. */
function delta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function DeltaChip({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value === null) {
    return <span className="text-[11px] text-slate-400">no prior period</span>;
  }
  const rounded = Math.round(value);
  if (rounded === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
        <Minus className="h-3 w-3" />
        no change
      </span>
    );
  }
  const rising = rounded > 0;
  // For errors, "up" is bad — the arrow direction stays honest to the
  // number while the colour follows whether it's good news.
  const good = invert ? !rising : rising;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium ${good ? 'text-emerald-600' : 'text-rose-600'}`}
    >
      {rising ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {Math.abs(rounded)}%
      <span className="font-normal text-slate-400">vs previous</span>
    </span>
  );
}

function StatTile({
  label,
  value,
  sub,
  Icon,
  tint,
}: {
  label: string;
  value: string;
  sub: React.ReactNode;
  Icon: typeof BarChart3;
  tint: 'indigo' | 'emerald' | 'amber' | 'violet';
}) {
  return (
    <AiCard className="p-4">
      <div className="flex items-start gap-3">
        <AiIconTile tint={tint} size="md">
          <Icon className="h-4 w-4" />
        </AiIconTile>
        <div className="min-w-0">
          <p className="text-[12px] text-slate-500">{label}</p>
          <p className="mt-0.5 text-[22px] font-bold leading-tight tracking-[-0.02em] tabular-nums text-slate-900">
            {value}
          </p>
          <div className="mt-1">{sub}</div>
        </div>
      </div>
    </AiCard>
  );
}

export function UsageTab() {
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recentPage, setRecentPage] = useState(1);
  const [recentSize, setRecentSize] = useState<number>(RECENT_SIZES[0]);
  const [recentMonth, setRecentMonth] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (recentMonth) params.set('month', recentMonth);
      const res = await fetch(`/api/ai-usage?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not load usage.');
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load usage.');
    } finally {
      setLoading(false);
    }
  }, [days, recentMonth]);

  useEffect(() => {
    load();
  }, [load]);

  function exportCsv() {
    if (!data) return;
    const header = 'date,requests,input_tokens,output_tokens,estimated_cost_usd,estimated_cost_inr';
    const rows = data.daily.map(
      (d) =>
        `${d.day},${d.requests},${d.input_tokens},${d.output_tokens},${d.cost_usd.toFixed(6)},${d.cost_inr.toFixed(4)}`,
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-usage-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totals = data?.totals;
  const previous = data?.previous_totals;
  const hasData = !!totals && totals.requests > 0;

  return (
    <div className="space-y-5">
      <AiCard className="p-5">
        <AiCardHeader
          title="Usage"
          subtitle="Monitor your Gemini API usage, costs and performance."
          action={
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <AiSegmented
                value={days}
                onChange={(v) => {
                  setDays(v);
                  // A page number from the old window points at rows the
                  // new one may not have.
                  setRecentPage(1);
                }}
                options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
              />
              <AiButton tone="outline" size="sm" onClick={exportCsv} disabled={!hasData}>
                <Download className="h-3.5 w-3.5" />
                Export
              </AiButton>
            </div>
          }
        />
      </AiCard>

      {error && <AiNotice tone="error" icon={<AlertTriangle className="h-4 w-4" />}>{error}</AiNotice>}

      {loading && !data && (
        <AiCard className="flex items-center justify-center p-12">
          <Loader2 className="h-5 w-5 animate-spin text-[#5B6CF9]" />
        </AiCard>
      )}

      {!loading && !hasData && !error && (
        <AiCard className="p-10 text-center">
          <BarChart3 className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-[14px] font-semibold text-slate-700">No AI calls in this period</p>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-relaxed text-slate-500">
            Usage is recorded from the moment an AI call runs — a WhatsApp reply, a test message, a knowledge training
            run or an inbox translation. Send a test message and it will appear here.
          </p>
        </AiCard>
      )}

      {hasData && totals && previous && data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Total Requests"
              value={formatNumber(totals.requests)}
              sub={<DeltaChip value={delta(totals.requests, previous.requests)} />}
              Icon={MessageSquare}
              tint="indigo"
            />
            <StatTile
              label="Input Tokens"
              value={formatNumber(totals.input_tokens)}
              sub={<DeltaChip value={delta(totals.input_tokens, previous.input_tokens)} />}
              Icon={BarChart3}
              tint="violet"
            />
            <StatTile
              label="Output Tokens"
              value={formatNumber(totals.output_tokens)}
              sub={<DeltaChip value={delta(totals.output_tokens, previous.output_tokens)} />}
              Icon={BarChart3}
              tint="emerald"
            />
            <StatTile
              label="Estimated Cost"
              value={formatUsd(totals.cost_inr)}
              sub={<DeltaChip value={delta(totals.cost_inr, previous.cost_inr)} invert />}
              Icon={TrendingUp}
              tint="amber"
            />
          </div>

          {totals.errors > 0 && (
            <AiNotice tone="warning" icon={<AlertTriangle className="h-4 w-4" />}>
              {totals.errors} of {totals.requests} calls failed in this period. Failed calls are listed below with the
              error the provider returned.
            </AiNotice>
          )}

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-5">
              <AiCard className="p-5">
                <AiCardHeader title="Requests per day" subtitle={`Last ${data.days} days.`} />
                <div className="mt-3">
                  <RequestsChart data={data.daily} />
                </div>
              </AiCard>

              <AiCard className="p-5">
                <AiCardHeader
                  title="Tokens per day"
                  subtitle="Input and output, counted by Gemini itself."
                />
                <div className="mt-3">
                  <TokensChart data={data.daily} />
                </div>
              </AiCard>

              <AiCard>
                <div className="p-5 pb-3">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <AiCardHeader
                      title="Recent API calls"
                      subtitle={
                        data.recent.length === 0
                          ? 'Nothing recorded for this period.'
                          : `${data.recent.length} call${data.recent.length === 1 ? '' : 's'}, newest first.`
                      }
                    />
                    <div className="flex items-center gap-2">
                      <Select
                        value={recentMonth || ALL_MONTHS}
                        onValueChange={(v) => {
                          if (!v) return;
                          setRecentMonth(v === ALL_MONTHS ? '' : v);
                          setRecentPage(1);
                        }}
                      >
                        <SelectTrigger className="h-8 w-[150px] rounded-lg border-slate-200 text-[12.5px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALL_MONTHS}>All months</SelectItem>
                          {(data.recent_months ?? []).map((m) => (
                            <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={String(recentSize)}
                        onValueChange={(v) => {
                          if (!v) return;
                          setRecentSize(Number(v));
                          setRecentPage(1);
                        }}
                      >
                        <SelectTrigger className="h-8 w-[104px] rounded-lg border-slate-200 text-[12.5px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RECENT_SIZES.map((n) => (
                            <SelectItem key={n} value={String(n)}>{n} per page</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] border-collapse">
                    <thead>
                      <tr className="border-y border-slate-100 bg-slate-50/70 text-left">
                        {['When', 'Feature', 'Model', 'Tokens', 'Cost', 'Status'].map((h) => (
                          <th key={h} className="whitespace-nowrap px-4 py-2.5 text-[11.5px] font-semibold text-slate-500 sm:px-5">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent
                        .slice((recentPage - 1) * recentSize, recentPage * recentSize)
                        .map((r) => (
                        <tr key={r.id} className="border-b border-slate-50 last:border-0">
                          <td className="whitespace-nowrap px-5 py-2.5 text-[12.5px] text-slate-600">
                            {new Date(r.created_at).toLocaleString(undefined, {
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="px-5 py-2.5 text-[12.5px] text-slate-700">{featureLabel(r.feature)}</td>
                          <td className="px-5 py-2.5 font-mono text-[11.5px] text-slate-500">{r.model}</td>
                          <td className="whitespace-nowrap px-5 py-2.5 text-[12.5px] tabular-nums text-slate-700">
                            {/* Google Cloud TTS is billed per character, so it
                                genuinely has no token count. "0 / 0" reads as a
                                broken row; a dash reads as what it is. */}
                            {r.input_tokens === 0 && r.output_tokens === 0 ? (
                              <span className="text-slate-400">—</span>
                            ) : (
                              `${r.input_tokens.toLocaleString()} / ${r.output_tokens.toLocaleString()}`
                            )}
                          </td>
                          <td className="px-5 py-2.5 text-[12.5px] tabular-nums text-slate-700">
                            {formatUsd(r.cost_inr)}
                          </td>
                          <td className="px-5 py-2.5">
                            {r.status === 'success' ? (
                              <AiBadge tone="emerald">Success</AiBadge>
                            ) : (
                              <span title={r.error ?? undefined}>
                                <AiBadge tone="rose">Failed</AiBadge>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {data.recent.length > recentSize && (
                  <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
                    <p className="text-[12px] text-slate-500">
                      {(recentPage - 1) * recentSize + 1}–
                      {Math.min(recentPage * recentSize, data.recent.length)} of {data.recent.length}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <AiButton
                        tone="outline"
                        size="sm"
                        onClick={() => setRecentPage((p) => Math.max(1, p - 1))}
                        disabled={recentPage === 1}
                      >
                        Previous
                      </AiButton>
                      <AiButton
                        tone="outline"
                        size="sm"
                        onClick={() =>
                          setRecentPage((p) =>
                            Math.min(Math.ceil(data.recent.length / recentSize), p + 1),
                          )
                        }
                        disabled={recentPage >= Math.ceil(data.recent.length / recentSize)}
                      >
                        Next
                      </AiButton>
                    </div>
                  </div>
                )}
              </AiCard>
            </div>

            <div className="space-y-5">
              <AiCard className="p-5">
                <AiCardHeader
                  title="Usage by feature"
                  subtitle="What each part cost in this period."
                />
                <div className="mt-4">
                  <FeatureBars
                    rows={data.by_feature.map((f) => ({ ...f, label: featureLabel(f.feature) }))}
                    formatMoney={formatUsd}
                  />
                  {data.by_feature.some((f) => f.feature === 'tts_cloud') && (
                    <AiHint className="mt-3">
                      Google Cloud voice is billed per character rather than per token, so its rows show a
                      cost and no token count. Gemini voice is billed in audio tokens and shows both.
                    </AiHint>
                  )}
                </div>
              </AiCard>

              <AiCard className="p-5">
                <AiCardHeader title="Cost by feature" subtitle="Estimated, in USD." />
                <dl className="mt-3 divide-y divide-slate-100">
                  {data.by_feature.map((f) => (
                    <div key={f.feature} className="flex items-center justify-between gap-3 py-2.5">
                      <dt className="flex min-w-0 items-center gap-2 text-[12.5px] text-slate-600">
                        {(() => {
                          const Icon = FEATURE_META[f.feature]?.Icon ?? BarChart3;
                          return <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />;
                        })()}
                        <span className="truncate">{featureLabel(f.feature)}</span>
                      </dt>
                      <dd className="shrink-0 text-[12.5px] font-medium tabular-nums text-slate-800">
                        {formatUsd(f.cost_inr)}
                      </dd>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-3 pt-2.5">
                    <dt className="text-[12.5px] font-semibold text-slate-700">Total</dt>
                    <dd className="text-[13px] font-bold tabular-nums text-slate-900">{formatUsd(totals.cost_inr)}</dd>
                  </div>
                </dl>
              </AiCard>

              <AiCard className="p-5">
                <div className="flex items-start gap-2.5">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <div>
                    <p className="text-[12.5px] font-semibold text-slate-700">
                      How these numbers are produced, and where they differ from your Google bill
                    </p>
                    <AiHint className="mt-1">
                      Token counts are the ones Gemini reports for each call, so they match what you were
                      billed for. Cost is calculated here from published per-model rates and will drift if
                      Google changes pricing &mdash; treat it as an estimate, not an invoice. Training tokens
                      are approximated from text length, because the embedding API returns no token count at
                      all. {data.inr_note}
                    </AiHint>
                    {/* Said plainly. Someone comparing this tab to the Cloud
                        Console will find a gap, and guessing at the reason is
                        worse than being told it. */}
                    <AiHint className="mt-2">
                      <strong className="font-semibold text-slate-600">What this tab cannot see:</strong>{' '}
                      calls the voice agent makes on its own server, and live voice sessions your browser
                      opens directly with Google. Both use your Gemini key and both appear on Google&rsquo;s
                      bill, but neither passes through this app, so neither can be counted here. If your
                      bill is larger than this figure, that is usually the difference.
                    </AiHint>
                  </div>
                </div>
              </AiCard>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
