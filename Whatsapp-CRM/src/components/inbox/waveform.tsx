"use client";

/**
 * Voice bars, like WhatsApp's. Used live while recording (the newest
 * level enters on the right and the rest slide left) and in the preview
 * (the recording's own shape, filled in as it plays).
 *
 * Levels are 0–1. Fewer levels than bars are padded on the left with
 * resting bars, so a recording that has just started fills in from the
 * right instead of stretching a second of audio across the whole width.
 */

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(" ");
}

export function Waveform({
  levels,
  bars = 40,
  progress,
  className,
  activeClass = "bg-primary",
  idleClass = "bg-indigo-300/70",
}: {
  levels: number[];
  bars?: number;
  /** 0–1: bars before this point are drawn as played. Omit for live. */
  progress?: number;
  className?: string;
  activeClass?: string;
  idleClass?: string;
}) {
  const shown = levels.slice(-bars);
  const padded = [...Array(Math.max(0, bars - shown.length)).fill(0), ...shown];
  return (
    <div className={cn("flex h-full min-w-0 items-center gap-[2px]", className)} aria-hidden="true">
      {padded.map((level, i) => {
        const played = progress === undefined ? true : (i + 0.5) / bars <= progress;
        return (
          <span
            key={i}
            className={cn("min-w-[2px] flex-1 rounded-full transition-[height] duration-100", played ? activeClass : idleClass)}
            style={{ height: `${Math.round(Math.max(0.14, Math.min(1, level)) * 100)}%` }}
          />
        );
      })}
    </div>
  );
}

/**
 * The shape of a recording, for the preview: the loudest moment in each
 * of `bars` slices, scaled so the loudest slice fills the height.
 */
export async function peaksOf(url: string, bars = 40): Promise<number[]> {
  const bytes = await (await fetch(url)).arrayBuffer();
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(bytes);
    const data = audio.getChannelData(0);
    const size = Math.max(1, Math.floor(data.length / bars));
    const peaks: number[] = [];
    for (let b = 0; b < bars; b += 1) {
      let peak = 0;
      const end = Math.min(data.length, (b + 1) * size);
      for (let i = b * size; i < end; i += 1) {
        const v = Math.abs(data[i]);
        if (v > peak) peak = v;
      }
      peaks.push(peak);
    }
    const loudest = Math.max(...peaks, 0.0001);
    return peaks.map((p) => p / loudest);
  } finally {
    void context.close();
  }
}
