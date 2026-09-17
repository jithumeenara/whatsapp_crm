'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Send, Loader2, RotateCcw, AlertTriangle, Database, BookOpen, Bot, UserRound,
  CheckCircle2, ChevronRight, Volume2, VolumeX, Mic, Trash2, ThumbsUp, ThumbsDown,
  Copy, Check, Cpu, Clock, MessageSquare, Lightbulb, ShieldCheck, Zap,
  Users, ChevronDown,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AiCard, AiNotice, AiModal, AiModalHeader, AiModalBody } from './ui-kit';
import { WhatsAppText } from '@/components/inbox/message-bubble';
import { MarkdownAnswer } from './markdown-answer';
import { ContactSyncPanel } from './contact-sync-panel';
import { LiveVoicePanel } from './live-voice-panel';
import type { VoiceTurn } from './use-live-voice';

/**
 * Screen 5 — two genuinely different tests behind one screen.
 *
 *  - Customer Test replays the real customer path: the same retrieval,
 *    the same prompt assembly, the same WhatsApp formatting a customer
 *    would receive.
 *  - Admin Test asks questions of the account's own CRM data through the
 *    read-only tool layer and renders the result as a table.
 *
 * They stay visibly distinct because confusing them misleads in both
 * directions: an admin answer is not what a customer would get, and a
 * customer answer cannot see any of that data.
 *
 * Laid out as a conversation with a working column beside it, because
 * that is how it is used — you are reading a chat and glancing right to
 * check whether the answer was grounded, how long it took, and what it
 * drew on. The previous version stacked those as full-width panels
 * below the chat, where they were out of sight exactly when they
 * mattered.
 */

export interface TestMessage {
  role: 'user' | 'ai';
  text: string;
  mode: 'customer' | 'admin';
  saved?: boolean;
  truncated?: boolean;
  toolsUsed?: string[];
  confidence?: number | null;
  /** Knowledge entries the answer was built from. */
  sources?: string[];
  /** Round trip, so the summary can report a real average. */
  latencyMs?: number;
  at: number;
  feedback?: 'up' | 'down';
  /** Came from a spoken conversation rather than being typed. Marked so
   *  a reply that was heard is not mistaken for one that was read. */
  spoken?: boolean;
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
  /** Raises the token ceiling and saves, straight from the truncation
   *  warning — the alternative is sending someone to another screen to
   *  change one number. */
  onRaiseMaxTokens?: (value: number) => void;
  liveVoiceEnabled?: boolean;
}

const ADMIN_EXAMPLES = [
  'Show enquiry summary for this month',
  'Which are the top enquiry sources?',
  'How many conversations are unassigned?',
  'What data tables do we have?',
  'How many contacts do we have in total?',
  'Which agent has the most open conversations?',
];

const CUSTOMER_EXAMPLES = [
  'What are your working hours?',
  'How do I apply for admission?',
  'Do you have hostel facilities?',
  'What is the course fee?',
  'Where are you located?',
  'എന്താണ് ഫീസ്?',
];

/**
 * Auto is the default, and the honest one.
 *
 * A live conversation needs no hint at all — the model detects the
 * language per utterance, the same way text replies have since the
 * setting was removed from setup. The only two things here that
 * genuinely cannot work without a hint are the browser's own dictation
 * and its read-aloud; for those Auto reads the script of the text rather
 * than asking somebody to choose in advance.
 */
const VOICE_LANGUAGES = [
  { id: 'auto', label: 'Auto-detect (recommended)' },
  { id: 'en-IN', label: 'English (India)' },
  { id: 'ml-IN', label: 'മലയാളം — Malayalam' },
  { id: 'ta-IN', label: 'தமிழ் — Tamil' },
  { id: 'hi-IN', label: 'हिन्दी — Hindi' },
  { id: 'en-US', label: 'English (US)' },
];

/** Script ranges, mirroring the server's own voice picker. Good enough to
 *  choose a voice: a wrong guess sounds accented, it does not say the
 *  wrong words. */
const SPEECH_SCRIPTS: [RegExp, string][] = [
  [/[ഀ-ൿ]/, 'ml-IN'],
  [/[஀-௿]/, 'ta-IN'],
  [/[ऀ-ॿ]/, 'hi-IN'],
  [/[ఀ-౿]/, 'te-IN'],
  [/[ಀ-೿]/, 'kn-IN'],
];

function resolveSpeechLang(setting: string, text: string): string {
  if (setting !== 'auto') return setting;
  const hit = SPEECH_SCRIPTS.find(([re]) => re.test(text));
  // en-IN rather than the browser locale: the customer base is Indian,
  // and romanized Malayalam read by an Indian-English voice lands far
  // closer than an American one.
  return hit ? hit[1] : 'en-IN';
}

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

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export function TestTab(props: TestTabProps) {
  const [mode, setMode] = useState<'admin' | 'customer'>('customer');
  const [chatStyle, setChatStyle] = useState<'whatsapp' | 'plain'>('whatsapp');
  const [messages, setMessages] = useState<TestMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [voiceLang, setVoiceLang] = useState('auto');
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [openSources, setOpenSources] = useState<number | null>(null);
  const [knowledgeCount, setKnowledgeCount] = useState<number | null>(null);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [lastTrained, setLastTrained] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    setVoiceSupported(!!(w.SpeechRecognition ?? w.webkitSpeechRecognition));
    // Speaking a reply and dictating one are separate browser APIs with
    // separate support — Safari has had speechSynthesis for years while
    // lacking usable recognition, so they are checked independently.
    setSpeechSupported(typeof window !== 'undefined' && 'speechSynthesis' in window);
  }, []);

  // Real numbers for the status card rather than decorative ones: an
  // empty knowledge base is the single most useful thing this screen can
  // tell someone, and inventing a figure here would hide it.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/ai-knowledge?limit=200');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const items: { updated_at?: string; status?: string }[] = data.items ?? [];
        setKnowledgeCount(items.length);
        const newest = items
          .map((i) => (i.updated_at ? new Date(i.updated_at).getTime() : 0))
          .reduce((a, b) => Math.max(a, b), 0);
        setLastTrained(newest ? new Date(newest).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : null);
      } catch {
        /* the status card degrades to "—" rather than breaking the screen */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Anything still queued when the component unmounts would keep talking
  // over the rest of the app.
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  useEffect(() => {
    // Deliberately NOT scrollIntoView: that walks up and scrolls every
    // scrollable ancestor, so sending a message yanked the whole
    // Settings page down. Scrolling the container directly moves only
    // the message list.
    const el = messagesRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const toggleVoice = useCallback(() => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const recognition = new Ctor();
    // Dictation is the one place a hint is unavoidable: there is no text
    // to read a script from yet. Auto falls back to the browser's own
    // locale, which is what it would have used regardless.
    recognition.lang = voiceLang === 'auto' ? navigator.language || 'en-IN' : voiceLang;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      // Appended, not replaced — dictating a second phrase should extend
      // what is there rather than wipe what was already typed.
      if (transcript) setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, [listening, voiceLang]);

  /** Reads a reply out loud, so a Malayalam or Hindi answer can be
   *  checked for how it actually sounds — the thing a text preview
   *  cannot tell you. */
  const speak = useCallback(
    (index: number, text: string) => {
      if (!('speechSynthesis' in window)) return;
      if (speakingIndex === index) {
        window.speechSynthesis.cancel();
        setSpeakingIndex(null);
        return;
      }
      window.speechSynthesis.cancel();
      // WhatsApp's own markers would otherwise be read out as
      // punctuation ("star bold star"), which is exactly the opposite of
      // what listening to a reply is for.
      const spoken = text.replace(/[*_~]/g, '').replace(/```[\s\S]*?```/g, '').trim();
      const utterance = new SpeechSynthesisUtterance(spoken);
      // Read from the reply's own script, so a Malayalam answer is spoken
      // by a Malayalam voice without anyone having chosen one.
      utterance.lang = resolveSpeechLang(voiceLang, spoken);
      utterance.onend = () => setSpeakingIndex(null);
      utterance.onerror = () => setSpeakingIndex(null);
      setSpeakingIndex(index);
      window.speechSynthesis.speak(utterance);
    },
    [speakingIndex, voiceLang],
  );

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput('');
    setError('');
    const sentMode = mode;
    const startedAt = Date.now();
    setMessages((prev) => [...prev, { role: 'user', text: msg, mode: sentMode, at: Date.now() }]);
    setLoading(true);

    try {
      if (sentMode === 'admin') {
        // Only the recent turns of this same mode are sent as history —
        // mixing a customer exchange into an analytics conversation would
        // confuse the model about what it is being asked.
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
          {
            role: 'ai', text: data.reply, mode: 'admin', truncated: !!data.truncated,
            toolsUsed: data.tools_used ?? [], latencyMs: Date.now() - startedAt, at: Date.now(),
          },
        ]);
      } else {
        // The same recent turns the Admin test already sent. Without
        // these every message started from nothing, so answering "yes"
        // to the assistant's own question got a fresh greeting back —
        // which read as the assistant being stupid rather than as this
        // screen forgetting to tell it what had just been said.
        const history = messages
          .filter((m) => m.mode === 'customer')
          .slice(-8)
          .map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('model' as const), text: m.text }));
        const res = await fetch('/api/ai-config/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: msg,
            history,
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
        let spokenIndex = -1;
        setMessages((prev) => {
          spokenIndex = prev.length;
          return [
            ...prev,
            {
              role: 'ai', text: data.reply, mode: 'customer', truncated: !!data.truncated,
              confidence: data.retrieval_confidence ?? null, sources: data.sources ?? [],
              latencyMs: Date.now() - startedAt, at: Date.now(),
            },
          ];
        });
        // Outside the updater on purpose: React is free to call an
        // updater more than once, which would start the utterance twice.
        if (autoSpeak && speechSupported && spokenIndex >= 0) speak(spokenIndex, data.reply);
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
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, saved: true, feedback: 'up' } : m)));
    await fetch('/api/ai-knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'qa', question: question.text, answer: answer.text }),
    }).catch(() => {});
  }

  /** Folds a spoken conversation into the chat.
   *
   *  Without this the transcript disappears with the sheet, and a voice
   *  test leaves no trace of what was asked or answered — which makes it
   *  useless for the thing tests are for. Marked as spoken so a reply
   *  that was heard is not mistaken for one that was typed. */
  const keepVoiceTranscript = useCallback((turns: VoiceTurn[]) => {
    if (turns.length === 0) return;
    const now = Date.now();
    setMessages((prev) => [
      ...prev,
      ...turns.map((t, i) => ({
        role: t.who === 'you' ? ('user' as const) : ('ai' as const),
        text: t.text,
        mode,
        spoken: true,
        at: now + i,
      })),
    ]);
  }, [mode]);

  const copyReply = useCallback((index: number, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex((c) => (c === index ? null : c)), 1600);
    });
  }, []);

  const examples = mode === 'admin' ? ADMIN_EXAMPLES : CUSTOMER_EXAMPLES;
  const visible = messages.filter((m) => m.mode === mode);

  /** Session figures, computed from what actually happened rather than
   *  stored — nothing here needs to survive a reload. */
  const summary = useMemo(() => {
    const replies = visible.filter((m) => m.role === 'ai');
    const timed = replies.filter((m) => typeof m.latencyMs === 'number');
    const avgMs = timed.length
      ? timed.reduce((sum, m) => sum + (m.latencyMs ?? 0), 0) / timed.length
      : null;
    // "Grounded" means the answer was built on something retrievable, not
    // that it was correct — said that way in the label, because the
    // difference matters.
    const grounded = replies.filter((m) => (m.sources?.length ?? 0) > 0 || (m.toolsUsed?.length ?? 0) > 0).length;
    const issues = replies.filter((m) => m.truncated || (m.confidence !== null && m.confidence !== undefined && m.confidence < 0.35)).length;
    return {
      messages: visible.length,
      avg: avgMs === null ? '—' : `${(avgMs / 1000).toFixed(1)}s`,
      grounded: replies.length ? `${Math.round((grounded / replies.length) * 100)}%` : '—',
      issues,
    };
  }, [visible]);

  return (
    <div className="space-y-4">
      {/* ── Mode, chat style, contact sync ──────────────────────── */}
      <AiCard className="p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <ModeRadio value={mode} onChange={setMode} />

          <div className="ml-auto flex items-center gap-2">
            <Select value={chatStyle} onValueChange={(v) => v && setChatStyle(v as 'whatsapp' | 'plain')}>
              <SelectTrigger className="h-8 w-[148px] rounded-lg border-slate-200 text-[12.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="whatsapp">WhatsApp Style</SelectItem>
                <SelectItem value="plain">Plain text</SelectItem>
              </SelectContent>
            </Select>

            <button
              type="button"
              onClick={() => setContactsOpen(true)}
              aria-label="Contact save and sync"
              title="Contact save & sync"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#F5F6FA] text-slate-500 ring-1 ring-slate-200/80 transition-colors hover:bg-[#EEF0FF] hover:text-[#4A5AE8]"
            >
              <Users className="h-4 w-4" />
            </button>
          </div>
        </div>
      </AiCard>

      {/* ── Conversation + working column ───────────────────────── */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_308px]">
        {/* Chat */}
        <AiCard className="flex min-h-[560px] flex-col overflow-hidden">
          <div
            ref={messagesRef}
            className="flex-1 space-y-3 overflow-y-auto bg-[#FAFBFD] p-4 sm:p-5"
            style={{ maxHeight: '58vh' }}
          >
            <IntroBubble mode={mode} />

            {visible.map((m, i) => {
              const index = messages.indexOf(m);
              return m.role === 'user' ? (
                <UserBubble key={`${m.at}-${i}`} message={m} />
              ) : (
                <BotBubble
                  key={`${m.at}-${i}`}
                  message={m}
                  index={index}
                  chatStyle={chatStyle}
                  speaking={speakingIndex === index}
                  speechSupported={speechSupported}
                  copied={copiedIndex === index}
                  sourcesOpen={openSources === index}
                  onToggleSources={() => setOpenSources((s) => (s === index ? null : index))}
                  onSpeak={() => speak(index, m.text)}
                  onCopy={() => copyReply(index, m.text)}
                  onThumbUp={() => void saveAsExample(index)}
                  onThumbDown={() =>
                    setMessages((prev) => prev.map((x, xi) => (xi === index ? { ...x, feedback: 'down' } : x)))
                  }
                  onRaiseMaxTokens={props.onRaiseMaxTokens}
                  maxTokens={props.maxTokens}
                />
              );
            })}

            {loading && (
              <div className="flex items-center gap-2.5">
                <Avatar />
                <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md bg-white px-4 py-3 ring-1 ring-slate-200/80">
                  <Dot delay="0ms" /><Dot delay="150ms" /><Dot delay="300ms" />
                </div>
              </div>
            )}

            {error && (
              <AiNotice tone="error" icon={<AlertTriangle className="h-4 w-4" />}>{error}</AiNotice>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-slate-100 bg-white p-3 sm:p-4">
            <div className="flex items-center gap-2">
              <input
                id="test-ai-input"
                autoComplete="off"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="Type your message here..."
                className="h-11 min-w-0 flex-1 rounded-full bg-[#F5F6FA] px-4 text-[13.5px] text-slate-800 outline-none ring-1 ring-slate-200/80 transition-shadow placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-[#5B6CF9]/40"
              />
              {voiceSupported && (
                <button
                  type="button"
                  onClick={toggleVoice}
                  aria-label={listening ? 'Stop dictation' : 'Dictate a message'}
                  className={[
                    'grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors',
                    listening
                      ? 'bg-rose-500 text-white'
                      : 'bg-[#F5F6FA] text-slate-500 ring-1 ring-slate-200/80 hover:text-[#5B6CF9]',
                  ].join(' ')}
                >
                  <Mic className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => void send()}
                disabled={loading || !input.trim()}
                aria-label="Send message"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-b from-[#6B7BFF] to-[#4A5AE8] text-white shadow-[0_2px_8px_-2px_rgba(74,90,232,.6)] transition-opacity disabled:opacity-40"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {examples.slice(0, 4).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void send(q)}
                  disabled={loading}
                  className="truncate rounded-full bg-white px-3 py-1.5 text-[11.5px] text-slate-600 ring-1 ring-slate-200/80 transition-colors hover:bg-[#EEF0FF] hover:text-[#4A5AE8] disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
              {visible.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setMessages([]); setError(''); window.speechSynthesis?.cancel(); }}
                  className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11.5px] font-medium text-rose-600 transition-colors hover:bg-rose-50"
                >
                  <Trash2 className="h-3 w-3" />
                  Clear chat
                </button>
              )}
            </div>
          </div>
        </AiCard>

        {/* Working column */}
        <div className="space-y-3">
          <LiveVoicePanel
            enabled={!!props.liveVoiceEnabled}
            mode={mode === 'admin' ? 'admin' : 'customer'}
            language={voiceLang}
            onLanguageChange={setVoiceLang}
            languages={VOICE_LANGUAGES}
            autoSpeak={autoSpeak}
            onAutoSpeakChange={setAutoSpeak}
            speechSupported={speechSupported}
            onKeepTranscript={keepVoiceTranscript}
          />

          <AiCard className="p-3.5">
            <button
              type="button"
              onClick={() => setExamplesOpen((o) => !o)}
              aria-expanded={examplesOpen}
              className="flex w-full items-center gap-2.5 text-left"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#FEF6E7]">
                <Lightbulb className="h-4 w-4 text-amber-500" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-slate-900">Example Queries</span>
                <span className="block text-[11px] text-slate-500">{examples.length} to try</span>
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${examplesOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {examplesOpen && (
              <ul className="mt-2 -mx-1 border-t border-slate-100 pt-1">
                {examples.map((q) => (
                  <li key={q}>
                    <button
                      type="button"
                      onClick={() => void send(q)}
                      disabled={loading}
                      className="group flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-[#F5F6FA] disabled:opacity-50"
                    >
                      <MessageSquare className="h-3 w-3 shrink-0 text-slate-300 group-hover:text-[#5B6CF9]" />
                      <span className="min-w-0 flex-1 truncate text-[12px] text-slate-600 group-hover:text-slate-900">{q}</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-[#5B6CF9]" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </AiCard>

          <AiCard className="p-3.5">
            <div className="mb-2.5 flex items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-emerald-50">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-slate-900">AI Status</span>
                <span className="block truncate text-[11px] text-slate-500">
                  {knowledgeCount === 0 ? 'Nothing to answer from yet' : 'Ready to respond'}
                </span>
              </span>
            </div>

            {knowledgeCount === 0 && (
              <div className="mb-2.5">
                <AiNotice tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
                  Your knowledge base is empty, so replies come from the prompt alone.
                </AiNotice>
              </div>
            )}
            <div className="grid grid-cols-3 gap-1.5">
              <StatTile
                icon={<BookOpen className="h-3.5 w-3.5" />}
                value={knowledgeCount === null ? '—' : String(knowledgeCount)}
                label="Knowledge"
                caption={knowledgeCount === 1 ? 'entry' : 'entries'}
                warn={knowledgeCount !== null && knowledgeCount < 10}
              />
              <StatTile
                icon={<Clock className="h-3.5 w-3.5" />}
                value={lastTrained ?? '—'}
                label="Updated"
                caption="last change"
              />
              <StatTile
                icon={<Cpu className="h-3.5 w-3.5" />}
                value={props.model ? props.model.replace(/^models\//, '').replace('gemini-', '') : '—'}
                label="Model"
                caption="active"
              />
            </div>

            {/* Session figures share this card rather than opening a
                second one: they are the same question — how is it doing
                right now — and a divider says that better than a gap. */}
            <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="mb-2 flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 shrink-0 text-[#5B6CF9]" />
                <span className="flex-1 text-[12px] font-semibold text-slate-800">This session</span>
                {visible.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setMessages([]); setError(''); }}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-slate-500 transition-colors hover:bg-[#F5F6FA]"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset
                  </button>
                )}
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                <SummaryTile value={String(summary.messages)} label="Msgs" />
                <SummaryTile value={summary.avg} label="Avg" />
                <SummaryTile value={summary.grounded} label="Grounded" tone={summary.grounded === '—' ? 'plain' : 'good'} />
                <SummaryTile value={String(summary.issues)} label="Issues" tone={summary.issues > 0 ? 'bad' : 'plain'} />
              </div>
              <p className="mt-2 text-[10.5px] leading-relaxed text-slate-400">
                &ldquo;Grounded&rdquo; means the answer came from a knowledge entry or a data lookup — not that it
                was correct. The Accuracy tab measures that.
              </p>
            </div>
          </AiCard>
        </div>
      </div>

      {/* Contact sync: a repair job you reach for occasionally, not
          something to read every time you test a reply. It was the
          tallest thing on the page. */}
      <AiModal open={contactsOpen} onOpenChange={setContactsOpen} size="lg">
        <AiModalHeader
          icon={<Users className="h-4 w-4" />}
          title="Contact save & sync"
          subtitle="Check that inbox contacts are stored and reachable by the assistant."
          onClose={() => setContactsOpen(false)}
        />
        <AiModalBody className="max-h-[70vh] overflow-y-auto">
          <ContactSyncPanel />
        </AiModalBody>
      </AiModal>
    </div>
  );
}

/* ─────────────────────── pieces ─────────────────────── */

/**
 * Which assistant you are talking to.
 *
 * Two cards the width of the screen to carry one word each was a lot of
 * room for a binary choice. A radio group says the same thing in a
 * strip, and — unlike the cards — says out loud that the options are
 * mutually exclusive, which is the one thing about this control a
 * screen-reader user needs to know.
 */
function ModeRadio({ value, onChange }: { value: 'admin' | 'customer'; onChange: (v: 'admin' | 'customer') => void }) {
  const options = [
    { id: 'customer' as const, label: 'Customer', Icon: UserRound, hint: 'What a real customer sees' },
    { id: 'admin' as const, label: 'Admin', Icon: Database, hint: 'Your own CRM data' },
  ];
  return (
    <div role="radiogroup" aria-label="Test mode" className="flex items-center gap-1 rounded-xl bg-[#F5F6FA] p-1">
      {options.map(({ id, label, Icon, hint }) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            title={hint}
            onClick={() => onChange(id)}
            className={[
              'inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-all duration-150',
              active
                ? 'bg-white text-[#4A5AE8] shadow-[0_1px_2px_rgba(15,23,42,.08)]'
                : 'text-slate-500 hover:text-slate-700',
            ].join(' ')}
          >
            <span
              className={[
                'grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full ring-1 transition-colors',
                active ? 'ring-[#5B6CF9]' : 'ring-slate-300',
              ].join(' ')}
            >
              {active && <span className="h-1.5 w-1.5 rounded-full bg-[#5B6CF9]" />}
            </span>
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Avatar() {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center self-end rounded-full bg-gradient-to-b from-[#6B7BFF] to-[#4A5AE8] text-white shadow-[0_2px_6px_-2px_rgba(74,90,232,.6)]">
      <Bot className="h-4 w-4" />
    </span>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-1.5 w-1.5 rounded-full bg-slate-400 motion-safe:animate-bounce"
      style={{ animationDelay: delay }}
    />
  );
}

function IntroBubble({ mode }: { mode: 'admin' | 'customer' }) {
  return (
    <div className="flex items-end gap-2.5">
      <Avatar />
      <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-white px-4 py-3 text-[13.5px] leading-relaxed text-slate-700 ring-1 ring-slate-200/80">
        {mode === 'customer'
          ? '👋 Hi! I\'m your AI assistant. Ask me anything about our services, admissions, timings, facilities or any other information. I\'ll answer just like I would to a real customer.'
          : '📊 Ask me about your CRM data — enquiries, conversations, contacts, team workload. I read the database directly and never guess a number.'}
      </div>
    </div>
  );
}

function UserBubble({ message }: { message: TestMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[#D9FDD3] px-3.5 py-2.5 ring-1 ring-emerald-600/10">
        <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-slate-800">{message.text}</p>
        <span className="mt-1 flex items-center justify-end gap-1 text-[10.5px] text-slate-500">
          {message.spoken && <Mic className="h-2.5 w-2.5" aria-label="Spoken" />}
          {clockTime(message.at)}
          {/* Two ticks: this screen is a rehearsal of a WhatsApp thread,
              and the read marker is part of what it is imitating. */}
          <svg viewBox="0 0 16 11" className="h-3 w-3.5 fill-sky-500" aria-hidden="true">
            <path d="M11.07.65 5.4 6.32 3.9 4.83l-.7.7 2.2 2.2 6.37-6.38-.7-.7Z" />
            <path d="M15.07.65 9.4 6.32l-.75-.74-.7.7 1.45 1.45L15.77 1.35l-.7-.7Z" />
          </svg>
        </span>
      </div>
    </div>
  );
}

function BotBubble(props: {
  message: TestMessage;
  index: number;
  chatStyle: 'whatsapp' | 'plain';
  speaking: boolean;
  speechSupported: boolean;
  copied: boolean;
  sourcesOpen: boolean;
  onToggleSources: () => void;
  onSpeak: () => void;
  onCopy: () => void;
  onThumbUp: () => void;
  onThumbDown: () => void;
  onRaiseMaxTokens?: (v: number) => void;
  maxTokens: number;
}) {
  const m = props.message;
  const sources = m.sources ?? [];
  const lowConfidence = m.confidence !== null && m.confidence !== undefined && m.confidence < 0.35;

  return (
    <div className="flex items-end gap-2.5">
      <Avatar />
      <div className="min-w-0 max-w-[85%]">
        <div className="rounded-2xl rounded-bl-md bg-white px-4 py-3 ring-1 ring-slate-200/80">
          <div className="break-words text-[13.5px] leading-relaxed text-slate-700">
            {m.mode === 'admin' || props.chatStyle === 'plain' ? (
              <MarkdownAnswer text={m.text} />
            ) : (
              <WhatsAppText text={m.text} />
            )}
          </div>

          {m.truncated && (
            <div className="mt-2.5">
              <AiNotice tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
                <span className="block">Cut off at the {props.maxTokens}-token limit.</span>
                {props.onRaiseMaxTokens && props.maxTokens < 8192 && (
                  <button
                    type="button"
                    onClick={() => props.onRaiseMaxTokens?.(Math.min(8192, props.maxTokens * 2))}
                    className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[11.5px] font-semibold text-[#4A5AE8] ring-1 ring-[#5B6CF9]/25 hover:bg-[#EEF0FF]"
                  >
                    Raise to {Math.min(8192, props.maxTokens * 2)} and save
                  </button>
                )}
              </AiNotice>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <IconAction label="Helpful — save as a knowledge entry" onClick={props.onThumbUp} active={m.feedback === 'up'}>
              <ThumbsUp className="h-3.5 w-3.5" />
            </IconAction>
            <IconAction label="Not helpful" onClick={props.onThumbDown} active={m.feedback === 'down'} danger>
              <ThumbsDown className="h-3.5 w-3.5" />
            </IconAction>
            <IconAction label={props.copied ? 'Copied' : 'Copy reply'} onClick={props.onCopy}>
              {props.copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            </IconAction>
            {props.speechSupported && (
              <IconAction label={props.speaking ? 'Stop reading' : 'Read out loud'} onClick={props.onSpeak} active={props.speaking}>
                {props.speaking ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              </IconAction>
            )}

            <span className="ml-auto flex items-center gap-1.5">
              {m.saved && (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-700">
                  <Check className="h-3 w-3" />
                  Saved
                </span>
              )}
              {(sources.length > 0 || (m.toolsUsed?.length ?? 0) > 0) && (
                <button
                  type="button"
                  onClick={props.onToggleSources}
                  className="inline-flex items-center gap-1 rounded-md bg-[#F5F6FA] px-2 py-0.5 text-[10.5px] font-medium text-slate-600 ring-1 ring-slate-200/70 transition-colors hover:text-[#4A5AE8]"
                >
                  {m.mode === 'admin'
                    ? `Data used (${m.toolsUsed?.length ?? 0})`
                    : `Sources (${sources.length})`}
                  <ChevronRight className={`h-3 w-3 transition-transform ${props.sourcesOpen ? 'rotate-90' : ''}`} />
                </button>
              )}
            </span>
          </div>

          {props.sourcesOpen && (
            <ul className="mt-2 space-y-1 rounded-xl bg-[#F5F6FA] p-2.5 ring-1 ring-slate-200/70">
              {(m.mode === 'admin' ? (m.toolsUsed ?? []) : sources).map((s, i) => (
                <li key={`${s}-${i}`} className="flex items-start gap-1.5 text-[11.5px] text-slate-600">
                  <BookOpen className="mt-[2px] h-3 w-3 shrink-0 text-slate-400" />
                  <span className="min-w-0 break-words">{s}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-1 flex items-center gap-2 pl-1">
          {m.spoken && (
            <span className="inline-flex items-center gap-1 text-[10.5px] text-slate-400">
              <Mic className="h-2.5 w-2.5" />
              Spoken
            </span>
          )}
          <span className="text-[10.5px] text-slate-400">{clockTime(m.at)}</span>
          {typeof m.latencyMs === 'number' && (
            <span className="text-[10.5px] text-slate-400">{(m.latencyMs / 1000).toFixed(1)}s</span>
          )}
          {lowConfidence && (
            <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-amber-700">
              <ShieldCheck className="h-3 w-3" />
              Weak match ({m.confidence?.toFixed(2)})
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function IconAction({
  children, label, onClick, active, danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  const tone = active
    ? danger
      ? 'bg-rose-50 text-rose-600'
      : 'bg-emerald-50 text-emerald-700'
    : 'text-slate-400 hover:bg-[#F5F6FA] hover:text-slate-600';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`grid h-6 w-6 place-items-center rounded-md transition-colors ${tone}`}
    >
      {children}
    </button>
  );
}

function StatTile({
  icon, value, label, caption, warn,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  caption: string;
  warn?: boolean;
}) {
  return (
    <div className={`rounded-xl p-2 text-center ring-1 ${warn ? 'bg-amber-50/60 ring-amber-500/20' : 'bg-[#F7F8FC] ring-slate-200/70'}`}>
      <span className={`mx-auto mb-1 grid h-6 w-6 place-items-center rounded-lg ${warn ? 'text-amber-600' : 'text-slate-400'}`}>
        {icon}
      </span>
      <p className={`truncate text-[13px] font-semibold tabular-nums ${warn ? 'text-amber-800' : 'text-slate-800'}`} title={value}>
        {value}
      </p>
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="truncate text-[10px] text-slate-400">{caption}</p>
    </div>
  );
}

function SummaryTile({ value, label, tone = 'plain' }: { value: string; label: string; tone?: 'plain' | 'good' | 'bad' }) {
  const colour =
    tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-rose-600' : 'text-slate-800';
  return (
    <div className="rounded-xl bg-[#F7F8FC] p-2 text-center ring-1 ring-slate-200/70">
      <p className={`text-[15px] font-semibold tabular-nums ${colour}`}>{value}</p>
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  );
}
