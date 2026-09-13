'use client';

/**
 * One live voice session, usable from more than one piece of UI.
 *
 * Extracted from the panel because the conversation is now driven from
 * two places — a small card that starts it and a full-screen sheet that
 * runs it — and two copies of an audio pipeline is two places for the
 * barge-in logic to drift apart.
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
 *    tracks when the previous chunk ends and each new one starts there.
 *
 * 3. **Barge-in is detected locally, not waited for.** The server also
 *    reports an interruption, but that answer arrives a round trip late
 *    — long enough that the assistant talks over the person, which is
 *    the thing that makes a voice bot feel like a machine. A
 *    voice-activity detector in the browser stops playback the instant
 *    the microphone hears speech; the server's signal then arrives as
 *    confirmation rather than as the trigger.
 *
 * 4. **An interruption must cancel what is already scheduled.** Several
 *    seconds of reply are usually queued ahead of the clock. Without
 *    stopping those, the abandoned sentence plays under the new answer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const INPUT_RATE = 16_000;
const OUTPUT_RATE = 24_000;

/** Keeps playback a hair ahead of the clock so scheduling jitter does
 *  not produce an audible click between chunks. */
const SCHEDULE_LEAD_SEC = 0.06;

/**
 * Voice-activity thresholds.
 *
 * A worklet block is 128 samples, which at 16 kHz is 8 ms. Requiring a
 * run of blocks rather than one separates speech from a door closing:
 * ~15 blocks is 120 ms, short enough to feel instant and long enough
 * that a cough does not cut the assistant off mid-sentence.
 *
 * The floor is adaptive because a fixed one is wrong in both directions
 * — it never triggers in a noisy office and triggers constantly on a
 * sensitive headset.
 */
const VAD_MIN_LEVEL = 0.012;
const VAD_NOISE_MULTIPLIER = 2.8;
const VAD_BLOCKS_TO_TRIGGER = 15;
/** Slow on the way up, so a long sentence cannot raise the floor above
 *  itself; quick on the way down, so a passing lorry is forgotten. */
const VAD_NOISE_ATTACK = 0.002;
const VAD_NOISE_DECAY = 0.05;

/**
 * Captures mono samples, posts them as 16-bit PCM, and reports the
 * loudness of each block so voice detection needs no second analyser
 * reading the same stream.
 *
 * Delivered as a Blob URL rather than a file in /public: it is part of
 * this behaviour, and a stray .js in the public directory is the kind of
 * thing that gets deleted by someone tidying up.
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
 * A browser raises NotAllowedError for at least three situations and
 * only one is a site block:
 *
 *   1. The site is blocked in browser settings.
 *   2. The prompt was dismissed — clicked away, or missed. No block is
 *      recorded, so site settings look completely normal.
 *   3. The operating system is refusing the browser. On Windows that is
 *      Privacy & security -> Microphone; settings again look normal.
 *
 * Reported against a real case where site settings showed "Ask" with an
 * empty block list while the message insisted the browser had blocked
 * it. The Permissions API tells them apart: a genuine block reports
 * 'denied', the other two leave it at 'prompt'.
 */
export async function diagnoseMicFailure(err: unknown): Promise<string> {
  const name = (err as { name?: string })?.name ?? '';
  const message = err instanceof Error ? err.message : String(err ?? '');

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    let state = 'unknown';
    try {
      const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
      state = status?.state ?? 'unknown';
    } catch {
      /* the descriptor is unsupported on some browsers — fall through */
    }

    if (state === 'denied') {
      return [
        'This site is currently blocked from using the microphone.',
        'Click the padlock (or the icon left of the address) → set Microphone to Allow.',
        'If you have just turned it on, reload the page — the browser applies the change to a fresh load.',
      ].join('\n');
    }

    return [
      'The browser has no block recorded for this site, so the request was either dismissed or refused by your computer.',
      '1. Start again and choose Allow on the popup — it can appear behind the window.',
      '2. If no popup appears: Windows Settings → Privacy & security → Microphone, and turn on both "Microphone access" and "Let desktop apps access your microphone".',
    ].join('\n');
  }

  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
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

export type LiveVoiceStatus = 'idle' | 'connecting' | 'live' | 'error';
export type VoiceTurn = { who: 'you' | 'assistant'; text: string };

export function useLiveVoice(mode: 'customer' | 'admin') {
  const [status, setStatus] = useState<LiveVoiceStatus>('idle');
  const [error, setError] = useState('');
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);
  const [youSpeaking, setYouSpeaking] = useState(false);
  const [level, setLevel] = useState(0);
  const [insecure, setInsecure] = useState(false);
  /** 'granted' | 'denied' | 'prompt', or null where unsupported. */
  const [micPermission, setMicPermission] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const micContextRef = useRef<AudioContext | null>(null);
  const playContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletUrlRef = useRef<string | null>(null);
  const playCursorRef = useRef(0);
  const scheduledRef = useRef<AudioBufferSourceNode[]>([]);

  /** VAD state lives in refs: it updates every 8 ms and must not
   *  re-render the component at that rate. */
  const noiseFloorRef = useRef(VAD_MIN_LEVEL);
  const voiceBlocksRef = useRef(0);
  const assistantSpeakingRef = useRef(false);

  useEffect(() => {
    setInsecure(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia);
  }, []);

  /**
   * Follows the microphone permission rather than reading it once.
   *
   * Without this, granting the permission changed nothing the page could
   * see: the error stayed on screen insisting the site was blocked while
   * the browser's own panel showed the toggle green, and the only way
   * out was a reload nobody had been told to do. Granting it now clears
   * the error by itself.
   */
  useEffect(() => {
    let status: PermissionStatus | null = null;
    let cancelled = false;

    const onChange = () => {
      if (cancelled || !status) return;
      setMicPermission(status.state);
      // Only the error is cleared, never the session restarted — the
      // person pressed a browser control, not "start talking", and
      // opening a microphone off the back of that would be a surprise.
      if (status.state === 'granted') setError((e) => (e ? '' : e));
    };

    void (async () => {
      try {
        status = (await navigator.permissions?.query({ name: 'microphone' as PermissionName })) ?? null;
        if (cancelled || !status) return;
        setMicPermission(status.state);
        status.addEventListener('change', onChange);
      } catch {
        /* the descriptor is unsupported on some browsers */
      }
    })();

    return () => {
      cancelled = true;
      status?.removeEventListener('change', onChange);
    };
  }, []);

  const appendTurn = useCallback((who: VoiceTurn['who'], text: string) => {
    if (!text.trim()) return;
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      // Transcripts stream a few words at a time; appending to the open
      // turn keeps it one sentence instead of twenty fragments.
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
    setAssistantSpeaking(false);
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
        setAssistantSpeaking(false);
      }
    };
    assistantSpeakingRef.current = true;
    setAssistantSpeaking(true);
  }, []);

  /** One block of microphone audio: update the noise estimate, decide
   *  whether this is speech, and cut the assistant off if it is. */
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

      if (voiceBlocksRef.current >= VAD_BLOCKS_TO_TRIGGER) {
        setYouSpeaking(true);
        // Barge-in: stop locally and now, rather than waiting for the
        // server's interruption event a round trip later.
        if (assistantSpeakingRef.current) stopPlayback();
      } else if (!isVoice) {
        setYouSpeaking(false);
      }

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
          // returning through the microphone and triggering barge-in
          // against itself on laptop speakers.
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
        // whose output reaches nothing, stopping the microphone with no
        // error at all.
        const mute = micContext.createGain();
        mute.gain.value = 0;
        capture.connect(mute).connect(micContext.destination);
      };

      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          playChunk(event.data);
          return;
        }
        const msg = JSON.parse(event.data as string) as { type: string; text?: string; message?: string };
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
    try {
      socketRef.current?.send(JSON.stringify({ type: 'close' }));
    } catch {
      /* the socket may already be gone */
    }
    teardown();
    setStatus('idle');
  }, [teardown]);

  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || socketRef.current?.readyState !== WebSocket.OPEN) return;
      socketRef.current.send(JSON.stringify({ type: 'text', text: trimmed }));
      appendTurn('you', trimmed);
    },
    [appendTurn],
  );

  return {
    status, error, turns, level, youSpeaking, assistantSpeaking, insecure,
    micPermission,
    start, stop, sendText,
    reset: () => { setTurns([]); setError(''); },
  };
}
