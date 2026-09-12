'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Bot, BookOpen, Save, Loader2,
  CheckCircle2, XCircle, Send,
  Sparkles, Settings2, BarChart3, FlaskConical,
} from 'lucide-react';
import { ProviderLanding } from './ai/provider-landing';
import { ConfigureWizard } from './ai/configure-wizard';
import { OverviewTab } from './ai/overview-tab';
import { TrainingTab } from './ai/training-tab';
import { AdvancedFeatures } from './ai/advanced-features';
import { TestTab } from './ai/test-tab';
import { UsageTab } from './ai/usage-tab';
import { EvalTab } from './ai/eval-tab';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

/* ── Provider metadata ────────────────────────────────────────────
 * Presentational mirror of src/lib/ai/providers/registry.ts's PROVIDERS
 * map — kept here rather than imported because that module also pulls in
 * server-only pieces (decrypt, provider SDKs/fetch logic) with no reason
 * to ship any of it to the browser just to render a picker.
 *
 * Gemini-only by deliberate choice (Sept 2026), not an oversight — this
 * app's actual customer base needs strong Malayalam/Indic-language
 * quality, and Gemini measurably outperforms OpenAI/Anthropic/DeepSeek
 * there (the same reasoning already applied to embeddings and chat
 * translation, see src/lib/ai/embeddings.ts and translate.ts). The
 * server-side adapters for the other providers (src/lib/ai/providers/
 * openai-compatible.ts, anthropic.ts) are left in place rather than
 * deleted — an account that already saved a non-Gemini key keeps it
 * working untouched (PUT /api/ai-config merges provider_keys, it never
 * overwrites an entry this screen doesn't mention) — this UI now simply
 * never offers picking one. */
interface ProviderMeta {
  id: string;
  label: string;
  defaultModels: { id: string; label: string }[];
}
// Model list verified directly against ai.google.dev, Sept 2026 (see the
// matching comment in src/lib/ai/providers/gemini.ts) — gemini-2.0-*/
// 1.5-* are shut down.
const PROVIDER_META: ProviderMeta[] = [
  {
    id: 'gemini', label: 'Google Gemini',
    defaultModels: [
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (recommended for CRM chat — fast, low cost)' },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (most capable Flash, best for complex replies)' },
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (cheapest, highest volume)' },
    ],
  },
];
const PROVIDER_LABEL: Record<string, string> = Object.fromEntries(PROVIDER_META.map((p) => [p.id, p.label]));

interface ProviderFieldState {
  /** New, unsaved plaintext key — empty means "keep whatever's already
   *  saved for this provider," never a request to clear it. */
  apiKey: string;
  model: string;
  /** "custom" only (optionally overrides "deepseek"'s default). */
  baseUrl: string;
  hasKey: boolean;
}
function emptyProviderFields(): Record<string, ProviderFieldState> {
  return Object.fromEntries(
    PROVIDER_META.map((p) => [p.id, { apiKey: '', model: p.defaultModels[0]?.id ?? '', baseUrl: '', hasKey: false }]),
  );
}

type ValidationStatus = 'idle' | 'checking' | 'valid' | 'invalid';

const AI_TABS = [
  { value: 'overview', label: 'Overview', Icon: Bot },
  { value: 'training', label: 'AI Training', Icon: BookOpen },
  { value: 'test', label: 'Test AI', Icon: Send },
  { value: 'accuracy', label: 'Accuracy', Icon: FlaskConical },
  { value: 'usage', label: 'Usage', Icon: BarChart3 },
] as const;

export function AiConfig() {
  const [tab, setTab] = useState<'overview' | 'training' | 'test' | 'accuracy' | 'usage'>('overview');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveOk, setSaveOk] = useState(false);

  // Always 'gemini' now — no other provider is offered from this screen
  // any more (see PROVIDER_META's own comment), so there's nothing left
  // to switch between and no separate fallback-provider concept.
  const activeProvider = 'gemini';
  const [providerFields, setProviderFields] = useState<Record<string, ProviderFieldState>>(emptyProviderFields);

  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  // '' = auto-detect (reply in the customer's own language) — see the
  // schema comment on AiConfig.reply_language for why that's the default.
  const [replyLanguage, setReplyLanguage] = useState('');
  const [safetyFilter, setSafetyFilter] = useState('balanced');
  const [wizardOpen, setWizardOpen] = useState(false);
  // Retrieval controls surfaced on the Training tab — defaults match what
  // knowledge.ts did before they were configurable.
  const [knowledgeBaseEnabled, setKnowledgeBaseEnabled] = useState(true);
  const [retrievalMode, setRetrievalMode] = useState('auto');
  const [maxContextResults, setMaxContextResults] = useState(5);
  const [autoSyncWebsite, setAutoSyncWebsite] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [adminSystemPrompt, setAdminSystemPrompt] = useState('');
  const [customerContextEnabled, setCustomerContextEnabled] = useState(true);
  const [fallbackAnswer, setFallbackAnswer] = useState('');
  const [escalationTopics, setEscalationTopics] = useState<string[]>([]);
  const [topicInput, setTopicInput] = useState('');

  // Accuracy checks and voice replies. Both default on: a reply carrying
  // an invented price is worse than a slow one, and someone who sends a
  // voice note is telling you something about how they want answering.
  const [responseValidationEnabled, setResponseValidationEnabled] = useState(true);
  const [compositeConfidenceEnabled, setCompositeConfidenceEnabled] = useState(true);
  const [voiceReplyEnabled, setVoiceReplyEnabled] = useState(true);
  const [voiceName, setVoiceName] = useState('Kore');
  const [voiceMaxChars, setVoiceMaxChars] = useState(700);

  // Confidence-based handoff — off by default; see the schema comment on
  // AiConfig.low_confidence_handoff_enabled for why.
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.35);
  const [lowConfidenceHandoffEnabled, setLowConfidenceHandoffEnabled] = useState(false);
  const [lowConfidenceAssignTo, setLowConfidenceAssignTo] = useState('');
  const [lowConfidenceMessage, setLowConfidenceMessage] = useState('');
  const [semanticSearchAvailable, setSemanticSearchAvailable] = useState(false);
  const [agents, setAgents] = useState<{ user_id: string; full_name: string }[]>([]);

  // API key validation — scoped to whichever provider tile is selected.
  const [validationStatus, setValidationStatus] = useState<ValidationStatus>('idle');
  const [validationMsg, setValidationMsg] = useState('');
  const validateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);


  const activeMeta = PROVIDER_META.find((p) => p.id === activeProvider) ?? PROVIDER_META[0];
  const activeFields = providerFields[activeProvider];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai-config');
      const data = await res.json();
      if (data) {
        setProviderFields((prev) => {
          const next = { ...prev };
          const keys = (data.provider_keys ?? {}) as Record<string, { model?: string; base_url?: string; has_key?: boolean }>;
          // Only Gemini's saved entry is loaded into editable state — a
          // legacy non-Gemini key (if any account still has one) stays
          // in the database untouched, just not surfaced on this screen.
          const entry = keys.gemini;
          if (entry) {
            next.gemini = {
              apiKey: '',
              model: entry.model ?? PROVIDER_META[0].defaultModels[0]?.id ?? '',
              baseUrl: entry.base_url ?? '',
              hasKey: !!entry.has_key,
            };
          }
          return next;
        });
        setTemperature(data.temperature ?? 0.7);
        setMaxTokens(data.max_tokens ?? 2048);
        setReplyLanguage(data.reply_language ?? '');
        setSafetyFilter(data.safety_filter ?? 'balanced');
        setKnowledgeBaseEnabled(data.knowledge_base_enabled ?? true);
        setRetrievalMode(data.retrieval_mode ?? 'auto');
        setMaxContextResults(data.max_context_results ?? 5);
        setAutoSyncWebsite(data.auto_sync_website ?? false);
        setSystemPrompt(data.system_prompt ?? '');
        setAdminSystemPrompt(data.admin_system_prompt ?? '');
        setCustomerContextEnabled(data.customer_context_enabled ?? true);
        setFallbackAnswer(data.fallback_answer ?? '');
        setEscalationTopics(Array.isArray(data.escalation_topics) ? data.escalation_topics : []);
        setConfidenceThreshold(data.confidence_threshold ?? 0.35);
        setLowConfidenceHandoffEnabled(!!data.low_confidence_handoff_enabled);
        setLowConfidenceAssignTo(data.low_confidence_assign_to ?? '');
        setLowConfidenceMessage(data.low_confidence_message ?? '');
        setSemanticSearchAvailable(!!data.semantic_search_available);
        setResponseValidationEnabled(data.response_validation_enabled ?? true);
        setCompositeConfidenceEnabled(data.composite_confidence_enabled ?? true);
        setVoiceReplyEnabled(data.voice_reply_enabled ?? true);
        setVoiceName(data.voice_name ?? 'Kore');
        setVoiceMaxChars(data.voice_max_chars ?? 700);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Same "assignable agents" fetch the handoff flow-builder node uses,
  // for the low-confidence handoff's own assignee picker below.
  useEffect(() => {
    fetch('/api/account/members')
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => {
        const members = (d.members ?? []) as { user_id: string; full_name: string; role: string }[];
        setAgents(members.filter((m) => m.role === 'agent'));
      })
      .catch(() => {});
  }, []);

  const validateKey = useCallback(async (providerId: string, key: string, model: string, baseUrl: string) => {
    if (!key.trim()) {
      setValidationStatus('idle');
      setValidationMsg('');
      return;
    }
    if (key.trim().length < 10) {
      setValidationStatus('invalid');
      setValidationMsg('Key looks too short.');
      return;
    }
    setValidationStatus('checking');
    setValidationMsg('');
    try {
      const res = await fetch('/api/ai-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: providerId,
          api_key: key.trim(),
          model,
          base_url: baseUrl.trim() || undefined,
          message: 'Say "OK" in one word.',
        }),
      });
      const data = await res.json();
      if (res.ok && data.reply) {
        setValidationStatus('valid');
        setValidationMsg(`${PROVIDER_LABEL[providerId]} key is valid and working.`);
      } else {
        setValidationStatus('invalid');
        setValidationMsg(data.error ?? 'Key validation failed.');
      }
    } catch {
      setValidationStatus('invalid');
      setValidationMsg('Network error during validation.');
    }
  }, []);

  function updateActiveField(field: keyof ProviderFieldState, value: string) {
    setProviderFields((prev) => ({ ...prev, [activeProvider]: { ...prev[activeProvider], [field]: value } }));
  }

  function handleApiKeyChange(val: string) {
    updateActiveField('apiKey', val);
    setValidationStatus('idle');
    setValidationMsg('');
    if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
    if (val.trim()) {
      const model = activeFields?.model ?? '';
      const baseUrl = activeFields?.baseUrl ?? '';
      validateTimerRef.current = setTimeout(() => validateKey(activeProvider, val, model, baseUrl), 800);
    }
  }

  /** Returns whether the save actually succeeded — the Configure wizard
   *  only closes itself on a real success, rather than dismissing over an
   *  error the user would then never see. */
  const save = async (overrides?: { maxTokens?: number }): Promise<boolean> => {
    setSaving(true);
    setSaveError('');
    setSaveOk(false);
    try {
      if (!activeFields?.hasKey && !activeFields?.apiKey.trim()) {
        setSaveError(`Enter an API key for ${activeMeta.label} first.`);
        setSaving(false);
        return false;
      }
      // The customer prompt is required, not advisory. Without it the
      // bot answers as a generic assistant with no idea what business it
      // works for or how it should behave — which is worse than not
      // replying, because it looks like it is working. Blocked at save
      // rather than at reply time so an account that already has one
      // running is never cut off mid-conversation by a validation rule.
      if (!systemPrompt.trim()) {
        setSaveError(
          'A customer prompt is required — open Advanced Features under AI Training to write one, or start from the template.',
        );
        setSaving(false);
        return false;
      }
      const providerKeys: Record<string, { api_key?: string; model?: string; base_url?: string }> = {};
      for (const meta of PROVIDER_META) {
        const f = providerFields[meta.id];
        if (!f) continue;
        if (f.apiKey.trim() || f.hasKey) {
          providerKeys[meta.id] = {
            api_key: f.apiKey.trim() || undefined,
            model: f.model || undefined,
            base_url: f.baseUrl.trim() || undefined,
          };
        }
      }
      const res = await fetch('/api/ai-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          active_provider: activeProvider,
          // No other provider is offered from this screen any more —
          // explicitly clears any fallback a legacy config might still
          // have pointed at a hidden provider, rather than leaving a
          // stale reference nothing here can show or edit.
          fallback_provider: null,
          provider_keys: providerKeys,
          temperature,
          max_tokens: overrides?.maxTokens ?? maxTokens,
          system_prompt: systemPrompt || null,
          fallback_answer: fallbackAnswer || null,
          escalation_topics: escalationTopics,
          confidence_threshold: confidenceThreshold,
          low_confidence_handoff_enabled: lowConfidenceHandoffEnabled,
          low_confidence_assign_to: lowConfidenceAssignTo || null,
          low_confidence_message: lowConfidenceMessage || null,
          reply_language: replyLanguage || null,
          safety_filter: safetyFilter,
          knowledge_base_enabled: knowledgeBaseEnabled,
          retrieval_mode: retrievalMode,
          max_context_results: maxContextResults,
          auto_sync_website: autoSyncWebsite,
          admin_system_prompt: adminSystemPrompt || null,
          customer_context_enabled: customerContextEnabled,
          response_validation_enabled: responseValidationEnabled,
          composite_confidence_enabled: compositeConfidenceEnabled,
          voice_reply_enabled: voiceReplyEnabled,
          voice_name: voiceName,
          voice_max_chars: voiceMaxChars,
        }),
      });
      if (res.ok) {
        setProviderFields((prev) => ({
          ...prev,
          [activeProvider]: { ...prev[activeProvider], apiKey: '', hasKey: true },
        }));
        setValidationStatus('idle');
        setSaveOk(true);
        setTimeout(() => setSaveOk(false), 3000);
        return true;
      }
      const d = await res.json();
      setSaveError(d.error ?? 'Save failed.');
      return false;
    } catch {
      setSaveError('Network error.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  function addTopic() {
    const t = topicInput.trim();
    if (!t || escalationTopics.includes(t)) return;
    setEscalationTopics((prev) => [...prev, t]);
    setTopicInput('');
  }
  const removeTopic = (t: string) => setEscalationTopics((prev) => prev.filter((x) => x !== t));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-[#5B6CF9]" />
      </div>
    );
  }

  const anyKeyConfigured = PROVIDER_META.some((p) => providerFields[p.id]?.hasKey);

  const wizard = (
    <ConfigureWizard
      open={wizardOpen}
      onOpenChange={setWizardOpen}
      models={activeMeta.defaultModels}
      apiKey={activeFields?.apiKey ?? ''}
      onApiKeyChange={handleApiKeyChange}
      hasSavedKey={!!activeFields?.hasKey}
      validationStatus={validationStatus}
      validationMsg={validationMsg}
      model={activeFields?.model ?? ''}
      onModelChange={(v) => updateActiveField('model', v)}
      temperature={temperature}
      onTemperatureChange={setTemperature}
      maxTokens={maxTokens}
      onMaxTokensChange={setMaxTokens}
      replyLanguage={replyLanguage}
      onReplyLanguageChange={setReplyLanguage}
      safetyFilter={safetyFilter}
      onSafetyFilterChange={setSafetyFilter}
      saving={saving}
      saveError={saveError}
      onSave={save}
    />
  );

  // Nothing connected yet — the provider landing is the whole screen,
  // with the wizard as its only action. No tabs: there's nothing to
  // train or test against until a key exists.
  if (!anyKeyConfigured) {
    return (
      <>
        <ProviderLanding onConfigure={() => setWizardOpen(true)} />
        {wizard}
      </>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Connected header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Sparkles className="mt-0.5 h-8 w-8 shrink-0 text-[#5B6CF9]" strokeWidth={1.5} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[18px] font-bold tracking-[-0.02em] text-slate-900 sm:text-[20px]">{activeMeta.label}</h2>
              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-0.5 text-[11.5px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Connected
              </span>
            </div>
            <p className="mt-0.5 max-w-prose text-[12.5px] leading-relaxed text-slate-500 sm:text-[13px]">
              Your AI assistant is ready to use. Manage settings, train with your data, and test performance.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => setWizardOpen(true)}
          className="h-9 shrink-0 gap-2 rounded-xl border-slate-200 bg-white px-4 text-[13px]"
        >
          <Settings2 className="h-4 w-4 text-slate-400" />
          Reconfigure
        </Button>
      </div>

      {wizard}

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        {/* -mx-1 px-1 keeps the focus ring of the first/last trigger from
            being clipped by the scroll container. */}
        <TabsList className="-mx-1 h-10 max-w-full overflow-x-auto rounded-xl bg-slate-100 p-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {AI_TABS.map(({ value, label, Icon }) => (
            <TabsTrigger
              key={value}
              value={value}
              className="shrink-0 gap-1.5 whitespace-nowrap rounded-lg px-3 text-[12.5px] transition-all duration-150 data-active:bg-white data-active:text-[#5B6CF9] data-active:shadow-[0_1px_2px_rgba(15,23,42,0.06),0_2px_8px_-2px_rgba(15,23,42,0.12)]"
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── Overview tab ── */}
        <TabsContent value="overview" className="mt-4">
          <OverviewTab
            model={activeFields?.model ?? ''}
            modelLabel={activeMeta.defaultModels.find((m) => m.id === activeFields?.model)?.label ?? activeFields?.model ?? ''}
            temperature={temperature}
            maxTokens={maxTokens}
            replyLanguage={replyLanguage}
            safetyFilter={safetyFilter}
            semanticSearchAvailable={semanticSearchAvailable}
            systemPromptMissing={!systemPrompt.trim()}
            onReconfigure={() => setWizardOpen(true)}
            onGoToTab={setTab}
          />
        </TabsContent>

        {/* ── Usage tab ── not wired to anything yet: no AI call in this
            app records tokens or cost, so there is genuinely nothing to
            chart. Says so plainly instead of rendering empty axes. */}
        <TabsContent value="accuracy" className="mt-4">
          <EvalTab configured={anyKeyConfigured} />
        </TabsContent>

        <TabsContent value="usage" className="mt-4">
          <UsageTab />
        </TabsContent>


        {/* ── Training tab ── */}
        <TabsContent value="training" className="mt-4 space-y-5">
          <TrainingTab
            knowledgeBaseEnabled={knowledgeBaseEnabled}
            onKnowledgeBaseEnabledChange={setKnowledgeBaseEnabled}
            retrievalMode={retrievalMode}
            onRetrievalModeChange={setRetrievalMode}
            maxContextResults={maxContextResults}
            onMaxContextResultsChange={setMaxContextResults}
            autoSyncWebsite={autoSyncWebsite}
            onAutoSyncWebsiteChange={setAutoSyncWebsite}
            semanticSearchAvailable={semanticSearchAvailable}
            onSaveSettings={save}
            savingSettings={saving}
            rail={
            <AdvancedFeatures
              systemPrompt={systemPrompt}
              onSystemPromptChange={setSystemPrompt}
              adminSystemPrompt={adminSystemPrompt}
              onAdminSystemPromptChange={setAdminSystemPrompt}
              customerContextEnabled={customerContextEnabled}
              onCustomerContextEnabledChange={setCustomerContextEnabled}
              fallbackAnswer={fallbackAnswer}
              onFallbackAnswerChange={setFallbackAnswer}
              escalationTopics={escalationTopics}
              topicInput={topicInput}
              onTopicInputChange={setTopicInput}
              onAddTopic={addTopic}
              onRemoveTopic={removeTopic}
              lowConfidenceHandoffEnabled={lowConfidenceHandoffEnabled}
              onLowConfidenceHandoffEnabledChange={setLowConfidenceHandoffEnabled}
              confidenceThreshold={confidenceThreshold}
              onConfidenceThresholdChange={setConfidenceThreshold}
              lowConfidenceAssignTo={lowConfidenceAssignTo}
              onLowConfidenceAssignToChange={setLowConfidenceAssignTo}
              lowConfidenceMessage={lowConfidenceMessage}
              onLowConfidenceMessageChange={setLowConfidenceMessage}
              agents={agents}
              semanticSearchAvailable={semanticSearchAvailable}
              responseValidationEnabled={responseValidationEnabled}
              onResponseValidationEnabledChange={setResponseValidationEnabled}
              compositeConfidenceEnabled={compositeConfidenceEnabled}
              onCompositeConfidenceEnabledChange={setCompositeConfidenceEnabled}
              voiceReplyEnabled={voiceReplyEnabled}
              onVoiceReplyEnabledChange={setVoiceReplyEnabled}
              voiceName={voiceName}
              onVoiceNameChange={setVoiceName}
              voiceMaxChars={voiceMaxChars}
              onVoiceMaxCharsChange={setVoiceMaxChars}
            />
            }
          />
        </TabsContent>

        {/* ── Test AI tab ── */}
        <TabsContent value="test" className="mt-4">
          <TestTab
            model={activeFields?.model ?? ''}
            temperature={temperature}
            maxTokens={maxTokens}
            systemPrompt={systemPrompt}
            safetyFilter={safetyFilter}
            replyLanguage={replyLanguage}
            unsavedApiKey={activeFields?.apiKey ?? ''}
            semanticSearchAvailable={semanticSearchAvailable}
            onRaiseMaxTokens={(value) => {
              setMaxTokens(value);
              // Saved immediately: the point of the button is that the
              // next message isn't cut off too, and that only holds if
              // the new ceiling is actually persisted.
              void save({ maxTokens: value });
            }}
          />
        </TabsContent>
      </Tabs>

      {/* Save bar */}
      <div className="flex items-center justify-between">
        <div className="text-[12.5px]">
          {saveError && (
            <span className="flex items-center gap-1.5 text-rose-600">
              <XCircle className="h-4 w-4" />
              {saveError}
            </span>
          )}
          {saveOk && (
            <span className="flex items-center gap-1.5 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
              Settings saved.
            </span>
          )}
          {!saveError && !saveOk && !anyKeyConfigured && (
            <span className="text-slate-400">No AI provider configured yet.</span>
          )}
        </div>
        <Button onClick={() => void save()} disabled={saving} className="h-9 px-5 text-[13px] gap-2 bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save AI Settings
        </Button>
      </div>
    </div>
  );
}
