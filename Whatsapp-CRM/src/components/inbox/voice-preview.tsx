"use client";

/**
 * A recorded voice message, before it is sent.
 *
 * Recording used to send the moment it stopped, so a cough, a wrong
 * word or a recording of the wrong thing went straight to the customer.
 * This sits where the message box was: play it back, jump around in it,
 * then send it or throw it away.
 *
 * The audio is a local blob URL — nothing is uploaded until Send.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play, Trash2 } from "lucide-react";

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(" ");
}

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function VoicePreview({
  url,
  fallbackSeconds,
  sending,
  progress,
  onDiscard,
}: {
  url: string;
  /** The recorder's own timing, shown until the audio reports its length
   *  (some browsers report Infinity for a fresh recording). */
  fallbackSeconds: number;
  sending: boolean;
  /** Upload percentage while sending. */
  progress: number | null;
  onDiscard: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(fallbackSeconds);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrent(audio.currentTime);
    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
    };
    const onEnd = () => {
      setPlaying(false);
      setCurrent(0);
    };
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("play", onPlay);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("play", onPlay);
    };
  }, [url]);

  // Stop playback when sending starts — the agent has moved on.
  useEffect(() => {
    if (sending) audioRef.current?.pause();
  }, [sending]);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  }

  function seekTo(seconds: number) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    audio.currentTime = Math.min(duration, Math.max(0, seconds));
    setCurrent(audio.currentTime);
  }

  // A click jumps to that point; the arrow keys step two seconds.
  function seekToPointer(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    seekTo(ratio * duration);
  }

  function seekByKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.key === "ArrowRight" ? 2 : e.key === "ArrowLeft" ? -2 : 0;
    if (!step) return;
    e.preventDefault();
    seekTo((audioRef.current?.currentTime ?? 0) + step);
  }

  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;

  return (
    <div className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl bg-indigo-50 px-2 ring-1 ring-indigo-500/20">
      <audio ref={audioRef} src={url} preload="metadata" />
      <button
        type="button"
        onClick={toggle}
        disabled={sending}
        aria-label={playing ? "Pause the recording" : "Play the recording"}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {playing ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />}
      </button>

      <div
        role="slider"
        tabIndex={0}
        aria-label="Position in the recording"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(current)}
        aria-valuetext={`${clock(current)} of ${clock(duration)}`}
        onClick={seekToPointer}
        onKeyDown={seekByKey}
        className="group relative h-6 min-w-0 flex-1 cursor-pointer outline-none"
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-indigo-200/70" />
        <div className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow ring-2 ring-white group-focus-visible:ring-indigo-300"
          style={{ left: `${pct}%` }}
        />
      </div>

      <span className="shrink-0 text-[12px] font-semibold tabular-nums text-indigo-900">
        {sending ? (
          <span className="inline-flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {progress !== null ? `${progress}%` : "Sending"}
          </span>
        ) : playing || current > 0 ? (
          `${clock(current)} / ${clock(duration)}`
        ) : (
          clock(duration)
        )}
      </span>

      <button
        type="button"
        onClick={onDiscard}
        disabled={sending}
        aria-label="Discard this recording"
        title="Discard this recording"
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-lg text-rose-500 transition-colors hover:bg-rose-100 hover:text-rose-700",
          sending && "opacity-40",
        )}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
