'use client';

/**
 * Talk to the assistant and hear it answer, with no turn-taking button.
 *
 * Four things here are not obvious:
 *
 * 1. **Two audio contexts.** The Live API takes 16 kHz in and sends
 *    24 kHz back. A browser's default context runs at 48 kHz, so rather
 *    than resampling by hand each direction gets its own context at the
 *    rate it needs and the browser does the conversion.
 *
 * 2. **Playback is scheduled, not fired.** Audio arrives in chunks
 *    faster than real time. Playing each as it lands overlaps them into
 *    noise; playing them strictly in sequence leaves gaps. A cursor
 *    tracks when the previous chunk ends and each new one starts exactly
 *    there.
 *
 * 3. **Barge-in is detected locally, not waited for.** The server also
 *    reports an interruption, but that answer arrives a round trip late
 *    — long enough that the assistant talks over the person for a
 *    noticeable moment, which is the thing that makes a voice bot feel
 *    like a machine. A voice-activity detector in the browser stops
 *    playback the instant the microphone hears speech, and the server's
 *    own signal then arrives as confirmation rather than as the trigger.
 *
 * 4. **An interruption must cancel what is already scheduled.** Several
 *    seconds of reply are usually queued ahead of the clock. Without
 *    stopping those, the abandoned sentence keeps playing underneath the
 *    new answer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Radio, Loader2, AlertTriangle, Send, Volume2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { AiCard, AiInput, AiNotice } from './ui-kit';

const INPUT_RATE = 16_000;
const OUTPUT_RATE = 24_000;

/** Keeps playback a hair ahead of the clock so scheduling jitter does
 *  not produce an audible click between chunks. */
const SCHEDULE_LEAD_SEC = 0.06;

/**
 * Voice-activity thresholds.
 *
 * A worklet block is 128 samples, which at 16 kHz is 8 ms. Requiring a
 * run of blocks rather than a single one is what separates speech from a
 * door closing: ~15 blocks is 120 ms, short enough to feel instant and
 * long enough that a cough or a keyboard tap does not cut the assistant
 * off mid-sentence.
 *
 * The floor is adaptive because a fixed one is wrong in both directions
 * — it never triggers in a noisy office and triggers constantly on a
 * sensitive headset. A rolling estimate of the room's own noise is kept,
 * and speech has to stand clearly above it.
 */
const VAD_MIN_LEVEL = 0.012;
const VAD_NOISE_MULTIPLIER = 2.8;
const VAD_BLOCKS_TO_TRIGGER = 15;
/** How fast the noise estimate follows the room. Slow on the way up so a
 *  long sentence cannot raise the floor above itself. */
const VAD_NOISE_ATTACK = 0.002;
const VAD_NOISE_DECAY = 0.05;

/**
 * Captures mono samples, posts them as 16-bit PCM, and reports the
 * loudness of each block so the main thread can run voice detection
 * without a second analyser node reading the same stream.
 *
 * Delivered as a Blob URL rather than a file in /public: it is part of
 * this component's behaviour, and a stray .js in the public directory is
 * the kind of thing that gets deleted by someone tidying up.
 */
const CAPTURE_WORKLET = `
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    const pcm = new Int16Array(channel.length);
    let sumSquares = 0;
    for (let i = 0; i < channel.length; i++) {
      const clamped = Math.max(-1, Math.min(1, channel[i]));
      sumSquares += clamped * clamped;
      pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }
    this.port.postMessage(
      { pcm: pcm.buffer, rms: Math.sqrt(sumSquares / channel.length) },
      [pcm.buffer],
    );
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

/**
 * Works out why the microphone could not be opened, and says what to do
 * about that specific cause.
 *
 * A browser raises NotAllowedError for at least three different
 * situations, and only one of them is a site block:
 *
 *   1. The site is genuinely blocked in browser settings.
 *   2. The permission prompt was dismissed — clicked away, or missed.
 *      The browser records no block, so site settings look normal.
 *   3. The operating system is denying the browser the microphone. On
 *      Windows that is Privacy & security -> Microphone; browser
 *      settings again look completely normal.
 *
 * Reporting all three as "your browser blocked it" sends someone to a
 * menu that already says "Ask", which wastes their time and convinces
 * them the app is broken. The Permissions API separates them: a real
 * site block reports 'denied', while the other two leave it at 'prompt'.
 *
 * The insecure-context case is handled before this is ever reached — a
 * browser only exposes the microphone over HTTPS or on localhost, and no
 * permission can change that.
 */
async function diagnoseMicFailure(err: unknown): Promise<string> {
  const name = (err as { name?: string })?.name ?? '';
  const message = err instanceof Error ? err.message : String(err ?? '');

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    // Not supported for 'microphone' everywhere (Firefox and Safari have
    // both lacked the descriptor), so an unknown answer has to remain a
    // possible outcome rather than an assumption either way.
    let state: string = 'unknown';
    try {
      const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
      state = status?.state ?? 'unknown';
    } catch {
      /* descriptor unsupported — fall through to the combined message */
    }

    if (state === 'denied') {
      return 'This site is blocked from using the microphone. Click the padlock in the address bar, set Microphone to Allow, then reload the page.';
    }

    // 'prompt' (or unknown) means the browser has no block recorded, so
    // the site-settings list is a dead end. Either the popup was
    // dismissed or the operating system is refusing.
    return [
      'The browser has no block recorded for this site, so the request was either dismissed or refused by your computer.',
      '1. Click "Start talking" again and choose Allow on the popup — it can appear behind the window.',
      '2. If no popup appears: Windows Settings → Privacy & security → Microphone, and turn on both "Microphone access" and "Let desktop apps access your microphone".',
    ].join('\n');
  }

  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    // Distinguishes "nothing plugged in" from "the browser cannot see
    // the device", which have completely different fixes.
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!devices.some((d) => d.kind === 'audioinput')) {
        return 'No microphone is attached to this computer. Plug one in, or connect a headset, and try again.';
      }
    } catch {
      /* enumeration is itself permission-gated on some browsers */
    }
    return 'The microphone could not be opened. Check which input device is selected in your system sound settings.';
  }

  if (name === 'NotReadableError') {
    return 'Another program is already using the microphone — a call, a recorder, or another browser tab. Close it and try again.';
  }

  if (name === 'AbortError') {
    return 'The microphone stopped responding before the session could start. Try again.';
  }

  return message || 'The microphone could not be opened.';
}

type Status = 'idle' | 'connecting' | 'live' | 'error';
type Turn = { who: 'you' | 'assistant'; text: string };

export interface LiveVoicePanelProps {
  enabled: boolean;
  mode: 'customer' | 'admin';
  /** Sidebar presentation. */
  compact?: boolean;
  /** Shared with the text chat's dictation and read-aloud. */
  language?: string;
  onLanguageChange?: (v: string) => void;
  languages?: { id: string; label: string }[];
  autoSpeak?: boolean;
  onAutoSpeakChange?: (v: boolean) => void;
  speechSupported?: boolean;
}

export function LiveVoicePanel(props: LiveVoicePanelProps) {
  const { enabled, mode, compact } = props;

  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [youSpeaking, setYouSpeaking] = useState(false);
  const [level, setLevel] = useState(0);
  const [typed, setTyped] = useState('');
  const [insecure, setInsecure] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const micContextRef = useRef<AudioContext | null>(null);
  const playContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletUrlRef = useRef<string | null>(null);
  const playCursorRef = useRef(0);
  const scheduledRef = useRef<AudioBufferSourceNode[]>([]);

  /** VAD state, in refs because it updates every 8 ms and must not
   *  re-render the component at that rate. */
  const noiseFloorRef = useRef(VAD_MIN_LEVEL);
  const voiceBlocksRef = useRef(0);
  const assistantSpeakingRef = useRef(false);

  const appendTurn = useCallback((who: Turn['who'], text: string) => {
    if (!text.trim()) return;
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      // The API streams transcripts a few words at a time; appending to
      // the open turn keeps it one sentence instead of twenty fragments.
      if (last && last.who === who) return [...prev.slice(0, -1), { who, text: last.text + text }];
      return [...prev, { who, text }];
    });
  }, []);

  const stopPlayback = useCallback(() => {
    for (const node of scheduledRef.current) {
      try {
        node.stop();
      } catch {
        /* already finished */
      }
    }
    scheduledRef.current = [];
    playCursorRef.current = 0;
    assistantSpeakingRef.current = false;
    setSpeaking(false);
  }, []);

  const teardown = useCallback(() => {
    stopPlayback();
    socketRef.current?.close();
    socketRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void micContextRef.current?.close().catch(() => {});
    micContextRef.current = null;
    void playContextRef.current?.close().catch(() => {});
    playContextRef.current = null;
    if (workletUrlRef.current) {
      URL.revokeObjectURL(workletUrlRef.current);
      workletUrlRef.current = null;
    }
    voiceBlocksRef.current = 0;
    noiseFloorRef.current = VAD_MIN_LEVEL;
    setYouSpeaking(false);
    setLevel(0);
  }, [stopPlayback]);

  useEffect(() => teardown, [teardown]);

  useEffect(() => {
    setInsecure(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia);
  }, []);

  const playChunk = useCallback((pcm: ArrayBuffer) => {
    const ctx = playContextRef.current;
    if (!ctx) return;

    const samples = new Int16Array(pcm);
    if (samples.length === 0) return;

    const buffer = ctx.createBuffer(1, samples.length, OUTPUT_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 0x8000;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const startAt = Math.max(ctx.currentTime + SCHEDULE_LEAD_SEC, playCursorRef.current);
    source.start(startAt);
    playCursorRef.current = startAt + buffer.duration;

    scheduledRef.current.push(source);
    source.onended = () => {
      scheduledRef.current = scheduledRef.current.filter((n) => n !== source);
      if (scheduledRef.current.length === 0) {
        assistantSpeakingRef.current = false;
        setSpeaking(false);
      }
    };
    assistantSpeakingRef.current = true;
    setSpeaking(true);
  }, []);

  /**
   * One block of microphone audio: update the noise estimate, decide
   * whether this is speech, and cut the assistant off if it is.
   */
  const handleMicBlock = useCallback(
    (rms: number, socket: WebSocket, pcm: ArrayBuffer) => {
      // The assistant's own voice must not raise the room's noise floor,
      // or the floor climbs while it talks and barge-in stops working.
      if (!assistantSpeakingRef.current) {
        const rate = rms > noiseFloorRef.current ? VAD_NOISE_ATTACK : VAD_NOISE_DECAY;
        noiseFloorRef.current += (rms - noiseFloorRef.current) * rate;
      }

      const threshold = Math.max(VAD_MIN_LEVEL, noiseFloorRef.current * VAD_NOISE_MULTIPLIER);
      const isVoice = rms > threshold;

      voiceBlocksRef.current = isVoice ? voiceBlocksRef.current + 1 : 0;
      const speechConfirmed = voiceBlocksRef.current >= VAD_BLOCKS_TO_TRIGGER;

      if (speechConfirmed) {
        setYouSpeaking(true);
        // Barge-in. Stop locally and now, rather than waiting for the
        // server's interruption event a round trip later.
        if (assistantSpeakingRef.current) stopPlayback();
      } else if (!isVoice) {
        setYouSpeaking(false);
      }

      // A coarse meter — updated from a value that changes every 8 ms, so
      // it is smoothed rather than rendered raw.
      setLevel((prev) => prev + (Math.min(1, rms * 12) - prev) * 0.25);

      // Audio is always forwarded, speech or not: the API runs its own
      // endpointing and needs the silence to know a turn ended. Local VAD
      // decides when to stop *playback*, never what to send.
      if (socket.readyState === WebSocket.OPEN) socket.send(pcm);
    },
    [stopPlayback],
  );

  const start = useCallback(async () => {
    setError('');
    setTurns([]);
    setStatus('connecting');

    try {
      const ticketRes = await fetch('/api/ai-config/live-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const ticketData = await ticketRes.json();
      if (!ticketRes.ok) throw new Error(ticketData.error ?? 'Could not start the session.');

      // Checked before the prompt, because this is the one failure a
      // permission cannot fix.
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          `This page is open over ${window.location.protocol.replace(':', '')}, and browsers only allow microphone access on https:// or localhost.`,
        );
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          // Echo cancellation is what stops the assistant's own voice
          // coming back through the microphone and triggering barge-in
          // against itself on a laptop speaker.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const micContext = new AudioContext({ sampleRate: INPUT_RATE });
      micContextRef.current = micContext;
      const playContext = new AudioContext({ sampleRate: OUTPUT_RATE });
      playContextRef.current = playContext;

      const workletUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }));
      workletUrlRef.current = workletUrl;
      await micContext.audioWorklet.addModule(workletUrl);

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(
        `${protocol}//${window.location.host}${ticketData.path}?ticket=${encodeURIComponent(ticketData.ticket)}`,
      );
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;

      socket.onopen = () => {
        const source = micContext.createMediaStreamSource(stream);
        const capture = new AudioWorkletNode(micContext, 'capture-processor');
        capture.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
          handleMicBlock(event.data.rms, socket, event.data.pcm);
        };
        source.connect(capture);
        // Through a silent gain node: some browsers suspend a worklet
        // whose output reaches nothing, which stops the microphone with
        // no error at all.
        const mute = micContext.createGain();
        mute.gain.value = 0;
        capture.connect(mute).connect(micContext.destination);
      };

      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          playChunk(event.data);
          return;
        }
        const msg = JSON.parse(event.data as string) as {
          type: string; text?: string; message?: string; reason?: string;
        };
        if (msg.type === 'ready') setStatus('live');
        else if (msg.type === 'input_transcript') appendTurn('you', msg.text ?? '');
        else if (msg.type === 'output_transcript') appendTurn('assistant', msg.text ?? '');
        else if (msg.type === 'interrupted') stopPlayback();
        else if (msg.type === 'error') {
          setError(msg.message ?? 'Something went wrong.');
          setStatus('error');
        } else if (msg.type === 'closed') {
          setStatus('idle');
          teardown();
        }
      };

      socket.onerror = () => {
        setError('The connection dropped. Check your network and try again.');
        setStatus('error');
      };
      socket.onclose = () => setStatus((s) => (s === 'error' ? s : 'idle'));
    } catch (err) {
      setError(await diagnoseMicFailure(err));
      setStatus('error');
      teardown();
    }
  }, [mode, appendTurn, playChunk, stopPlayback, teardown, handleMicBlock]);

  const stop = useCallback(() => {
    socketRef.current?.send(JSON.stringify({ type: 'close' }));
    teardown();
    setStatus('idle');
  }, [teardown]);

  const sendTyped = useCallback(() => {
    const text = typed.trim();
    if (!text || socketRef.current?.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ type: 'text', text }));
    appendTurn('you', text);
    setTyped('');
  }, [typed, appendTurn]);

  const live = status === 'live';

  /* ── Sidebar presentation ───────────────────────────────────── */
  if (compact) {
    return (
      <AiCard className="p-4">
        <div className="mb-3 flex items-start gap-2.5">
          <span
            className={[
              'grid h-8 w-8 shrink-0 place-items-center rounded-xl transition-colors',
              live ? 'bg-emerald-50 text-emerald-600' : 'bg-[#EEF0FF] text-[#5B6CF9]',
            ].join(' ')}
          >
            {live ? <Radio className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-semibold text-slate-900">Voice Test</span>
            <span className="block text-[11.5px] text-slate-500">
              {live
                ? youSpeaking
                  ? 'Listening to you…'
                  : speaking
                    ? 'Speaking — just talk to interrupt'
                    : 'Go ahead, say something'
                : 'Talk to the AI just like a real customer.'}
            </span>
          </span>
        </div>

        {props.languages && props.onLanguageChange && (
          <div className="mb-2.5">
            <Select value={props.language ?? 'en-IN'} onValueChange={(v) => v && props.onLanguageChange?.(v)}>
              <SelectTrigger className="h-9 w-full rounded-xl border-slate-200 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {props.languages.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {!enabled ? (
          <AiNotice tone="info" icon={<Radio className="h-3.5 w-3.5" />}>
            Turn on <strong>Live voice</strong> in AI Training → Advanced Features to speak with the assistant in
            real time.
          </AiNotice>
        ) : insecure ? (
          <AiNotice tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
            Live voice needs an <code className="rounded bg-white/60 px-1">https://</code> address. Open the CRM
            over HTTPS to use the microphone.
          </AiNotice>
        ) : (
          <button
            type="button"
            onClick={() => (live || status === 'connecting' ? stop() : void start())}
            className={[
              'flex h-10 w-full items-center justify-center gap-2 rounded-xl text-[13px] font-semibold transition-all',
              live
                ? 'bg-rose-500 text-white hover:bg-rose-600'
                : 'bg-gradient-to-b from-[#6B7BFF] to-[#4A5AE8] text-white shadow-[0_2px_8px_-2px_rgba(74,90,232,.55)]',
            ].join(' ')}
          >
            {status === 'connecting' ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Connecting…</>
            ) : live ? (
              <><MicOff className="h-4 w-4" /> End conversation</>
            ) : (
              <><Mic className="h-4 w-4" /> Start talking</>
            )}
          </button>
        )}

        {live && <LevelMeter level={level} youSpeaking={youSpeaking} speaking={speaking} />}

        {error && (
          <div className="mt-2.5">
            <AiNotice tone="error" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
              <span className="block whitespace-pre-line">{error}</span>
            </AiNotice>
          </div>
        )}

        {live && turns.length > 0 && (
          <div className="mt-3 max-h-44 space-y-1.5 overflow-y-auto rounded-xl bg-[#F7F8FC] p-2.5 ring-1 ring-slate-200/70">
            {turns.map((t, i) => (
              <p key={`${t.who}-${i}`} className="text-[12px] leading-relaxed">
                <span className={t.who === 'you' ? 'font-semibold text-slate-700' : 'font-semibold text-[#4A5AE8]'}>
                  {t.who === 'you' ? 'You: ' : 'AI: '}
                </span>
                <span className="text-slate-600">{t.text}</span>
              </p>
            ))}
          </div>
        )}

        {props.speechSupported && props.onAutoSpeakChange && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-[#F7F8FC] px-3 py-2.5 ring-1 ring-slate-200/70">
            <span className="flex min-w-0 items-center gap-2">
              <Volume2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="min-w-0">
                <span className="block text-[12.5px] font-medium text-slate-700">Read replies out loud</span>
                <span className="block text-[10.5px] text-slate-400">For typed answers in the chat</span>
              </span>
            </span>
            <Switch checked={!!props.autoSpeak} onCheckedChange={props.onAutoSpeakChange} />
          </div>
        )}
      </AiCard>
    );
  }

  /* ── Full-width presentation ────────────────────────────────── */
  return (
    <AiCard>
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className={[
                'grid h-11 w-11 place-items-center rounded-2xl',
                live ? 'bg-emerald-50 text-emerald-600' : 'bg-[#EEF0FF] text-[#5B6CF9]',
              ].join(' ')}
            >
              {live ? <Radio className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </span>
            <div>
              <p className="text-[15px] font-semibold text-slate-900">Live voice</p>
              <p className="text-[12.5px] text-slate-500">
                {live
                  ? youSpeaking ? 'Listening to you…' : speaking ? 'Speaking — talk over it to interrupt' : 'Listening'
                  : `Speak to the ${mode === 'admin' ? 'internal' : 'customer'} assistant and hear it answer`}
              </p>
            </div>
          </div>

          {enabled && !insecure && (
            <button
              type="button"
              onClick={() => (live || status === 'connecting' ? stop() : void start())}
              className={[
                'inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[13px] font-semibold transition-all',
                live ? 'bg-rose-500 text-white' : 'bg-gradient-to-b from-[#6B7BFF] to-[#4A5AE8] text-white',
              ].join(' ')}
            >
              {status === 'connecting' ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Connecting…</>
              ) : live ? (
                <><MicOff className="h-4 w-4" /> End</>
              ) : (
                <><Mic className="h-4 w-4" /> Start talking</>
              )}
            </button>
          )}
        </div>

        {!enabled && (
          <div className="mt-4">
            <AiNotice tone="info" icon={<Radio className="h-4 w-4" />}>
              Switch on <strong>Live voice</strong> in Advanced Features to use this.
            </AiNotice>
          </div>
        )}

        {insecure && enabled && (
          <div className="mt-4">
            <AiNotice tone="warning" icon={<AlertTriangle className="h-4 w-4" />}>
              This page is open over an insecure connection, and browsers only allow microphone access on
              <code className="mx-1 rounded bg-white/60 px-1 py-0.5 text-[11.5px]">https://</code>
              or <code className="mx-1 rounded bg-white/60 px-1 py-0.5 text-[11.5px]">localhost</code>.
            </AiNotice>
          </div>
        )}

        {error && (
          <div className="mt-4">
            <AiNotice tone="error" icon={<AlertTriangle className="h-4 w-4" />}>
              <span className="block whitespace-pre-line">{error}</span>
            </AiNotice>
          </div>
        )}

        {live && <LevelMeter level={level} youSpeaking={youSpeaking} speaking={speaking} />}

        <div className="mt-4 max-h-80 space-y-2 overflow-y-auto rounded-2xl bg-[#F7F8FC] p-4 ring-1 ring-slate-200/70">
          {turns.length === 0 ? (
            <p className="text-[12.5px] text-slate-500">
              {live ? 'Go ahead — ask it something.' : 'What you say and what it says back appears here.'}
            </p>
          ) : (
            turns.map((t, i) => (
              <div key={`${t.who}-${i}`} className="text-[13px] leading-relaxed">
                <span className={t.who === 'you' ? 'font-semibold text-slate-700' : 'font-semibold text-[#4A5AE8]'}>
                  {t.who === 'you' ? 'You: ' : 'Assistant: '}
                </span>
                <span className="text-slate-700">{t.text}</span>
              </div>
            ))
          )}
        </div>

        {live && (
          <div className="mt-3 flex gap-2">
            <AiInput
              placeholder="Or type instead of speaking…"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  sendTyped();
                }
              }}
              className="h-9"
            />
            <button
              type="button"
              onClick={sendTyped}
              disabled={!typed.trim()}
              aria-label="Send"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#4A5AE8] text-white disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </AiCard>
  );
}

/** Shows who currently has the floor. The point is not decoration: when
 *  barge-in fires, seeing the bar switch sides is how you know the
 *  detector worked rather than the assistant simply finishing. */
function LevelMeter({ level, youSpeaking, speaking }: { level: number; youSpeaking: boolean; speaking: boolean }) {
  return (
    <div className="mt-3">
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200/70">
        <div
          className={[
            'h-full rounded-full transition-[width,background-color] duration-100',
            youSpeaking ? 'bg-emerald-500' : speaking ? 'bg-[#5B6CF9]' : 'bg-slate-300',
          ].join(' ')}
          style={{ width: `${Math.max(4, Math.round(level * 100))}%` }}
        />
      </div>
      <p className="mt-1 text-[10.5px] text-slate-400">
        {youSpeaking ? 'You are speaking' : speaking ? 'Assistant is speaking — start talking to cut in' : 'Silence'}
      </p>
    </div>
  );
}
