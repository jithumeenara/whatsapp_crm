'use client';

/**
 * The voice conversation, given the whole screen.
 *
 * A sidebar card is the wrong shape for talking to something. While you
 * are speaking you are not reading — you want one clear signal of who
 * has the floor and whether you are being heard, and nothing else
 * competing for attention. So this takes over the view, shows exactly
 * three things (state, your own level, the transcript), and hands the
 * transcript back to the chat when you finish.
 *
 * The orb is drawn on a canvas rather than assembled from divs: it
 * reacts to the microphone every frame, and a few hundred animated DOM
 * nodes to do that would cost more than the conversation does. It is
 * also the honest signal in the room — it grows with your actual voice,
 * so a dead microphone looks dead instead of looking idle.
 */

import { useEffect, useRef, useState } from 'react';
import { Mic, X, Check, Loader2, AlertTriangle, Radio, RotateCcw } from 'lucide-react';
import { AiNotice } from './ui-kit';

export type VoiceTurn = { who: 'you' | 'assistant'; text: string };

export interface VoiceChatModalProps {
  open: boolean;
  onClose: () => void;
  /** Called with the transcript when the conversation is kept. */
  onKeep: (turns: VoiceTurn[]) => void;

  status: 'idle' | 'connecting' | 'live' | 'error';
  error: string;
  turns: VoiceTurn[];
  /** 0-1, smoothed microphone level. */
  level: number;
  youSpeaking: boolean;
  assistantSpeaking: boolean;

  onStart: () => void;
  onStop: () => void;
}

export function VoiceChatModal(props: VoiceChatModalProps) {
  const { open, status, level, youSpeaking, assistantSpeaking } = props;
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const live = status === 'live';

  /* Escape closes, and the body must not scroll behind the overlay. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, props]);

  /* Call timer. Counts the conversation, not the time the sheet has been
     open — a minute spent looking at a connection error is not a call.
     The start time lives in a ref and the displayed value is derived, so
     nothing sets state from the effect body itself. */
  useEffect(() => {
    if (!live) {
      startedAtRef.current = null;
      return;
    }
    startedAtRef.current = Date.now();
    const id = setInterval(() => {
      const from = startedAtRef.current;
      if (from) setElapsed(Math.floor((Date.now() - from) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, [live]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [props.turns]);

  /* The orb. */
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    let frame = 0;
    // Smoothed separately from the prop so the orb keeps moving between
    // React renders rather than stepping.
    let shown = 0;

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const size = canvas.clientWidth;
      if (canvas.width !== size * dpr) {
        canvas.width = size * dpr;
        canvas.height = size * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      const target = youSpeaking ? Math.max(0.35, level) : assistantSpeaking ? 0.5 : level * 0.6;
      shown += (target - shown) * 0.12;
      frame += reduceMotion ? 0 : 1;

      const centre = size / 2;
      const base = size * 0.3;
      // Dots on concentric rings: dense enough to read as a sphere,
      // sparse enough that the whole thing costs well under a millisecond.
      const rings = 11;
      for (let ring = 1; ring <= rings; ring++) {
        const t = ring / rings;
        const wobble = reduceMotion ? 0 : Math.sin(frame * 0.02 + ring * 0.55) * base * 0.045;
        const radius = base * t + wobble + base * 0.32 * shown * t;
        const count = Math.max(6, Math.round(t * 46));
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2 + (reduceMotion ? 0 : frame * 0.0016 * (ring % 2 ? 1 : -1));
          const x = centre + Math.cos(angle) * radius;
          const y = centre + Math.sin(angle) * radius * 0.92;

          // Hue follows who is talking: cool while it thinks and speaks,
          // warmer as your own voice comes in.
          const hue = assistantSpeaking ? 236 - t * 40 : 268 - t * 70 - shown * 40;
          const alpha = (0.16 + t * 0.4) * (0.55 + shown * 0.6);
          ctx.beginPath();
          ctx.arc(x, y, Math.max(0.8, size * 0.0055 * (1.4 - t * 0.5)), 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${hue}, 78%, ${58 + t * 12}%, ${Math.min(0.9, alpha)})`;
          ctx.fill();
        }
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [open, level, youSpeaking, assistantSpeaking]);

  if (!open) return null;

  const statusLine =
    status === 'connecting'
      ? 'Connecting…'
      : status === 'error'
        ? 'Could not start'
        : youSpeaking
          ? 'Listening…'
          : assistantSpeaking
            ? 'Speaking…'
            : live
              ? 'Go ahead — say something'
              : 'Ready when you are';

  // Derived rather than reset: a stale number from the previous call
  // must not flash up when the sheet is reopened.
  const seconds = live ? elapsed : 0;
  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Voice chat"
    >
      <div className="relative flex h-full max-h-[760px] w-full max-w-[420px] flex-col overflow-hidden rounded-[28px] bg-gradient-to-b from-[#F4F2FB] via-[#F7F4F8] to-[#EFF3FB] shadow-[0_24px_70px_-20px_rgba(23,26,43,.45)] ring-1 ring-white/60">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5">
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Close voice chat"
            className="grid h-9 w-9 place-items-center rounded-full bg-white/80 text-slate-600 ring-1 ring-slate-900/5 transition-colors hover:bg-white"
          >
            <X className="h-4 w-4" />
          </button>
          <p className="text-[15px] font-semibold text-slate-800">Voice Chat</p>
          <span
            className={[
              'grid h-9 w-9 place-items-center rounded-full ring-1 transition-colors',
              live ? 'bg-emerald-50 text-emerald-600 ring-emerald-600/15' : 'bg-white/80 text-slate-400 ring-slate-900/5',
            ].join(' ')}
            aria-hidden="true"
          >
            <Radio className="h-4 w-4" />
          </span>
        </div>

        {/* Status, then whichever of orb / error / transcript belongs
            here. This column scrolls; the controls below never move. */}
        <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6">
          <p className="mt-4 shrink-0 text-[13.5px] font-medium text-slate-500">{statusLine}</p>

          {props.error ? (
            // An error takes the orb's place rather than queueing under
            // it. When something is wrong, a decorative sphere is not
            // what this space is for — and stacking both is what pushed
            // the words under the microphone button.
            <div className="mt-4 w-full shrink-0 pb-2">
              <AiNotice tone="error" icon={<AlertTriangle className="h-4 w-4" />}>
                <span className="block whitespace-pre-line text-[12.5px] leading-relaxed">{props.error}</span>
              </AiNotice>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-2.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-xl bg-white text-[12.5px] font-semibold text-slate-700 ring-1 ring-slate-900/10 transition-colors hover:bg-slate-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reload the page
              </button>
            </div>
          ) : (
            <div className="relative mt-2 aspect-square w-full max-w-[210px] shrink-0">
              <canvas ref={canvasRef} className="h-full w-full" />
              {status === 'connecting' && (
                <span className="absolute inset-0 grid place-items-center">
                  <Loader2 className="h-6 w-6 animate-spin text-[#5B6CF9]" />
                </span>
              )}
            </div>
          )}

          {props.turns.length === 0 && !props.error ? (
            <p className="mt-2 max-w-[300px] shrink-0 text-center text-[18px] font-semibold leading-snug text-slate-400">
              Speak naturally as your AI bot{' '}
              <span className="text-slate-800">listens and responds instantly</span>
            </p>
          ) : props.turns.length > 0 ? (
            <div
              ref={transcriptRef}
              className="mt-3 w-full flex-1 space-y-2 overflow-y-auto rounded-2xl bg-white/70 p-3 ring-1 ring-white/80"
            >
              {props.turns.map((t, i) => (
                <p key={`${t.who}-${i}`} className="text-[12.5px] leading-relaxed">
                  <span className={t.who === 'you' ? 'font-semibold text-slate-700' : 'font-semibold text-[#4A5AE8]'}>
                    {t.who === 'you' ? 'You: ' : 'AI: '}
                  </span>
                  <span className="text-slate-600">{t.text}</span>
                </p>
              ))}
            </div>
          ) : null}
        </div>

        {/* Level bars */}
        <div className="flex h-9 shrink-0 items-center justify-center gap-1.5 px-6">
          {[0.45, 0.72, 1, 0.85, 0.6, 0.95, 0.7, 0.5].map((scale, i) => (
            <span
              key={i}
              className={[
                'w-1.5 rounded-full transition-[height,background-color] duration-100',
                youSpeaking ? 'bg-emerald-500' : assistantSpeaking ? 'bg-[#5B6CF9]' : 'bg-slate-300',
              ].join(' ')}
              style={{
                height: `${Math.max(6, Math.round((live ? level : 0) * 34 * scale + 6))}px`,
              }}
            />
          ))}
        </div>

        {/* Controls. Opaque and above the scrolling column: the button
            floats, and anything allowed to scroll under it ends up
            printed through it. */}
        <div className="relative z-10 shrink-0 bg-gradient-to-t from-[#EFF3FB] via-[#EFF3FB] to-transparent px-6 pb-6 pt-3">
          <div className="relative flex items-center justify-center">
            <button
              type="button"
              onClick={() => (live || status === 'connecting' ? props.onStop() : props.onStart())}
              aria-label={live ? 'End the conversation' : 'Start talking'}
              className={[
                'grid h-[68px] w-[68px] place-items-center rounded-full text-white transition-transform motion-safe:active:scale-95',
                live
                  ? 'bg-gradient-to-b from-[#FF6B5A] to-[#E8453A] shadow-[0_10px_26px_-8px_rgba(232,69,58,.75)]'
                  : 'bg-gradient-to-b from-[#6B7BFF] to-[#4A5AE8] shadow-[0_10px_26px_-8px_rgba(74,90,232,.75)]',
              ].join(' ')}
            >
              {status === 'connecting' ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <Mic className="h-6 w-6" />
              )}
              {live && (
                <span className="absolute h-[68px] w-[68px] rounded-full ring-2 ring-[#E8453A]/40 motion-safe:animate-ping" />
              )}
            </button>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={props.onClose}
              aria-label="Discard this conversation"
              className="grid h-11 w-11 place-items-center rounded-full bg-white text-slate-500 ring-1 ring-slate-900/5 transition-colors hover:text-rose-600"
            >
              <X className="h-4 w-4" />
            </button>

            <span className="font-mono text-[15px] tabular-nums text-slate-600">{mmss}</span>

            <button
              type="button"
              onClick={() => {
                props.onKeep(props.turns);
                props.onClose();
              }}
              disabled={props.turns.length === 0}
              aria-label="Keep this conversation in the chat"
              title="Add the transcript to the chat"
              className="grid h-11 w-11 place-items-center rounded-full bg-white text-slate-500 ring-1 ring-slate-900/5 transition-colors hover:text-emerald-600 disabled:opacity-40"
            >
              <Check className="h-4 w-4" />
            </button>
          </div>

          <p className="mt-3 text-center text-[10.5px] leading-relaxed text-slate-400">
            Interrupt any time — it stops as soon as it hears you. The tick keeps the transcript in the chat.
          </p>
        </div>
      </div>
    </div>
  );
}
