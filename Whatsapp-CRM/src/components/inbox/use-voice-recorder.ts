"use client";

/**
 * Recording a voice note in the composer.
 *
 * Two things here are decided by what WhatsApp and the browsers actually
 * accept, not by preference:
 *
 * 1. **The result has to be re-encoded.** MediaRecorder in Chrome
 *    produces `audio/webm; codecs=opus` and has no option to do
 *    otherwise — `isTypeSupported('audio/ogg; codecs=opus')` is false
 *    there. WhatsApp accepts aac, amr, mpeg, mp4 and ogg(opus), so the
 *    recording cannot be forwarded as it comes out. It is decoded and
 *    re-encoded to MP3 before sending.
 *
 * 2. **The encoder is the same pure-JS one the voice replies use.**
 *    ffmpeg is not installed on the production VPS, and this half runs
 *    in the browser anyway. lamejs runs in both. MP3 over Opus is the
 *    same trade already made in src/lib/ai/tts.ts: Opus would render as
 *    a true voice-note waveform, but encoding it in pure JS is far
 *    heavier, and an MP3 arrives as a playable audio message.
 *
 * Everything is normalised through an OfflineAudioContext to mono at
 * 44.1 kHz first. Browsers capture at whatever rate the device gives
 * them — 48 kHz on most desktops, other rates on phones — and MP3 only
 * admits a fixed set of sample rates, so normalising once here is
 * cheaper than discovering the bad ones in the field.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { diagnoseMicFailure } from "@/components/settings/ai/use-live-voice";

/** MP3 wants one of a fixed set of rates; 44.1 kHz is universally safe. */
const TARGET_SAMPLE_RATE = 44100;
/** Plenty for a voice note, and keeps the upload small. */
const MP3_BITRATE_KBPS = 96;
/** One MPEG frame. lamejs expects to be fed in these. */
const SAMPLES_PER_FRAME = 1152;

/** Below this, a press is a stray click rather than an attempt to talk. */
export const MIN_RECORDING_MS = 700;

export type RecorderStatus = "idle" | "recording" | "encoding";

type Mp3EncoderCtor = new (channels: number, sampleRate: number, kbps: number) => {
  encodeBuffer(left: Int16Array): Uint8Array;
  flush(): Uint8Array;
};

let encoderPromise: Promise<Mp3EncoderCtor> | null = null;

/**
 * Loaded through a dynamic import for the same packaging reason
 * documented in src/lib/ai/tts.ts: the package's `require` condition
 * resolves to an IIFE bundle that exports an empty object, so anything
 * reaching it through CommonJS gets `{}` and fails with "Mp3Encoder is
 * not a constructor". A dynamic import always takes the `import`
 * condition. Lazily, too — it is a ~260 KB bundle that most agents in
 * the inbox will never need.
 */
function loadMp3Encoder(): Promise<Mp3EncoderCtor> {
  encoderPromise ??= import("@breezystack/lamejs").then((mod) => {
    const ns = mod as unknown as {
      Mp3Encoder?: Mp3EncoderCtor;
      default?: { Mp3Encoder?: Mp3EncoderCtor };
    };
    const ctor = typeof ns.Mp3Encoder === "function" ? ns.Mp3Encoder : ns.default?.Mp3Encoder;
    if (typeof ctor !== "function") {
      // Cleared so a later attempt can retry rather than being poisoned
      // by one bad load.
      encoderPromise = null;
      throw new Error("The audio encoder could not be loaded, so the recording cannot be sent.");
    }
    return ctor;
  });
  return encoderPromise;
}

async function encodeToMp3(recorded: Blob): Promise<File> {
  const bytes = await recorded.arrayBuffer();

  const decodeContext = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeContext.decodeAudioData(bytes);
  } finally {
    void decodeContext.close();
  }

  // Mono at a rate MP3 accepts, whatever the device captured at.
  const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();

  const samples = rendered.getChannelData(0);
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    // Clamped before scaling: a sample slightly outside [-1, 1] (which
    // the render can produce) would otherwise wrap around to full-scale
    // noise of the opposite sign.
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const Encoder = await loadMp3Encoder();
  const encoder = new Encoder(1, TARGET_SAMPLE_RATE, MP3_BITRATE_KBPS);
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < pcm.length; offset += SAMPLES_PER_FRAME) {
    const frame = pcm.subarray(offset, offset + SAMPLES_PER_FRAME);
    const encoded = encoder.encodeBuffer(frame);
    if (encoded.length > 0) chunks.push(encoded);
  }
  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(tail);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return new File(chunks as BlobPart[], `voice-${stamp}.mp3`, { type: "audio/mpeg" });
}

interface UseVoiceRecorderArgs {
  /** Called with the finished recording, ready to upload. */
  onComplete: (file: File, durationMs: number) => void;
  onError: (message: string) => void;
}

export function useVoiceRecorder({ onComplete, onError }: UseVoiceRecorderArgs) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [locked, setLocked] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Set before stopping so the recorder's own stop handler knows whether
  // to send the audio or throw it away. The handler fires asynchronously,
  // well after the click that decided it.
  const discardRef = useRef(false);

  const teardown = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  // A recording left running when the thread is closed would hold the
  // microphone open — and leave the browser's recording indicator lit
  // with nothing on screen explaining it.
  useEffect(() => teardown, [teardown]);

  const start = useCallback(async () => {
    if (status !== "idle") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      chunksRef.current = [];
      discardRef.current = false;

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const durationMs = Date.now() - startedAtRef.current;
        const parts = chunksRef.current;
        chunksRef.current = [];
        teardown();
        setLocked(false);
        setElapsedMs(0);

        if (discardRef.current || parts.length === 0) {
          setStatus("idle");
          return;
        }
        if (durationMs < MIN_RECORDING_MS) {
          setStatus("idle");
          onError("Hold the mic to record, or double-click it to keep recording hands-free.");
          return;
        }

        setStatus("encoding");
        void encodeToMp3(new Blob(parts, { type: parts[0]?.type || "audio/webm" }))
          .then((file) => onComplete(file, durationMs))
          .catch((err) =>
            onError(err instanceof Error ? err.message : "The recording could not be prepared."),
          )
          .finally(() => setStatus("idle"));
      };

      startedAtRef.current = Date.now();
      recorder.start();
      setStatus("recording");
      setElapsedMs(0);
      tickRef.current = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 200);
    } catch (err) {
      teardown();
      setStatus("idle");
      // Reuses the diagnosis written for the live-voice panel. The
      // failures are identical, and the one that matters most — the
      // app's own Permissions-Policy header — looks exactly like a
      // refused browser prompt and is invisible in every browser and
      // OS setting.
      onError(await diagnoseMicFailure(err));
    }
  }, [status, teardown, onComplete, onError]);

  /** Stop and keep what was recorded. */
  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      discardRef.current = false;
      recorderRef.current.stop();
    }
  }, []);

  /** Stop and throw it away. */
  const cancel = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      discardRef.current = true;
      recorderRef.current.stop();
    }
  }, []);

  /** Keep recording after the finger comes off the button. */
  const lock = useCallback(() => setLocked(true), []);

  return { status, locked, elapsedMs, start, stop, cancel, lock };
}

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
