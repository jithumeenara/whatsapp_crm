'use client';

import { Sparkles, Check, Bot, Cpu, Server, ArrowRight, Settings2, BookOpen } from 'lucide-react';
import { AiButton, AiBadge } from './ui-kit';

/**
 * Screen 1 of the AI section — what an account sees before any provider
 * is connected: one real, configurable provider (Gemini) presented as the
 * hero, and the adapters that exist server-side but aren't offered yet
 * shown plainly as not-yet-available rather than hidden entirely.
 *
 * Gemini is the only one this screen configures, deliberately — see
 * PROVIDER_META's comment in ../ai-config.tsx for the Malayalam/Indic
 * reasoning. The others use neutral icons rather than vendor logos: we
 * don't ship redrawn brand marks.
 */

const COMING_SOON = [
  { id: 'openai', label: 'OpenAI (GPT)', blurb: 'Powerful models for advanced reasoning and tools.', Icon: Bot },
  { id: 'anthropic', label: 'Anthropic (Claude)', blurb: 'Safe, helpful and reliable responses.', Icon: Sparkles },
  { id: 'deepseek', label: 'DeepSeek', blurb: 'High performance open models.', Icon: Cpu },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', blurb: 'Use your own API endpoint.', Icon: Server },
];

const GEMINI_STRENGTHS = ['High quality responses', 'Supports multiple languages', 'Cost efficient'];

export function ProviderLanding({ onConfigure }: { onConfigure: () => void }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-bold tracking-tight text-slate-900">AI Config</h2>
          <p className="mt-0.5 text-[13px] text-slate-500">Configure AI providers for your chatbot</p>
        </div>
        <a
          href="https://ai.google.dev/gemini-api/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-white px-4 text-[13px] font-semibold text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ring-1 ring-slate-200/90 transition-all duration-150 hover:bg-slate-50 hover:ring-slate-300 motion-safe:active:translate-y-px"
        >
          <BookOpen className="h-4 w-4 text-slate-400" />
          View Documentation
        </a>
      </div>

      <div>
        <h3 className="text-[15px] font-semibold text-slate-900">AI Providers</h3>
        <p className="mt-0.5 text-[13px] text-slate-500">Choose and configure an AI provider to power your chatbot.</p>
      </div>

      {/* ── Gemini hero ── */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#EFF1FF] via-[#F7F8FF] to-white p-7 ring-1 ring-[#5B6CF9]/12 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_20px_48px_-24px_rgba(91,108,249,0.45)]">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-[#5B6CF9]/[0.07] blur-2xl" />
        <div className="pointer-events-none absolute -bottom-20 left-1/3 h-52 w-52 rounded-full bg-violet-400/[0.07] blur-2xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center">
          <div className="flex flex-1 items-start gap-5">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6B7BFF] to-[#4E5FEE] shadow-[0_8px_20px_-6px_rgba(91,108,249,0.7)]">
              <Sparkles className="h-7 w-7 text-white" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <h4 className="text-[21px] font-bold tracking-[-0.02em] text-slate-900">Google Gemini</h4>
              <p className="mt-1 max-w-md text-[13px] leading-relaxed text-slate-600">
                Most capable model for multilingual, natural and context-aware conversations.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {['Text', 'Images', 'Multimodal'].map((chip) => (
                  <span
                    key={chip}
                    className="rounded-lg bg-white/70 px-2.5 py-1 text-[11.5px] font-medium text-slate-600 ring-1 ring-white/80 backdrop-blur-sm"
                  >
                    {chip}
                  </span>
                ))}
                <AiBadge tone="emerald" className="px-2.5 py-1 font-semibold">Malayalam Ready</AiBadge>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4 border-slate-200/70 lg:flex-row lg:items-center lg:gap-8 lg:border-l lg:pl-8">
            <ul className="space-y-2">
              {GEMINI_STRENGTHS.map((s) => (
                <li key={s} className="flex items-center gap-2 text-[13px] text-slate-700">
                  <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                  {s}
                </li>
              ))}
            </ul>
            <AiButton onClick={onConfigure} size="lg" className="group">
              <Settings2 className="h-4 w-4" />
              Configure
              <ArrowRight className="h-4 w-4 transition-transform duration-200 motion-safe:group-hover:translate-x-0.5" />
            </AiButton>
          </div>
        </div>
      </div>

      {/* ── Not offered yet ── */}
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="text-[12px] font-medium text-slate-400">More providers coming soon</span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {COMING_SOON.map(({ id, label, blurb, Icon }) => (
          <div
            key={id}
            className="flex flex-col items-center rounded-2xl bg-slate-50/70 px-4 py-6 text-center ring-1 ring-slate-200/60"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white ring-1 ring-slate-200/70">
              <Icon className="h-5 w-5 text-slate-300" strokeWidth={1.75} />
            </span>
            <p className="mt-3 text-[13.5px] font-semibold text-slate-400">{label}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-400">{blurb}</p>
            <span className="mt-4 rounded-lg bg-white px-3 py-1 text-[11.5px] font-medium text-slate-400 ring-1 ring-slate-200/70">
              Coming Soon
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
