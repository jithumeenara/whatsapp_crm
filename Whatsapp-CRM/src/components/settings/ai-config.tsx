'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Trash2, Bot, BookOpen, Save, Eye, EyeOff, Loader2,
  CheckCircle2, XCircle, Send, RotateCcw,
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

interface TrainingPair {
  question: string;
  answer: string;
}

interface AiConfigData {
  id?: string;
  provider?: string;
  api_key_set?: boolean;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  system_prompt?: string;
  training_data?: TrainingPair[] | null;
}

type ValidationStatus = 'idle' | 'checking' | 'valid' | 'invalid';

interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
}

const GEMINI_MODELS = [
  { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (Fast, free tier)' },
  { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro (Powerful)' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Recommended)' },
  { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite (Fastest)' },
  { value: 'gemini-2.5-flash-preview-05-20', label: 'Gemini 2.5 Flash Preview (Latest)' },
];

export function AiConfig() {
  const [tab, setTab] = useState<'config' | 'training' | 'test'>('config');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveOk, setSaveOk] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gemini-2.0-flash');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(500);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [trainingPairs, setTrainingPairs] = useState<TrainingPair[]>([
    { question: '', answer: '' },
  ]);
  const [apiKeySet, setApiKeySet] = useState(false);

  // API key validation
  const [validationStatus, setValidationStatus] = useState<ValidationStatus>('idle');
  const [validationMsg, setValidationMsg] = useState('');
  const validateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Test AI chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState('');
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai-config');
      const data: AiConfigData | null = await res.json();
      if (data) {
        setApiKeySet(!!data.api_key_set);
        setModel(data.model ?? 'gemini-1.5-flash');
        setTemperature(data.temperature ?? 0.7);
        setMaxTokens(data.max_tokens ?? 500);
        setSystemPrompt(data.system_prompt ?? '');
        const pairs =
          Array.isArray(data.training_data) && data.training_data.length > 0
            ? data.training_data
            : [{ question: '', answer: '' }];
        setTrainingPairs(pairs);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Scroll chat to bottom on new messages
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  // Validate API key after user stops typing (debounced)
  const validateKey = useCallback(async (key: string) => {
    if (!key.trim()) {
      setValidationStatus('idle');
      setValidationMsg('');
      return;
    }
    if (key.trim().length < 20) {
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
          api_key: key.trim(),
          model: 'gemini-2.0-flash', // always use a stable model for key validation
          message: 'Say "OK" in one word.',
        }),
      });
      const data = await res.json();
      if (res.ok && data.reply) {
        setValidationStatus('valid');
        setValidationMsg('API key is valid and working.');
      } else {
        setValidationStatus('invalid');
        setValidationMsg(data.error ?? 'Key validation failed.');
      }
    } catch {
      setValidationStatus('invalid');
      setValidationMsg('Network error during validation.');
    }
  }, [model]);

  const handleApiKeyChange = (val: string) => {
    setApiKey(val);
    setValidationStatus('idle');
    setValidationMsg('');
    if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
    if (val.trim()) {
      validateTimerRef.current = setTimeout(() => validateKey(val), 800);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaveError('');
    setSaveOk(false);
    try {
      const pairs = trainingPairs.filter((p) => p.question.trim() && p.answer.trim());
      const res = await fetch('/api/ai-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey || undefined,
          model,
          temperature,
          max_tokens: maxTokens,
          system_prompt: systemPrompt || null,
          training_data: pairs.length > 0 ? pairs : null,
        }),
      });
      if (res.ok) {
        setApiKey('');
        setApiKeySet(true);
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
          api_key: apiKey || undefined,
          model,
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

  const addPair = () =>
    setTrainingPairs((prev) => [...prev, { question: '', answer: '' }]);

  const removePair = (i: number) =>
    setTrainingPairs((prev) => prev.filter((_, idx) => idx !== i));

  const updatePair = (i: number, field: 'question' | 'answer', value: string) =>
    setTrainingPairs((prev) =>
      prev.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)),
    );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">AI Configuration</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configure Google Gemini for AI-powered chatbot replies.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="h-9">
          <TabsTrigger value="config" className="gap-1.5 text-xs">
            <Bot className="size-3.5" />
            Configuration
          </TabsTrigger>
          <TabsTrigger value="training" className="gap-1.5 text-xs">
            <BookOpen className="size-3.5" />
            AI Training
          </TabsTrigger>
          <TabsTrigger value="test" className="gap-1.5 text-xs">
            <Send className="size-3.5" />
            Test AI
          </TabsTrigger>
        </TabsList>

        {/* ── Configuration tab ── */}
        <TabsContent value="config" className="mt-4 space-y-5">
          <div className="rounded-xl border border-border bg-card p-5 space-y-5">

            {/* API key field */}
            <div className="space-y-1.5">
              <Label htmlFor="api-key">
                Google Gemini API Key
                {apiKeySet && !apiKey && (
                  <span className="ml-2 text-xs text-emerald-600 font-normal">
                    (saved — enter a new key to replace)
                  </span>
                )}
              </Label>
              <div className="relative">
                <Input
                  id="api-key"
                  type={showKey ? 'text' : 'password'}
                  placeholder={apiKeySet ? '••••••••••••••••' : 'Paste your Gemini API key…'}
                  value={apiKey}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  className={[
                    'pr-10 font-mono text-sm',
                    validationStatus === 'valid'
                      ? 'border-emerald-500 focus-visible:ring-emerald-500/30'
                      : validationStatus === 'invalid'
                        ? 'border-destructive focus-visible:ring-destructive/30'
                        : '',
                  ].join(' ')}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>

              {/* Validation feedback */}
              {validationStatus === 'checking' && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  Validating key…
                </p>
              )}
              {validationStatus === 'valid' && (
                <p className="flex items-center gap-1.5 text-xs text-emerald-600">
                  <CheckCircle2 className="size-3.5" />
                  {validationMsg}
                </p>
              )}
              {validationStatus === 'invalid' && (
                <p className="flex items-center gap-1.5 text-xs text-destructive">
                  <XCircle className="size-3.5" />
                  {validationMsg}
                </p>
              )}
              {validationStatus === 'idle' && (
                <p className="text-xs text-muted-foreground">
                  Get your API key from{' '}
                  <span className="font-mono text-primary">aistudio.google.com</span>
                </p>
              )}
            </div>

            {/* Model */}
            <div className="space-y-1.5">
              <Label>Model</Label>
              <Select value={model} onValueChange={(v) => v && setModel(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GEMINI_MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Temperature + Max tokens */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="temperature">
                  Temperature
                  <span className="ml-2 text-xs text-muted-foreground font-normal">
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
                  className="w-full accent-primary"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="max-tokens">Max Response Tokens</Label>
                <Input
                  id="max-tokens"
                  type="number"
                  min={50}
                  max={2048}
                  step={50}
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value))}
                />
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── Training tab ── */}
        <TabsContent value="training" className="mt-4 space-y-5">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="system-prompt">System Prompt</Label>
              <Textarea
                id="system-prompt"
                placeholder="You are a helpful assistant for [Your Business]. Be friendly and concise. Always respond in the same language the user writes in."
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={4}
                className="resize-none text-sm"
              />
              <p className="text-xs text-muted-foreground">
                This tells the AI who it is and how to behave. Keep it short and clear.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Knowledge Base (Q&amp;A)</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Add question-answer pairs so the AI knows your business facts.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={addPair} className="gap-1.5">
                <Plus className="size-3.5" />
                Add pair
              </Button>
            </div>

            <div className="space-y-3">
              {trainingPairs.map((pair, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-border bg-muted/30 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      Pair {i + 1}
                    </span>
                    {trainingPairs.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removePair(i)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                  <Input
                    placeholder="Question (e.g. What are your working hours?)"
                    value={pair.question}
                    onChange={(e) => updatePair(i, 'question', e.target.value)}
                    className="text-sm"
                  />
                  <Textarea
                    placeholder="Answer (e.g. We are open Monday to Saturday, 9am to 6pm.)"
                    value={pair.answer}
                    onChange={(e) => updatePair(i, 'answer', e.target.value)}
                    rows={2}
                    className="resize-none text-sm"
                  />
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* ── Test AI tab ── */}
        <TabsContent value="test" className="mt-4">
          <div className="rounded-xl border border-border bg-card flex flex-col" style={{ height: 460 }}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <Bot className="size-4 text-primary" />
                <span className="text-sm font-medium">Test your AI</span>
                <span className="text-xs text-muted-foreground">
                  — uses current (unsaved) settings
                </span>
              </div>
              {chatMessages.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setChatMessages([]); setChatError(''); }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RotateCcw className="size-3" />
                  Clear
                </button>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {chatMessages.length === 0 && !chatLoading && (
                <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-muted-foreground">
                  <Bot className="size-8 opacity-30" />
                  <p className="text-sm">Send a message to test your AI configuration.</p>
                  {!apiKeySet && !apiKey && (
                    <p className="text-xs text-destructive">
                      No API key saved yet. Enter one in Configuration first.
                    </p>
                  )}
                </div>
              )}

              {chatMessages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={[
                      'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap',
                      m.role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-br-sm'
                        : 'bg-muted text-foreground rounded-bl-sm',
                    ].join(' ')}
                  >
                    {m.text}
                  </div>
                </div>
              ))}

              {chatLoading && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-2xl rounded-bl-sm px-3.5 py-2.5 flex gap-1 items-center">
                    <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
                    <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
                    <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              )}

              {chatError && (
                <div className="flex justify-start">
                  <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-xl px-3.5 py-2 text-xs flex items-center gap-1.5">
                    <XCircle className="size-3.5 shrink-0" />
                    {chatError}
                  </div>
                </div>
              )}

              <div ref={chatBottomRef} />
            </div>

            {/* Input */}
            <div className="px-4 py-3 border-t border-border shrink-0">
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
                  className="text-sm"
                  disabled={chatLoading}
                />
                <Button
                  size="sm"
                  onClick={sendChat}
                  disabled={!chatInput.trim() || chatLoading}
                  className="shrink-0 gap-1.5"
                >
                  {chatLoading ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Send className="size-3.5" />
                  )}
                  Send
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Save bar */}
      <div className="flex items-center justify-between">
        <div className="text-sm">
          {saveError && (
            <span className="flex items-center gap-1.5 text-destructive">
              <XCircle className="size-4" />
              {saveError}
            </span>
          )}
          {saveOk && (
            <span className="flex items-center gap-1.5 text-emerald-600">
              <CheckCircle2 className="size-4" />
              Settings saved.
            </span>
          )}
        </div>
        <Button onClick={save} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save AI Settings
        </Button>
      </div>
    </div>
  );
}
