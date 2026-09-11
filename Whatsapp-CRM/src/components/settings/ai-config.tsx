'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Trash2, Bot, BookOpen, Save, Eye, EyeOff, Loader2,
  CheckCircle2, XCircle, Send, RotateCcw, X, ShieldQuestion,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';

/* ── Provider metadata ────────────────────────────────────────────
 * Presentational mirror of src/lib/ai/providers/registry.ts's PROVIDERS
 * map — kept here rather than imported because that module also pulls in
 * server-only pieces (decrypt, provider SDKs/fetch logic) with no reason
 * to ship any of it to the browser just to render a picker. Adding a new
 * provider means updating both this list and the registry, the same way
 * ads-tab.tsx's ProviderRail hardcodes its own tile labels locally. */
interface ProviderMeta {
  id: string;
  label: string;
  defaultModels: { id: string; label: string }[];
}
// Model lists verified directly against each vendor's official docs,
// Sept 2026 (see matching comments in src/lib/ai/providers/*.ts, which
// this mirrors) — gemini-2.0-*/1.5-* are shut down, gpt-4o/4.1 and
// deepseek-chat/deepseek-reasoner are legacy aliases on their way out.
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
  {
    id: 'openai', label: 'OpenAI (GPT)',
    defaultModels: [
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra (recommended for CRM chat)' },
      { id: 'gpt-6-astra', label: 'GPT-6 Astra (flagship, best for complex replies)' },
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna (cheapest, highest volume)' },
    ],
  },
  {
    id: 'anthropic', label: 'Anthropic (Claude)',
    defaultModels: [
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (recommended for CRM chat)' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fastest, cheapest)' },
      { id: 'claude-opus-5', label: 'Claude Opus 5 (Anthropic’s pick for most workloads)' },
      { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 (demanding reasoning, long-horizon agents)' },
    ],
  },
  {
    id: 'deepseek', label: 'DeepSeek',
    defaultModels: [
      { id: 'deepseek-v4-flash', label: 'DeepSeek-V4-Flash (recommended for CRM chat)' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro (highest quality)' },
    ],
  },
  {
    id: 'custom', label: 'Custom (OpenAI-compatible)',
    defaultModels: [], // no fixed list for an arbitrary endpoint — free-text input instead
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

interface TrainingPair {
  question: string;
  answer: string;
}
interface KnowledgeDoc {
  id: string;
  title: string;
  content: string;
}

type ValidationStatus = 'idle' | 'checking' | 'valid' | 'invalid';

interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
  /** Only meaningful on 'ai' messages — whether this turn has already
   *  been saved as a training Q&A pair via the feedback-loop button. */
  saved?: boolean;
}

export function AiConfig() {
  const [tab, setTab] = useState<'config' | 'training' | 'test'>('config');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveOk, setSaveOk] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const [activeProvider, setActiveProvider] = useState('gemini');
  const [fallbackProvider, setFallbackProvider] = useState(''); // '' = none
  const [providerFields, setProviderFields] = useState<Record<string, ProviderFieldState>>(emptyProviderFields);

  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(500);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [trainingPairs, setTrainingPairs] = useState<TrainingPair[]>([{ question: '', answer: '' }]);
  const [documents, setDocuments] = useState<KnowledgeDoc[]>([]);
  const [fallbackAnswer, setFallbackAnswer] = useState('');
  const [escalationTopics, setEscalationTopics] = useState<string[]>([]);
  const [topicInput, setTopicInput] = useState('');

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

  // Test AI chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState('');
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const activeMeta = PROVIDER_META.find((p) => p.id === activeProvider) ?? PROVIDER_META[0];
  const activeFields = providerFields[activeProvider];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai-config');
      const data = await res.json();
      if (data) {
        setActiveProvider(data.active_provider ?? 'gemini');
        setFallbackProvider(data.fallback_provider ?? '');
        setProviderFields((prev) => {
          const next = { ...prev };
          const keys = (data.provider_keys ?? {}) as Record<string, { model?: string; base_url?: string; has_key?: boolean }>;
          for (const [id, entry] of Object.entries(keys)) {
            const meta = PROVIDER_META.find((p) => p.id === id);
            next[id] = {
              apiKey: '',
              model: entry.model ?? meta?.defaultModels[0]?.id ?? '',
              baseUrl: entry.base_url ?? '',
              hasKey: !!entry.has_key,
            };
          }
          return next;
        });
        setTemperature(data.temperature ?? 0.7);
        setMaxTokens(data.max_tokens ?? 500);
        setSystemPrompt(data.system_prompt ?? '');
        const pairs =
          Array.isArray(data.training_data) && data.training_data.length > 0
            ? data.training_data
            : [{ question: '', answer: '' }];
        setTrainingPairs(pairs);
        setDocuments(Array.isArray(data.knowledge_documents) ? data.knowledge_documents : []);
        setFallbackAnswer(data.fallback_answer ?? '');
        setEscalationTopics(Array.isArray(data.escalation_topics) ? data.escalation_topics : []);
        setConfidenceThreshold(data.confidence_threshold ?? 0.35);
        setLowConfidenceHandoffEnabled(!!data.low_confidence_handoff_enabled);
        setLowConfidenceAssignTo(data.low_confidence_assign_to ?? '');
        setLowConfidenceMessage(data.low_confidence_message ?? '');
        setSemanticSearchAvailable(!!data.semantic_search_available);
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

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

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

  function selectProvider(id: string) {
    setActiveProvider(id);
    setValidationStatus('idle');
    setValidationMsg('');
  }

  const save = async () => {
    setSaving(true);
    setSaveError('');
    setSaveOk(false);
    try {
      if (!activeFields?.hasKey && !activeFields?.apiKey.trim()) {
        setSaveError(`Enter an API key for ${activeMeta.label} first.`);
        setSaving(false);
        return;
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
      const pairs = trainingPairs.filter((p) => p.question.trim() && p.answer.trim());
      const res = await fetch('/api/ai-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          active_provider: activeProvider,
          fallback_provider: fallbackProvider || null,
          provider_keys: providerKeys,
          temperature,
          max_tokens: maxTokens,
          system_prompt: systemPrompt || null,
          training_data: pairs.length > 0 ? pairs : null,
          knowledge_documents: documents.filter((d) => d.title.trim() && d.content.trim()),
          fallback_answer: fallbackAnswer || null,
          escalation_topics: escalationTopics,
          confidence_threshold: confidenceThreshold,
          low_confidence_handoff_enabled: lowConfidenceHandoffEnabled,
          low_confidence_assign_to: lowConfidenceAssignTo || null,
          low_confidence_message: lowConfidenceMessage || null,
        }),
      });
      if (res.ok) {
        setProviderFields((prev) => ({
          ...prev,
          [activeProvider]: { ...prev[activeProvider], apiKey: '', hasKey: true },
          ...(fallbackProvider
            ? { [fallbackProvider]: { ...prev[fallbackProvider], apiKey: '', hasKey: prev[fallbackProvider]?.hasKey || !!prev[fallbackProvider]?.apiKey.trim() } }
            : {}),
        }));
        setValidationStatus('idle');
        setSaveOk(true);
        setTimeout(() => setSaveOk(false), 3000);
      } else {
        const d = await res.json();
        setSaveError(d.error ?? 'Save failed.');
      }
    } catch {
      setSaveError('Network error.');
    } finally {
      setSaving(false);
    }
  };

  const sendChat = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    setChatInput('');
    setChatError('');
    setChatMessages((prev) => [...prev, { role: 'user', text: msg }]);
    setChatLoading(true);
    try {
      const pairs = trainingPairs.filter((p) => p.question.trim() && p.answer.trim());
      const res = await fetch('/api/ai-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          provider: activeProvider,
          api_key: activeFields?.apiKey || undefined,
          model: activeFields?.model,
          base_url: activeFields?.baseUrl || undefined,
          temperature,
          max_tokens: maxTokens,
          system_prompt: systemPrompt || undefined,
          training_data: pairs.length > 0 ? pairs : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.reply) {
        setChatMessages((prev) => [...prev, { role: 'ai', text: data.reply }]);
      } else {
        setChatError(data.error ?? 'No response from AI.');
      }
    } catch {
      setChatError('Network error.');
    } finally {
      setChatLoading(false);
    }
  };

  /** Feedback loop: turn a good test reply directly into a saved training
   *  Q&A pair, one click, without a separate eval-harness UI. Persists
   *  immediately (not just in local state) so it isn't lost if the user
   *  navigates away before hitting the main Save button below. */
  async function saveAsTrainingExample(index: number) {
    const answerMsg = chatMessages[index];
    const questionMsg = chatMessages[index - 1];
    if (!answerMsg || answerMsg.role !== 'ai' || !questionMsg || questionMsg.role !== 'user') return;
    const updatedPairs = [
      ...trainingPairs.filter((p) => p.question.trim() && p.answer.trim()),
      { question: questionMsg.text, answer: answerMsg.text },
    ];
    setTrainingPairs(updatedPairs);
    setChatMessages((prev) => prev.map((m, i) => (i === index ? { ...m, saved: true } : m)));
    try {
      await fetch('/api/ai-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ training_data: updatedPairs }),
      });
    } catch {
      // Best-effort — the pair still shows in the Training tab and gets
      // saved for real next time the main Save button is used.
    }
  }

  const addPair = () => setTrainingPairs((prev) => [...prev, { question: '', answer: '' }]);
  const removePair = (i: number) => setTrainingPairs((prev) => prev.filter((_, idx) => idx !== i));
  const updatePair = (i: number, field: 'question' | 'answer', value: string) =>
    setTrainingPairs((prev) => prev.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)));

  const addDocument = () =>
    setDocuments((prev) => [...prev, { id: crypto.randomUUID(), title: '', content: '' }]);
  const removeDocument = (id: string) => setDocuments((prev) => prev.filter((d) => d.id !== id));
  const updateDocument = (id: string, field: 'title' | 'content', value: string) =>
    setDocuments((prev) => prev.map((d) => (d.id === id ? { ...d, [field]: value } : d)));

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
  const fallbackOptions = PROVIDER_META.filter((p) => p.id !== activeProvider && providerFields[p.id]?.hasKey);

  return (
    <div className="space-y-5">
      {/* ── Provider rail ── */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
        <div className="flex min-w-max items-center gap-1">
          {PROVIDER_META.map((p) => {
            const configured = providerFields[p.id]?.hasKey;
            const isActive = activeProvider === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => selectProvider(p.id)}
                className={[
                  'flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-colors',
                  isActive ? 'bg-[#EEF0FF] text-[#5B6CF9]' : 'text-slate-500 hover:bg-slate-50',
                ].join(' ')}
              >
                {p.label}
                {configured && (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="Configured" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="h-9 bg-slate-100 rounded-xl p-1">
          <TabsTrigger value="config" className="gap-1.5 text-[12.5px] rounded-lg data-active:bg-white data-active:text-[#5B6CF9] data-active:shadow-sm">
            <Bot className="h-3.5 w-3.5" />
            Configuration
          </TabsTrigger>
          <TabsTrigger value="training" className="gap-1.5 text-[12.5px] rounded-lg data-active:bg-white data-active:text-[#5B6CF9] data-active:shadow-sm">
            <BookOpen className="h-3.5 w-3.5" />
            AI Training
          </TabsTrigger>
          <TabsTrigger value="test" className="gap-1.5 text-[12.5px] rounded-lg data-active:bg-white data-active:text-[#5B6CF9] data-active:shadow-sm">
            <Send className="h-3.5 w-3.5" />
            Test AI
          </TabsTrigger>
        </TabsList>

        {/* ── Configuration tab ── */}
        <TabsContent value="config" className="mt-4 space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 space-y-5">
            {/* API key field */}
            <div className="space-y-1.5">
              <Label htmlFor="api-key" className="text-[13px] font-medium text-slate-700">
                {activeMeta.label} API Key
                {activeFields?.hasKey && !activeFields.apiKey && (
                  <span className="ml-2 text-[11px] text-emerald-600 font-normal">
                    (saved — enter a new key to replace)
                  </span>
                )}
              </Label>
              <div className="relative">
                <Input
                  id="api-key"
                  type={showKey ? 'text' : 'password'}
                  placeholder={activeFields?.hasKey ? '••••••••••••••••' : `Paste your ${activeMeta.label} API key…`}
                  value={activeFields?.apiKey ?? ''}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  className={[
                    'h-9 text-[13px] border-slate-200 pr-10 font-mono',
                    validationStatus === 'valid'
                      ? 'border-emerald-500 focus-visible:ring-emerald-500/30'
                      : validationStatus === 'invalid'
                        ? 'border-rose-400 focus-visible:ring-rose-400/30'
                        : '',
                  ].join(' ')}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {validationStatus === 'checking' && (
                <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Validating key…
                </p>
              )}
              {validationStatus === 'valid' && (
                <p className="flex items-center gap-1.5 text-[11px] text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {validationMsg}
                </p>
              )}
              {validationStatus === 'invalid' && (
                <p className="flex items-center gap-1.5 text-[11px] text-rose-600">
                  <XCircle className="h-3.5 w-3.5" />
                  {validationMsg}
                </p>
              )}
            </div>

            {/* Base URL — custom provider only */}
            {activeProvider === 'custom' && (
              <div className="space-y-1.5">
                <Label htmlFor="base-url" className="text-[13px] font-medium text-slate-700">API Base URL</Label>
                <Input
                  id="base-url"
                  placeholder="https://api.groq.com/openai/v1"
                  value={activeFields?.baseUrl ?? ''}
                  onChange={(e) => updateActiveField('baseUrl', e.target.value)}
                  className="h-9 text-[13px] border-slate-200 font-mono"
                />
                <p className="text-[11px] text-slate-400">
                  Any OpenAI-compatible chat completions endpoint — Groq, Mistral, OpenRouter, a self-hosted Ollama/vLLM server, etc.
                </p>
              </div>
            )}

            {/* Model */}
            <div className="space-y-1.5">
              <Label className="text-[13px] font-medium text-slate-700">Model</Label>
              {activeMeta.defaultModels.length > 0 ? (
                <Select value={activeFields?.model ?? ''} onValueChange={(v) => v && updateActiveField('model', v)}>
                  <SelectTrigger className="w-full h-9 text-[13px] border-slate-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {activeMeta.defaultModels.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  placeholder="e.g. llama-3.3-70b-versatile"
                  value={activeFields?.model ?? ''}
                  onChange={(e) => updateActiveField('model', e.target.value)}
                  className="h-9 text-[13px] border-slate-200 font-mono"
                />
              )}
            </div>

            {/* Temperature + Max tokens — shared across providers */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="temperature" className="text-[13px] font-medium text-slate-700">
                  Temperature
                  <span className="ml-2 text-[11px] text-slate-400 font-normal">
                    {temperature} (0 = precise, 1 = creative)
                  </span>
                </Label>
                <input
                  id="temperature"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  className="w-full accent-[#5B6CF9]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="max-tokens" className="text-[13px] font-medium text-slate-700">Max Response Tokens</Label>
                <Input
                  id="max-tokens"
                  type="number"
                  min={50}
                  max={2048}
                  step={50}
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value))}
                  className="h-9 text-[13px] border-slate-200"
                />
              </div>
            </div>
          </div>

          {/* Fallback provider */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 space-y-2">
            <Label className="text-[13px] font-medium text-slate-700">Fallback provider</Label>
            <p className="text-[11.5px] text-slate-500">
              Used automatically if {activeMeta.label} fails or is rate-limited — real reliability, not just more choices.
            </p>
            <Select value={fallbackProvider || 'none'} onValueChange={(v) => setFallbackProvider(!v || v === 'none' ? '' : v)}>
              <SelectTrigger className="w-full h-9 text-[13px] border-slate-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {fallbackOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fallbackOptions.length === 0 && (
              <p className="text-[11px] text-slate-400">Configure and save a second provider to enable a fallback.</p>
            )}
          </div>
        </TabsContent>

        {/* ── Training tab ── */}
        <TabsContent value="training" className="mt-4 space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 space-y-4">
            <div className="flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-3">
              <ShieldQuestion className="h-4 w-4 shrink-0 text-slate-400 mt-0.5" />
              <p className="text-[11.5px] text-slate-500 leading-relaxed">
                The AI only uses what&apos;s relevant to each question from what&apos;s below — no system can guarantee fully accurate answers, but this reduces guesswork.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="system-prompt" className="text-[13px] font-medium text-slate-700">System Prompt</Label>
              <Textarea
                id="system-prompt"
                placeholder="You are a helpful assistant for [Your Business]. Be friendly and concise. Always respond in the same language the user writes in."
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={4}
                className="resize-none text-[13px] border-slate-200"
              />
              <p className="text-[11px] text-slate-400">
                This tells the AI who it is and how to behave. Keep it short and clear.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13.5px] font-semibold text-slate-800">Knowledge Base (Q&amp;A)</p>
                <p className="text-[11.5px] text-slate-500 mt-0.5">
                  Add question-answer pairs so the AI knows your business facts.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={addPair} className="h-8 text-[12px] gap-1.5 border-slate-200">
                <Plus className="h-3.5 w-3.5" />
                Add pair
              </Button>
            </div>

            <div className="space-y-3">
              {trainingPairs.map((pair, i) => (
                <div key={i} className="rounded-xl border border-slate-100 bg-slate-50 p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-500">Pair {i + 1}</span>
                    {trainingPairs.length > 1 && (
                      <button type="button" onClick={() => removePair(i)} className="text-slate-400 hover:text-rose-500 transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <Input
                    placeholder="Question (e.g. What are your working hours?)"
                    value={pair.question}
                    onChange={(e) => updatePair(i, 'question', e.target.value)}
                    className="h-9 text-[13px] border-slate-200 bg-white"
                  />
                  <Textarea
                    placeholder="Answer (e.g. We are open Monday to Saturday, 9am to 6pm.)"
                    value={pair.answer}
                    onChange={(e) => updatePair(i, 'answer', e.target.value)}
                    rows={2}
                    className="resize-none text-[13px] border-slate-200 bg-white"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13.5px] font-semibold text-slate-800">Reference documents</p>
                <p className="text-[11.5px] text-slate-500 mt-0.5">
                  Longer material — policies, product details — the AI checks alongside the Q&amp;A above.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={addDocument} className="h-8 text-[12px] gap-1.5 border-slate-200">
                <Plus className="h-3.5 w-3.5" />
                Add document
              </Button>
            </div>
            <div className="space-y-3">
              {documents.map((doc) => (
                <div key={doc.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Document title (e.g. Refund Policy)"
                      value={doc.title}
                      onChange={(e) => updateDocument(doc.id, 'title', e.target.value)}
                      className="h-9 text-[13px] border-slate-200 bg-white flex-1"
                    />
                    <button type="button" onClick={() => removeDocument(doc.id)} className="text-slate-400 hover:text-rose-500 transition-colors shrink-0">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <Textarea
                    placeholder="Paste the document content…"
                    value={doc.content}
                    onChange={(e) => updateDocument(doc.id, 'content', e.target.value)}
                    rows={4}
                    className="resize-none text-[13px] border-slate-200 bg-white"
                  />
                </div>
              ))}
              {documents.length === 0 && (
                <p className="text-[11.5px] text-slate-400">No reference documents yet.</p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="fallback-answer" className="text-[13px] font-medium text-slate-700">Fallback answer</Label>
              <Input
                id="fallback-answer"
                placeholder="I don't have that information — let me connect you with someone who does."
                value={fallbackAnswer}
                onChange={(e) => setFallbackAnswer(e.target.value)}
                className="h-9 text-[13px] border-slate-200"
              />
              <p className="text-[11px] text-slate-400">
                What the AI says instead of guessing when nothing above answers the question. Prompt-level guidance — not a hard guarantee an AI will never say anything else.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[13px] font-medium text-slate-700">Escalate to a human when the customer asks about…</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. refunds, cancellations"
                  value={topicInput}
                  onChange={(e) => setTopicInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTopic(); } }}
                  className="h-9 text-[13px] border-slate-200"
                />
                <Button type="button" size="sm" variant="outline" onClick={addTopic} className="h-9 text-[12px] border-slate-200 shrink-0">
                  Add
                </Button>
              </div>
              {escalationTopics.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {escalationTopics.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 rounded-full bg-[#EEF0FF] px-2.5 py-1 text-[11.5px] font-medium text-[#5B6CF9]">
                      {t}
                      <button type="button" onClick={() => removeTopic(t)} className="hover:text-rose-500">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Semantic search status — read-only, reflects whether a
              Gemini key is on file (any Save with a knowledge base keeps
              embeddings in sync automatically, no separate button). */}
          <div className={`rounded-2xl border p-4 text-[12.5px] ${semanticSearchAvailable ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
            {semanticSearchAvailable
              ? 'Smarter search is active — the AI finds knowledge by meaning, not just matching words (e.g. "cost" now matches an entry that only says "pricing"). Kept in sync automatically every time you save.'
              : 'Add a Gemini API key above to unlock smarter, meaning-based knowledge search. Without one, matching still works but relies on shared words between the question and your knowledge base.'}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label className="text-[13px] font-medium text-slate-700">Hand off to a human when the AI isn&apos;t confident</Label>
                <p className="text-[11px] text-slate-400">
                  Instead of guessing, the AI sends a short message and assigns the conversation to your team — a real handoff, not just a prompt instruction it might ignore.
                </p>
              </div>
              <Switch checked={lowConfidenceHandoffEnabled} onCheckedChange={setLowConfidenceHandoffEnabled} />
            </div>

            <div className={lowConfidenceHandoffEnabled ? 'space-y-4' : 'space-y-4 pointer-events-none opacity-40'}>
              <div className="space-y-1.5">
                <Label htmlFor="confidence-threshold" className="text-[13px] font-medium text-slate-700">
                  Confidence threshold
                  <span className="ml-2 text-[11px] text-slate-400 font-normal">
                    {confidenceThreshold.toFixed(2)} (lower = hands off less often, higher = hands off more often)
                  </span>
                </Label>
                <input
                  id="confidence-threshold"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={confidenceThreshold}
                  onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
                  className="w-full accent-[#5B6CF9]"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[13px] font-medium text-slate-700">Assign to agent</Label>
                <Select value={lowConfidenceAssignTo || '__unassigned__'} onValueChange={(v) => setLowConfidenceAssignTo(!v || v === '__unassigned__' ? '' : v)}>
                  <SelectTrigger className="h-9 text-[13px] border-slate-200">
                    <SelectValue placeholder="Select an agent (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned__">Unassigned — just move to pending</SelectItem>
                    {agents.map((a) => (
                      <SelectItem key={a.user_id} value={a.user_id}>{a.full_name || a.user_id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="low-confidence-message" className="text-[13px] font-medium text-slate-700">Message sent before handoff</Label>
                <Input
                  id="low-confidence-message"
                  placeholder="Let me connect you with a team member who can help with that."
                  value={lowConfidenceMessage}
                  onChange={(e) => setLowConfidenceMessage(e.target.value)}
                  className="h-9 text-[13px] border-slate-200"
                />
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── Test AI tab ── */}
        <TabsContent value="test" className="mt-4">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm flex flex-col" style={{ height: 460 }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-[#5B6CF9]" />
                <span className="text-[13px] font-semibold text-slate-800">Test your AI</span>
                <span className="text-[11px] text-slate-400">
                  — {activeMeta.label}, current (unsaved) settings
                </span>
              </div>
              {chatMessages.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setChatMessages([]); setChatError(''); }}
                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700 transition-colors"
                >
                  <RotateCcw className="h-3 w-3" />
                  Clear
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {chatMessages.length === 0 && !chatLoading && (
                <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-slate-400">
                  <Bot className="h-8 w-8 opacity-30" />
                  <p className="text-[13px]">Send a message to test your AI configuration.</p>
                  {!activeFields?.hasKey && !activeFields?.apiKey && (
                    <p className="text-[11px] text-rose-500">
                      No API key saved for {activeMeta.label} yet. Enter one in Configuration first.
                    </p>
                  )}
                </div>
              )}

              {chatMessages.map((m, i) => (
                <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div
                    className={[
                      'max-w-[80%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap',
                      m.role === 'user'
                        ? 'bg-[#5B6CF9] text-white rounded-br-sm'
                        : 'bg-slate-100 text-slate-800 rounded-bl-sm',
                    ].join(' ')}
                  >
                    {m.text}
                  </div>
                  {m.role === 'ai' && (
                    m.saved ? (
                      <span className="mt-1 flex items-center gap-1 text-[10.5px] text-emerald-600">
                        <CheckCircle2 className="h-3 w-3" /> Saved as training example
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => saveAsTrainingExample(i)}
                        className="mt-1 text-[10.5px] text-slate-400 hover:text-[#5B6CF9] transition-colors"
                      >
                        Save as training example
                      </button>
                    )
                  )}
                </div>
              ))}

              {chatLoading && (
                <div className="flex justify-start">
                  <div className="bg-slate-100 rounded-2xl rounded-bl-sm px-3.5 py-2.5 flex gap-1 items-center">
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              )}

              {chatError && (
                <div className="flex justify-start">
                  <div className="bg-rose-50 border border-rose-200 text-rose-600 rounded-xl px-3.5 py-2 text-[11px] flex items-center gap-1.5">
                    <XCircle className="h-3.5 w-3.5 shrink-0" />
                    {chatError}
                  </div>
                </div>
              )}

              <div ref={chatBottomRef} />
            </div>

            <div className="px-4 py-3 border-t border-slate-100 shrink-0">
              <div className="flex gap-2">
                <Input
                  placeholder="Type a message to test…"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendChat();
                    }
                  }}
                  className="h-9 text-[13px] border-slate-200"
                  disabled={chatLoading}
                />
                <Button
                  size="sm"
                  onClick={sendChat}
                  disabled={!chatInput.trim() || chatLoading}
                  className="h-9 shrink-0 gap-1.5 text-[12.5px] bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white"
                >
                  {chatLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Send
                </Button>
              </div>
            </div>
          </div>
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
        <Button onClick={save} disabled={saving} className="h-9 px-5 text-[13px] gap-2 bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save AI Settings
        </Button>
      </div>
    </div>
  );
}
