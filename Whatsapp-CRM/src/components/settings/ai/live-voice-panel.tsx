'use client';

/**
 * Talk to the assistant and hear it answer.
 *
 * Three things here are not obvious:
 *
 * 1. **Two audio contexts.** The Live API takes 16 kHz in and sends
 *    24 kHz back. A browser's default context runs at 48 kHz, so rather
 *    than resampling by hand each direction gets its own context at the
 *    rate it needs and the browser does the conversion.
 *
 * 2. **Playback is scheduled, not fired.** Audio arrives in chunks
 *    faster than real time. Playing each as it lands overlaps them into
 *    noise; playing them strictly in sequence leaves gaps. A cursor
 *    tracks when the previous chunk ends and each new one is scheduled
 *    to start exactly there.
 *
 * 3. **An interruption has to cancel what is already scheduled.** When
 *    the person talks over the assistant, several seconds of its reply
 *    are usually queued in the browser. Without stopping those, the
 *    interrupted sentence keeps playing underneath the new answer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Radio, Loader2, AlertTriangle, Send } from 'lucide-react';
import { AiButton, AiCard, AiCardHeader, AiIconTile, AiInput, AiHint, AiBadge, AiNotice } from './ui-kit';

const INPUT_RATE = 16_000;
const OUTPUT_RATE = 24_000;

/** Keeps playback a hair ahead of the clock so scheduling jitter does
 *  not produce an audible click between chunks. */
const SCHEDULE_LEAD_SEC = 0.06;

/**
 * Captures mono float samples and posts them as 16-bit PCM.
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
    for (let i = 0; i < channel.length; i++) {
      const clamped = Math.max(-1, Math.min(1, channel[i]));
      pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

/**
 * Why the microphone could not be opened, in terms of what to do next.
 *
 * The insecure-context case is the reason this exists. A browser only
 * exposes the microphone over HTTPS or on localhost, so a CRM reached at
 * http://192.168.1.20:3000 can never be granted access — the site does
 * not even appear in the browser's permission list. Telling that person
 * to "allow it in your browser" sends them looking for a setting that
 * cannot exist.
 */
function describeMicFailure(err: unknown): string {
  const name = (err as { name?: string })?.name ?? '';
  const message = err instanceof Error ? err.message : String(err ?? '');

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Your browser blocked the microphone. Click the padlock (or the camera icon) in the address bar, set Microphone to Allow, then reload this page.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found. Plug one in, or check that the right input device is selected in your system sound settings.';
    case 'NotReadableError':
      return 'Something else is already using the microphone — a call, a recorder, another browser tab. Close it and try again.';
    case 'AbortError':
      return 'The microphone stopped responding before the session could start. Try again.';
    default:
      return message || 'The microphone could not be opened.';
  }
}

type Status = 'idle' | 'connecting' | 'live' | 'error';
type Turn = { who: 'you' | 'assistant'; text: string };

export function LiveVoicePanel({ enabled, mode }: { enabled: boolean; mode: 'customer' | 'admin' }) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [typed, setTyped] = useState('');

  /** Resolved after mount: window is not available during the server
   *  render, and reading it directly would break hydration. */
  const [insecure, setInsecure] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const micContextRef = useRef<AudioContext | null>(null);
  const playContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletUrlRef = useRef<string | null>(null);
  /** When the audio already queued finishes, in playback-context time. */
  const playCursorRef = useRef(0);
  /** Everything scheduled but not yet finished, so it can be cancelled. */
  const scheduledRef = useRef<AudioBufferSourceNode[]>([]);

  const appendTurn = useCallback((who: Turn['who'], text: string) => {
    if (!text.trim()) return;
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      // The API streams transcripts a few words at a time; appending to
      // the open turn keeps it one sentence instead of twenty fragments.
      if (last && last.who === who) {
        return [...prev.slice(0, -1), { who, text: last.text + text }];
      }
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
      if (scheduledRef.current.length === 0) setSpeaking(false);
    };
    setSpeaking(true);
  }, []);

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
      // permission cannot fix. Browsers expose the microphone only in a
      // secure context; over plain HTTP the API is simply absent and the
      // site never appears in the browser's permission list.
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          `This page is open over ${window.location.protocol.replace(':', '')}, and browsers only allow microphone access on https:// or localhost. ` +
            'Open the CRM at its https:// address, or run it locally, and the microphone will work.',
        );
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
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
        capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(event.data);
        };
        source.connect(capture);
        // Connected to the destination through a silent gain node: some
        // browsers suspend a worklet whose output reaches nothing, which
        // stops the microphone without any error.
        const mute = micContext.createGain();
        mute.gain.value = 0;
        capture.connect(mute).connect(micContext.destination);
      };

      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          playChunk(event.data);
          return;
        }
        const msg = JSON.parse(event.data as string) as { type: string; text?: string; message?: string; reason?: string };
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
      socket.onclose = () => {
        setStatus((s) => (s === 'error' ? s : 'idle'));
      };
    } catch (err) {
      setError(describeMicFailure(err));
      setStatus('error');
      teardown();
    }
  }, [mode, appendTurn, playChunk, stopPlayback, teardown]);

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

  if (!enabled) {
    return (
      <AiCard>
        <div className="p-5">
          <AiCardHeader title="Live voice" subtitle="Have a spoken conversation with your assistant." />
          <div className="mt-4">
            <AiNotice tone="info" icon={<Radio className="h-4 w-4" />}>
              Switch on <strong>Live voice</strong> in Advanced Features to use this. It streams audio both ways
              for as long as the call is open, which is billed differently from a text reply.
            </AiNotice>
          </div>
        </div>
      </AiCard>
    );
  }

  return (
    <AiCard>
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <AiIconTile tint={status === 'live' ? 'emerald' : 'violet'}>
              {status === 'live' ? <Radio className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </AiIconTile>
            <div>
              <p className="text-[15px] font-semibold text-slate-900">Live voice</p>
              <p className="text-[12.5px] text-slate-500">
                {status === 'live'
                  ? speaking
                    ? 'Speaking — talk over it to interrupt'
                    : 'Listening'
                  : `Speak to the ${mode === 'admin' ? 'internal' : 'customer'} assistant and hear it answer`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {status === 'live' && <AiBadge tone="emerald">Connected</AiBadge>}
            {insecure && <AiBadge tone="amber">Needs HTTPS</AiBadge>}
            {status === 'idle' || status === 'error' ? (
              <AiButton onClick={() => void start()}>
                <Mic className="h-3.5 w-3.5" />
                Start talking
              </AiButton>
            ) : status === 'connecting' ? (
              <AiButton disabled>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Connecting…
              </AiButton>
            ) : (
              <AiButton tone="danger" onClick={stop}>
                <MicOff className="h-3.5 w-3.5" />
                End
              </AiButton>
            )}
          </div>
        </div>

        {insecure && !error && (
          <div className="mt-4">
            <AiNotice tone="warning" icon={<AlertTriangle className="h-4 w-4" />}>
              This page is open over an insecure connection, and browsers only allow microphone access on
              <code className="mx-1 rounded bg-white/60 px-1 py-0.5 text-[11.5px]">https://</code>
              or <code className="mx-1 rounded bg-white/60 px-1 py-0.5 text-[11.5px]">localhost</code>. Open the
              CRM at its https address to talk to the assistant. You can still type to it below once connected.
            </AiNotice>
          </div>
        )}

        {error && (
          <div className="mt-4">
            <AiNotice tone="error" icon={<AlertTriangle className="h-4 w-4" />}>{error}</AiNotice>
          </div>
        )}

        <div className="mt-4 max-h-80 space-y-2 overflow-y-auto rounded-2xl bg-[#F7F8FC] p-4 ring-1 ring-slate-200/70">
          {turns.length === 0 ? (
            <p className="text-[12.5px] text-slate-500">
              {status === 'live'
                ? 'Go ahead — ask it something.'
                : 'What you say and what it says back appears here, so you can read the conversation as well as hear it.'}
            </p>
          ) : (
            turns.map((turn, i) => (
              <div key={`${turn.who}-${i}`} className="text-[13px] leading-relaxed">
                <span
                  className={
                    turn.who === 'you'
                      ? 'font-semibold text-slate-700'
                      : 'font-semibold text-[#4A5AE8]'
                  }
                >
                  {turn.who === 'you' ? 'You: ' : 'Assistant: '}
                </span>
                <span className="text-slate-700">{turn.text}</span>
              </div>
            ))
          )}
        </div>

        {status === 'live' && (
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
            <AiButton onClick={sendTyped} disabled={!typed.trim()}>
              <Send className="h-3.5 w-3.5" />
            </AiButton>
          </div>
        )}

        <div className="mt-3">
          <AiHint>
            This is a rehearsal, not a customer channel. WhatsApp has no live audio, so customers reach the
            assistant by voice note — which it answers with one. Use this to judge whether it sounds right and
            knows its facts before it does.
          </AiHint>
        </div>
      </div>
    </AiCard>
  );
}
