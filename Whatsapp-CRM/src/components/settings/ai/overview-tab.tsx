'use client';

import {
  CheckCircle2, Settings2, BookOpen, Send, BarChart3, Cpu, Thermometer, Layers, Globe, ShieldCheck,
  ArrowRight, AlertTriangle,
} from 'lucide-react';
import { AiButton, AiCard, AiIconTile } from './ui-kit';

/**
 * Screen 3 — the "connected" landing state: what's running right now,
 * and the four things you can do next.
 *
 * The usage figures in the mockup have no source yet — nothing in this
 * app records AI token counts or cost today — so this shows an explicit
 * "not tracking yet" state rather than inventing numbers. Real usage
 * lands with the Usage tab.
 */

export interface OverviewTabProps {
  model: string;
  modelLabel: string;
  temperature: number;
  maxTokens: number;
  replyLanguage: string;
  safetyFilter: string;
  semanticSearchAvailable: boolean;
  /** No customer prompt means the bot is answering as a generic
   *  assistant. Surfaced here because Overview is where someone lands
   *  after connecting, and a collapsed accordion on another tab is not
   *  where a blocking gap should live. */
  systemPromptMissing: boolean;
  onReconfigure: () => void;
  onGoToTab: (tab: 'training' | 'test' | 'usage') => void;
}

const SAFETY_LABEL: Record<string, string> = {
  strict: 'Strict',
  balanced: 'Balanced',
  relaxed: 'Relaxed',
};

export function OverviewTab(props: OverviewTabProps) {
  const languageLabel = props.replyLanguage || 'Auto-detect';

  const quickActions = [
    { key: 'training' as const, label: 'AI Training', blurb: 'Teach your AI with your business data.', Icon: BookOpen, tint: 'bg-[#EEF0FF] text-[#5B6CF9]' },
    { key: 'test' as const, label: 'Test AI', blurb: 'Try it with real conversations.', Icon: Send, tint: 'bg-emerald-50 text-emerald-600' },
    { key: 'usage' as const, label: 'Usage', blurb: 'Track performance and costs.', Icon: BarChart3, tint: 'bg-amber-50 text-amber-600' },
  ];

  const stats = [
    { label: 'Model', value: props.model, Icon: Cpu },
    { label: 'Temperature', value: String(props.temperature), Icon: Thermometer },
    { label: 'Max Tokens', value: String(props.maxTokens), Icon: Layers },
    { label: 'Language', value: languageLabel, Icon: Globe },
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        {props.systemPromptMissing && (
          <button
            type="button"
            onClick={() => props.onGoToTab('training')}
            className="flex w-full items-start gap-3 rounded-2xl bg-amber-50 p-4 text-left ring-1 ring-amber-500/20 transition-colors hover:bg-amber-100/70"
          >
            <AiIconTile tint="amber" size="md">
              <AlertTriangle className="h-4 w-4" />
            </AiIconTile>
            <span className="min-w-0">
              <span className="block text-[13.5px] font-semibold text-amber-900">
                No customer prompt set — replies are generic
              </span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-amber-800">
                The AI is answering without instructions about your business or how it should behave. Open AI Training
                → Advanced Features to write one, or start from the template.
              </span>
            </span>
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          </button>
        )}

        {/* ── Connected banner ── */}
        <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-emerald-50/40 p-5 ring-1 ring-emerald-500/15 shadow-[0_1px_2px_rgba(15,23,42,0.03),0_12px_28px_-20px_rgba(16,185,129,0.55)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <AiIconTile tint="emerald" size="lg" className="bg-emerald-100">
                <CheckCircle2 className="h-5 w-5" />
              </AiIconTile>
              <div>
                <p className="text-[15px] font-bold text-slate-900">Google Gemini Connected</p>
                <p className="mt-0.5 text-[13px] text-slate-600">Your chatbot is now powered by Google Gemini.</p>
              </div>
            </div>
            <AiButton tone="outline" onClick={props.onReconfigure}>
              <Settings2 className="h-4 w-4 text-slate-400" />
              Reconfigure
            </AiButton>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-emerald-200/60 pt-4 sm:grid-cols-4">
            {stats.map(({ label, value, Icon }) => (
              <div key={label} className="flex items-start gap-2.5">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0">
                  <p className="text-[11.5px] text-slate-500">{label}</p>
                  <p className="truncate text-[13px] font-semibold text-slate-800" title={value}>{value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Quick actions ── */}
        <AiCard className="p-6">
          <h3 className="text-[15px] font-semibold text-slate-900">What you can do now</h3>
          <p className="mt-0.5 text-[12.5px] text-slate-500">Configure training data, test your AI, and monitor performance.</p>
          <div className="mt-4 grid grid-cols-1 gap-3 xs:grid-cols-2 sm:grid-cols-3">
            {quickActions.map(({ key, label, blurb, Icon, tint }) => (
              <button
                key={key}
                type="button"
                onClick={() => props.onGoToTab(key)}
                className="group flex flex-col rounded-2xl bg-white p-4 text-left ring-1 ring-slate-200/70 transition-all duration-150 hover:-translate-y-0.5 hover:ring-[#5B6CF9]/35 hover:shadow-[0_8px_20px_-12px_rgba(15,23,42,0.35)] motion-safe:active:translate-y-0"
              >
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tint}`}>
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <span className="mt-3 text-[13.5px] font-semibold text-slate-800">{label}</span>
                <span className="mt-0.5 text-[12px] leading-relaxed text-slate-500">{blurb}</span>
                <ArrowRight className="mt-3 h-4 w-4 text-slate-300 transition-all duration-200 group-hover:text-[#5B6CF9] motion-safe:group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </AiCard>
      </div>

      <div className="space-y-5">
        {/* ── Usage (not tracked yet) ── */}
        <AiCard className="p-5">
          <p className="text-[15px] font-semibold text-slate-900">Usage</p>
          <p className="mt-0.5 text-[12.5px] text-slate-500">Requests, tokens and estimated cost.</p>
          <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-5 text-center">
            <BarChart3 className="mx-auto h-6 w-6 text-slate-300" />
            <p className="mt-2 text-[12.5px] font-medium text-slate-600">Not being recorded yet</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500">
              Token and cost tracking arrives with the Usage tab. Nothing is shown here rather than showing numbers
              that aren&apos;t measured.
            </p>
          </div>
        </AiCard>

        {/* ── Model details ── */}
        <AiCard className="p-5">
          <p className="text-[15px] font-semibold text-slate-900">Model Details</p>
          <dl className="mt-3 divide-y divide-slate-100">
            {[
              ['Provider', 'Google Gemini'],
              ['Model', props.modelLabel],
              ['Temperature', String(props.temperature)],
              ['Max Response Tokens', String(props.maxTokens)],
              ['Language', languageLabel],
              ['Safety Filter', SAFETY_LABEL[props.safetyFilter] ?? props.safetyFilter],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 py-2.5">
                <dt className="text-[12.5px] text-slate-500">{k}</dt>
                <dd className="truncate text-[12.5px] font-medium text-slate-800" title={v}>{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 flex items-start gap-2 border-t border-slate-100 pt-3">
            <ShieldCheck className={`mt-0.5 h-4 w-4 shrink-0 ${props.semanticSearchAvailable ? 'text-emerald-500' : 'text-slate-300'}`} />
            <p className="text-[11.5px] leading-relaxed text-slate-500">
              {props.semanticSearchAvailable
                ? 'Semantic knowledge search is active — answers are grounded in your knowledge base by meaning, not keywords.'
                : 'Semantic search is off until a Gemini key is saved; keyword matching is used instead.'}
            </p>
          </div>
        </AiCard>
      </div>
    </div>
  );
}
