'use client';

import { useState } from 'react';
import {
  Check, Eye, EyeOff, ExternalLink, Loader2, ArrowRight, ArrowLeft,
  CheckCircle2, XCircle, Sparkles, ShieldCheck,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AiButton, AiModal, AiModalHeader, AiModalBody, AiModalFooter,
  AiInput, AiLabel, AiHint, AiNotice, AiIconTile,
} from './ui-kit';

/**
 * Screen 2 — the connect flow, as a three-step wizard instead of the old
 * single wall of fields: API key (with the live validation call that
 * already existed), then model/behavior, then a review before writing
 * anything. Everything here is driven by the caller's existing config
 * state, so the wizard holds no duplicate source of truth — it only
 * decides which step is showing.
 */

export interface WizardModel {
  id: string;
  label: string;
}

export interface ConfigureWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: WizardModel[];

  /** API key — empty string means "keep whatever is already saved". */
  apiKey: string;
  onApiKeyChange: (v: string) => void;
  hasSavedKey: boolean;
  validationStatus: 'idle' | 'checking' | 'valid' | 'invalid';
  validationMsg: string;

  model: string;
  onModelChange: (v: string) => void;
  temperature: number;
  onTemperatureChange: (v: number) => void;
  maxTokens: number;
  onMaxTokensChange: (v: number) => void;
  replyLanguage: string;
  onReplyLanguageChange: (v: string) => void;
  safetyFilter: string;
  onSafetyFilterChange: (v: string) => void;

  saving: boolean;
  saveError: string;
  onSave: () => Promise<boolean>;
}

const STEPS = [
  { n: 1, title: 'API Configuration', sub: 'Connect your account' },
  { n: 2, title: 'Model & Parameters', sub: 'Set preferences' },
  { n: 3, title: 'Review & Save', sub: 'Confirm and finish' },
];

/** Quick-pick languages, matching the set the inbox translation panel
 *  offers — "Auto-detect" (empty value) stays the default. */
const LANGUAGES = ['Auto-detect', 'Malayalam', 'English', 'Tamil', 'Hindi', 'Arabic'];

const SAFETY_OPTIONS = [
  { id: 'strict', label: 'Strict — block anything borderline' },
  { id: 'balanced', label: 'Balanced (recommended)' },
  { id: 'relaxed', label: 'Relaxed — block only clearly harmful' },
];

export function ConfigureWizard(props: ConfigureWizardProps) {
  const { open, onOpenChange, models } = props;
  const [step, setStep] = useState(1);
  const [showKey, setShowKey] = useState(false);

  const keyReady = props.hasSavedKey || props.validationStatus === 'valid' || props.apiKey.trim().length >= 10;
  const modelLabel = models.find((m) => m.id === props.model)?.label ?? props.model;

  function close() {
    onOpenChange(false);
    // Reset to step 1 for the next open — a wizard that reopens on the
    // review step would be confusing after a cancel.
    setTimeout(() => setStep(1), 200);
  }

  async function handleSave() {
    const ok = await props.onSave();
    if (ok) close();
  }

  return (
    <AiModal open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())} size="lg">
      <div>
        <AiModalHeader
          icon={
            <AiIconTile
              size="lg"
              className="bg-gradient-to-br from-[#6B7BFF] to-[#4E5FEE] text-white ring-0 shadow-[0_8px_20px_-6px_rgba(91,108,249,0.7)]"
            >
              <Sparkles className="h-5 w-5" strokeWidth={1.75} />
            </AiIconTile>
          }
          title="Configure Google Gemini"
          subtitle="Set up Gemini in just a few steps"
          onClose={close}
        />

        <div className="px-5 pb-5 sm:px-6">
          {/* ── Stepper ── */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {STEPS.map((s, i) => (
              <div key={s.n} className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
                <div className="flex items-center gap-2.5">
                  <span
                    className={[
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[13px] font-semibold transition-all duration-200',
                      step > s.n
                        ? 'bg-emerald-500 text-white shadow-[0_4px_12px_-4px_rgba(16,185,129,0.6)]'
                        : step === s.n
                          ? 'bg-gradient-to-b from-[#6B7BFF] to-[#5B6CF9] text-white shadow-[0_4px_12px_-4px_rgba(91,108,249,0.7)]'
                          : 'bg-slate-100 text-slate-400',
                    ].join(' ')}
                  >
                    {step > s.n ? <Check className="h-4 w-4" /> : s.n}
                  </span>
                  <div className="hidden min-w-0 sm:block">
                    <p className={`truncate text-[12.5px] font-semibold ${step >= s.n ? 'text-slate-800' : 'text-slate-400'}`}>
                      {s.title}
                    </p>
                    <p className="truncate text-[11px] text-slate-400">{s.sub}</p>
                  </div>
                </div>
                {i < STEPS.length - 1 && (
                  <span
                    className={`h-0.5 flex-1 rounded-full transition-colors duration-300 ${
                      step > s.n ? 'bg-emerald-400' : 'bg-slate-200'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <AiModalBody className="grid gap-6 px-5 py-5 sm:px-6 sm:py-6 xl:grid-cols-[minmax(0,1fr)_250px]">
          <div className="min-w-0 space-y-4">
            {step === 1 && (
              <>
                <div>
                  <h4 className="text-[15px] font-semibold text-slate-900">API Key</h4>
                  <p className="mt-0.5 text-[12.5px] text-slate-500">
                    Enter your Google Gemini API key to connect your account.
                  </p>
                </div>
                <div className="relative">
                  <AiInput
                    type={showKey ? 'text' : 'password'}
                    // Not an account credential — see the identical note on
                    // the old AI Config key field: browsers ignore
                    // autoComplete="off" on password inputs, so this has to
                    // be "new-password" to stop the saved login password
                    // being filled in here.
                    autoComplete="new-password"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-bwignore="true"
                    data-form-type="other"
                    value={props.apiKey}
                    onChange={(e) => props.onApiKeyChange(e.target.value)}
                    placeholder={props.hasSavedKey ? '•••••••••••••••••••••••' : 'Paste your Gemini API key…'}
                    className="h-11 pr-11 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    aria-label={showKey ? 'Hide key' : 'Show key'}
                    className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#5B6CF9] hover:underline"
                >
                  Get API key from Google AI Studio
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>

                {props.validationStatus === 'checking' && (
                  <AiNotice tone="info" icon={<Loader2 className="h-4 w-4 animate-spin" />}>
                    Checking this key against Gemini…
                  </AiNotice>
                )}
                {props.validationStatus === 'valid' && (
                  <AiNotice tone="success" icon={<CheckCircle2 className="h-4 w-4" />}>
                    {props.validationMsg || 'Key is valid and working.'}
                  </AiNotice>
                )}
                {props.validationStatus === 'invalid' && (
                  <AiNotice tone="error" icon={<XCircle className="h-4 w-4" />}>
                    {props.validationMsg || 'Key validation failed.'}
                  </AiNotice>
                )}
                {props.hasSavedKey && !props.apiKey.trim() && props.validationStatus === 'idle' && (
                  <AiNotice tone="success" icon={<CheckCircle2 className="h-4 w-4" />}>
                    A key is already saved. Leave this blank to keep it, or paste a new one to replace it.
                  </AiNotice>
                )}
              </>
            )}

            {step === 2 && (
              <>
                <div>
                  <h4 className="text-[15px] font-semibold text-slate-900">Model &amp; Parameters</h4>
                  <p className="mt-0.5 text-[12.5px] text-slate-500">How the assistant should generate replies.</p>
                </div>

                <div className="space-y-1.5">
                  <AiLabel>Model</AiLabel>
                  <Select value={props.model} onValueChange={(v) => v && props.onModelChange(v)}>
                    <SelectTrigger className="h-10 w-full rounded-xl border-slate-200 text-[13px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {models.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <AiLabel>
                      Temperature
                      <span className="ml-2 text-[11px] font-normal text-slate-400">
                        {props.temperature} (0 = precise, 1 = creative)
                      </span>
                    </AiLabel>
                    <input
                      autoComplete="off"
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={props.temperature}
                      onChange={(e) => props.onTemperatureChange(Number(e.target.value))}
                      className="w-full accent-[#5B6CF9]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <AiLabel>Max Response Tokens</AiLabel>
                    <AiInput
                      type="number"
                      min={50}
                      max={2048}
                      step={50}
                      value={props.maxTokens}
                      onChange={(e) => props.onMaxTokensChange(Number(e.target.value))}
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <AiLabel>Reply language</AiLabel>
                    <Select
                      value={props.replyLanguage || 'Auto-detect'}
                      onValueChange={(v) => props.onReplyLanguageChange(!v || v === 'Auto-detect' ? '' : v)}
                    >
                      <SelectTrigger className="h-10 w-full rounded-xl border-slate-200 text-[13px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LANGUAGES.map((l) => (
                          <SelectItem key={l} value={l}>{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <AiHint>Auto-detect replies in whatever language the customer wrote in.</AiHint>
                  </div>
                  <div className="space-y-1.5">
                    <AiLabel>Safety filter</AiLabel>
                    <Select value={props.safetyFilter} onValueChange={(v) => v && props.onSafetyFilterChange(v)}>
                      <SelectTrigger className="h-10 w-full rounded-xl border-slate-200 text-[13px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SAFETY_OPTIONS.map((o) => (
                          <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <AiHint>Gemini&apos;s own content filtering threshold.</AiHint>
                  </div>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <div>
                  <h4 className="text-[15px] font-semibold text-slate-900">Review &amp; Save</h4>
                  <p className="mt-0.5 text-[12.5px] text-slate-500">Confirm these settings before connecting.</p>
                </div>
                <dl className="divide-y divide-slate-100 overflow-hidden rounded-2xl ring-1 ring-slate-200/80">
                  {[
                    ['Provider', 'Google Gemini'],
                    ['API key', props.apiKey.trim() ? 'New key entered' : props.hasSavedKey ? 'Existing saved key kept' : 'Not set'],
                    ['Model', modelLabel],
                    ['Temperature', String(props.temperature)],
                    ['Max response tokens', String(props.maxTokens)],
                    ['Reply language', props.replyLanguage || 'Auto-detect'],
                    ['Safety filter', SAFETY_OPTIONS.find((o) => o.id === props.safetyFilter)?.label ?? props.safetyFilter],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-4 bg-white px-4 py-2.5">
                      <dt className="text-[12.5px] text-slate-500">{k}</dt>
                      <dd className="truncate text-[13px] font-medium text-slate-800">{v}</dd>
                    </div>
                  ))}
                </dl>
                {props.saveError && (
                  <AiNotice tone="error" icon={<XCircle className="h-4 w-4" />}>{props.saveError}</AiNotice>
                )}
              </>
            )}
          </div>

          {/* ── Side rail ── */}
          <aside className="h-fit rounded-2xl bg-gradient-to-br from-[#EFF1FF] to-[#F7F8FF] p-5 ring-1 ring-[#5B6CF9]/10">
            <Sparkles className="h-7 w-7 text-[#5B6CF9]" strokeWidth={1.5} />
            <p className="mt-3 text-[15px] font-bold text-slate-900">Why Google Gemini?</p>
            <ul className="mt-3 space-y-2.5">
              {[
                'High quality, natural responses',
                'Strong Malayalam and Indic languages',
                'Cost efficient at chat volume',
              ].map((s) => (
                <li key={s} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-slate-700">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#5B6CF9]" />
                  {s}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-start gap-2 border-t border-[#5B6CF9]/15 pt-4 text-[11.5px] leading-relaxed text-slate-500">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              Your key is encrypted before it&apos;s stored and never sent back to this screen.
            </div>
          </aside>
        </AiModalBody>

        <AiModalFooter>
          {step === 1 ? (
            <AiButton tone="outline" onClick={close}>Cancel</AiButton>
          ) : (
            <AiButton tone="outline" onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </AiButton>
          )}

          {step < 3 ? (
            <AiButton onClick={() => setStep((s) => s + 1)} disabled={step === 1 && !keyReady} className="group">
              Next
              <ArrowRight className="h-4 w-4 transition-transform duration-200 motion-safe:group-hover:translate-x-0.5" />
            </AiButton>
          ) : (
            <AiButton onClick={handleSave} disabled={props.saving}>
              {props.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save &amp; Connect
            </AiButton>
          )}
        </AiModalFooter>
      </div>
    </AiModal>
  );
}
