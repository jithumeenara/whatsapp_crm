'use client';

import { motion, useReducedMotion, type Transition } from 'motion/react';
import type { ReactNode } from 'react';

const EASE: Transition['ease'] = [0.16, 1, 0.3, 1]; // "ease-out-expo" — quick start, gentle settle

interface Props {
  children: ReactNode;
  /** Stagger delay in seconds — pass index * 0.03 from a list to cascade entries in. */
  delay?: number;
  /** Pixels to slide up from on entry. 0 = fade only, no movement. */
  y?: number;
  className?: string;
}

/**
 * The app's one shared entrance-animation primitive — a short fade
 * (+ optional small upward slide), used for panels, cards, and list rows
 * across the app instead of every screen hand-rolling its own.
 *
 * Performance: animates only `opacity`/`transform` — the two properties
 * the browser compositor can animate on the GPU without ever triggering
 * layout or paint, so this never costs a reflow no matter how many of
 * these are on screen at once.
 *
 * Accessibility: automatically skips the motion (renders instantly) for
 * anyone with `prefers-reduced-motion` set, via Motion's own hook — no
 * per-usage opt-out needed.
 */
export function FadeIn({ children, delay = 0, y = 8, className }: Props) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
