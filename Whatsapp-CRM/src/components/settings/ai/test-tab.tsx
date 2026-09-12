'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Send, Loader2, Sparkles, RotateCcw, AlertTriangle, Database, Users, MessageSquare,
  BookOpen, BarChart3, Server, ShieldCheck, Mic, MicOff, Bot, UserRound, CheckCircle2, ChevronRight,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AiButton, AiCard, AiCardHeader, AiInput, AiHint, AiNotice, AiSegmented, AiBadge } from './ui-kit';
import { WhatsAppText } from '@/components/inbox/message-bubble';
import { MarkdownAnswer } from './markdown-answer';

/**
 * Screen 5 — two genuinely different tests behind one screen:
 *
 *  - Customer Test replays the real customer path: the same knowledge
 *    retrieval, the same prompt assembly, the same WhatsApp formatting a
 *    customer would receive.
 *  - Admin Test asks questions of the account's own CRM data through the
 *    read-only tool layer (lib/ai/insights/tools.ts) and renders the
 *    result as a table.
 *
 * They're kept visibly distinct because confusing them would be
 * misleading in both directions: an admin answer is not what a customer
 * would get, and a customer answer can't see any of this data.
 */

export interface TestMessage {
  role: 'user' | 'ai';
  text: string;
  mode: 'customer' | 'admin';
  saved?: boolean;
  truncated?: boolean;
  toolsUsed?: string[];
  confidence?: number | null;
}

export interface TestTabProps {
  /** Passed through to the customer-mode test so it previews the exact
   *  settings currently on screen, saved or not. */
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  safetyFilter: string;
  replyLanguage: string;
  unsavedApiKey: string;
  semanticSearchAvailable: boolean;
}

const DATA_ACCESS = [
  { label: 'Contacts', Icon: Users },
  { label: 'Enquiries', Icon: BarChart3 },
  { label: 'Conversations', Icon: MessageSquare },
  { label: 'Knowledge Base', Icon: BookOpen },
  { label: 'Data Store tables', Icon: Database },
  { label: 'Team workload', Icon: Server },
];

const ADMIN_EXAMPLES = [
  'Show enquiry summary for this month',
  'Which are the top enquiry sources?',
  'How many conversations are unassigned?',
  'What data tables do we have?',
  'What do we tell customers about fees?',
];

const CUSTOMER_EXAMPLES = [
  'What are your working hours?',
  'How do I apply for admission?',
  'എന്താണ് ഫീസ്?',
  'Do you have hostel facilities?',
];

const VOICE_LANGS = [
  { id: 'en-IN', label: 'English (India)' },
  { id: 'ml-IN', label: 'Malayalam' },
  { id: 'hi-IN', label: 'Hindi' },
  { id: 'ta-IN', label: 'Tamil' },
];

/** Minimal shape of the Web Speech API this component uses — it isn't in
 *  TypeScript's DOM lib, and the alternative to declaring it is casting
 *  window to `any` at three call sites. */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

export function TestTab(props: TestTabProps) {
  const [mode, setMode] = useState<'admin' | 'customer'>('customer');
  const [messages, setMessages] = useState<TestMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [voiceLang, setVoiceLang] = useState('en-IN');
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    setVoiceSupported(!!(w.SpeechRecognition ?? w.webkitSpeechRecognition));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const toggleVoice = useCallback(() => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = voiceLang;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      // Appended, not replaced — dictating a second phrase should extend
      // what's there rather than wipe what was already typed.
      if (transcript) setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, [listening, voiceLang]);

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput('');
    setError('');
    const sentMode = mode;
    setMessages((prev) => [...prev, { role: 'user', text: msg, mode: sentMode }]);
    setLoading(true);

    try {
      if (sentMode === 'admin') {
        // Only the recent turns of this same mode are sent as history —
        // mixing a customer-mode exchange into an analytics conversation
        // would just confuse the model about what it's being asked.
        const history = messages
          .filter((m) => m.mode === 'admin')
          .slice(-6)
          .map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('model' as const), text: m.text }));
        const res = await fetch('/api/ai-config/admin-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg, history }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'No answer came back.');
        setMessages((prev) => [
          ...prev,
          { role: 'ai', text: data.reply, mode: 'admin', truncated: !!data.truncated, toolsUsed: data.tools_used ?? [] },
        ]);
      } else {
        const res = await fetch('/api/ai-config/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: msg,
            provider: 'gemini',
            api_key: props.unsavedApiKey || undefined,
            model: props.model,
            temperature: props.temperature,
            max_tokens: props.maxTokens,
            system_prompt: props.systemPrompt || undefined,
            safety_filter: props.safetyFilter,
            reply_language: props.replyLanguage || null,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.reply) throw new Error(data.error ?? 'No response from AI.');
        setMessages((prev) => [
          ...prev,
          {
            role: 'ai',
            text: data.reply,
            mode: 'customer',
            truncated: !!data.truncated,
            confidence: data.retrieval_confidence ?? null,
          },
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  async function saveAsExample(index: number) {
    const answer = messages[index];
    const question = messages[index - 1];
    if (!answer || answer.role !== 'ai' || !question || question.role !== 'user') return;
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, saved: true } : m)));
    await fetch('/api/ai-knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'qa', question: question.text, answer: answer.text }),
    }).catch(() => {});
  }

  const examples = mode === 'admin' ? ADMIN_EXAMPLES : CUSTOMER_EXAMPLES;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      {/* ── Chat ── */}
      <AiCard className="flex min-w-0 flex-col" style={{ height: 560 }}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
          <div>
            <h3 className="text-[16px] font-bold tracking-tight text-slate-900">Test AI</h3>
            <p className="mt-0.5 text-[12.5px] text-slate-500">
              {mode === 'admin'
                ? 'Ask about your own CRM data — answers are computed from the database.'
                : 'Exactly what a customer would get, including knowledge base grounding.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <AiSegmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'admin', label: 'Admin Test', icon: <Database className="h-3.5 w-3.5" /> },
                { value: 'customer', label: 'Customer Test', icon: <UserRound className="h-3.5 w-3.5" /> },
              ]}
            />
            {messages.length > 0 && (
              <AiButton
                tone="ghost" size="icon"
                onClick={() => { setMessages([]); setError(''); }}
                title="Clear conversation"
                aria-label="Clear conversation"
              >
                <RotateCcw className="h-4 w-4" />
              </AiButton>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <Sparkles className="h-8 w-8 text-slate-200" />
              <p className="mt-3 text-[13px] font-medium text-slate-600">
                {mode === 'admin' ? 'Ask anything about your CRM data' : 'Send a message as a customer would'}
              </p>
              <p className="mt-1 max-w-xs text-[12px] leading-relaxed text-slate-400">
                {mode === 'admin'
                  ? 'Try one of the example queries on the right.'
                  : 'The reply uses your knowledge base and current settings.'}
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[88%] ${m.role === 'user' ? '' : 'w-full'}`}>
                <div
                  className={[
                    'rounded-2xl px-3.5 py-2.5',
                    m.role === 'user'
                      ? 'bg-gradient-to-b from-[#6B7BFF] to-[#5B6CF9] text-[13px] text-white shadow-[0_4px_12px_-6px_rgba(91,108,249,0.8)]'
                      : 'bg-white ring-1 ring-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)]',
                  ].join(' ')}
                >
                  {m.role === 'user' ? (
                    m.text
                  ) : m.mode === 'admin' ? (
                    <MarkdownAnswer text={m.text} />
                  ) : (
                    <div className="text-[13px] leading-relaxed text-slate-700">
                      <WhatsAppText text={m.text} />
                    </div>
                  )}
                </div>

                {m.role === 'ai' && m.truncated && (
                  <p className="mt-1 flex items-start gap-1.5 text-[11px] text-amber-600">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    Cut off — hit Max Response Tokens ({props.maxTokens}). Raise it in Reconfigure for the full reply.
                  </p>
                )}

                {m.role === 'ai' && m.mode === 'admin' && m.toolsUsed && m.toolsUsed.length > 0 && (
                  <p className="mt-1 flex flex-wrap items-center gap-1 text-[10.5px] text-slate-400">
                    <ShieldCheck className="h-3 w-3" />
                    Read from: {m.toolsUsed.join(', ')}
                  </p>
                )}

                {m.role === 'ai' && m.mode === 'customer' && typeof m.confidence === 'number' && (
                  <p className="mt-1 text-[10.5px] text-slate-400">
                    Knowledge match {(m.confidence * 100).toFixed(0)}%
                    {m.confidence === 0 && ' — nothing relevant found, this answer is unsourced'}
                  </p>
                )}

                {m.role === 'ai' && !m.truncated && (
                  m.saved ? (
                    <p className="mt-1 flex items-center gap-1 text-[10.5px] text-emerald-600">
                      <CheckCircle2 className="h-3 w-3" />
                      Saved to knowledge base
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => saveAsExample(i)}
                      className="mt-1 text-[10.5px] text-slate-400 transition-colors hover:text-[#5B6CF9]"
                    >
                      Save as training example
                    </button>
                  )
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-2 text-[12.5px] text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin text-[#5B6CF9]" />
              {mode === 'admin' ? 'Reading your data…' : 'Thinking…'}
            </div>
          )}
          {error && <AiNotice tone="error">{error}</AiNotice>}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-slate-100 p-4">
          <div className="flex items-center gap-2">
            <AiInput
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={mode === 'admin' ? "Ask anything… (e.g. Show today's enquiries)" : 'Type a customer message…'}
            />
            {voiceSupported && (
              <AiButton
                tone={listening ? 'danger' : 'outline'}
                size="icon"
                onClick={toggleVoice}
                title={listening ? 'Stop listening' : 'Ask by voice'}
                aria-label={listening ? 'Stop listening' : 'Ask by voice'}
                className={`h-10 w-10 ${listening ? 'motion-safe:animate-pulse' : ''}`}
              >
                {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </AiButton>
            )}
            <AiButton
              onClick={() => send()}
              disabled={loading || !input.trim()}
              size="icon"
              className="h-10 w-10"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </AiButton>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {examples.slice(0, 3).map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => send(ex)}
                disabled={loading}
                className="rounded-lg bg-white px-2.5 py-1 text-[11.5px] text-slate-600 ring-1 ring-slate-200/80 transition-all duration-150 hover:text-[#5B6CF9] hover:ring-[#5B6CF9]/35 disabled:opacity-50 motion-safe:active:translate-y-px"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      </AiCard>

      {/* ── Rail ── */}
      <div className="space-y-5">
        <AiCard className="p-5">
          <AiCardHeader title="Test Mode" subtitle="Choose how the AI should respond." />

          <div className="mt-3 space-y-2">
            {([
              { id: 'admin' as const, label: 'Admin Test', blurb: 'Access your data and get insights across the system.', Icon: Database },
              { id: 'customer' as const, label: 'Customer Test', blurb: 'Answers as the chatbot would to a real customer.', Icon: UserRound },
            ]).map(({ id, label, blurb, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                className={[
                  'flex w-full items-start gap-2.5 rounded-2xl p-3 text-left ring-1 transition-all duration-150',
                  mode === id
                    ? 'bg-[#5B6CF9]/[0.05] ring-[#5B6CF9]/30 shadow-[0_4px_14px_-10px_rgba(91,108,249,0.8)]'
                    : 'bg-white ring-slate-200/70 hover:bg-slate-50 hover:ring-slate-300',
                ].join(' ')}
              >
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${mode === id ? 'text-[#5B6CF9]' : 'text-slate-400'}`} />
                <span>
                  <span className={`block text-[13px] font-semibold ${mode === id ? 'text-[#5B6CF9]' : 'text-slate-700'}`}>
                    {label}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-relaxed text-slate-500">{blurb}</span>
                </span>
              </button>
            ))}
          </div>

          {mode === 'admin' ? (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12.5px] font-semibold text-slate-700">Data Access</p>
                <AiBadge tone="emerald">
                  <CheckCircle2 className="h-3 w-3" />
                  Read-only
                </AiBadge>
              </div>
              <ul className="mt-2.5 space-y-1.5">
                {DATA_ACCESS.map(({ label, Icon }) => (
                  <li key={label} className="flex items-center gap-2 text-[12.5px] text-slate-600">
                    <Icon className="h-3.5 w-3.5 text-slate-400" />
                    {label}
                  </li>
                ))}
              </ul>
              <AiHint className="mt-3">
                Answers are computed by fixed, read-only queries scoped to this account — the AI can&apos;t write
                queries, change data, or see another account.
              </AiHint>
            </div>
          ) : (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="text-[12.5px] font-semibold text-slate-700">Grounding</p>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-slate-500">
                {props.semanticSearchAvailable
                  ? 'Uses the same semantic knowledge retrieval as live replies, so this preview matches production.'
                  : 'Uses keyword matching over your knowledge base — save a Gemini key and train to enable semantic search.'}
              </p>
            </div>
          )}
        </AiCard>

        {voiceSupported && (
          <AiCard className="p-5">
            <div className="flex items-center gap-2">
              <Mic className="h-4 w-4 text-slate-400" />
              <p className="text-[14px] font-semibold text-slate-900">Voice Input</p>
            </div>
            <p className="mt-0.5 text-[12px] text-slate-500">Ask questions using your voice.</p>
            <Select value={voiceLang} onValueChange={(v) => v && setVoiceLang(v)}>
              <SelectTrigger className="mt-3 h-9 w-full rounded-xl border-slate-200 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VOICE_LANGS.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <AiHint className="mt-2">
              Uses your browser&apos;s own speech recognition — accuracy varies by browser and language.
            </AiHint>
          </AiCard>
        )}

        <AiCard className="p-5">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-slate-400" />
            <p className="text-[14px] font-semibold text-slate-900">Example Queries</p>
          </div>
          <div className="mt-3 space-y-1">
            {examples.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => send(ex)}
                disabled={loading}
                className="group flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-slate-600 transition-colors hover:bg-slate-50 hover:text-[#5B6CF9] disabled:opacity-50"
              >
                {ex}
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 transition-all duration-200 group-hover:text-[#5B6CF9] motion-safe:group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </AiCard>
      </div>
    </div>
  );
}
