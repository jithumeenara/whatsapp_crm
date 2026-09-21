'use client'

/**
 * A sound for the one alert worth interrupting somebody for.
 *
 * ── The trap this exists to avoid ───────────────────────────────────
 *
 * Every browser since about 2018 refuses to play audio on a page the
 * person has not interacted with. An agent who opens the CRM and starts
 * reading gets no sound at all — and no error either. The call to
 * play() rejects quietly, the code carries on, and the agent concludes
 * there were no customers.
 *
 * A silent failure that looks like good news is the worst kind. So this
 * does two things: it unlocks audio on the first click or keypress,
 * which is all the browser is waiting for, and it reports whether it is
 * actually armed so the screen can say "click anywhere to enable sound"
 * rather than leaving somebody to find out the hard way.
 *
 * ── Why the tone is generated rather than a file ────────────────────
 *
 * No asset to ship, cache or lose, and it can be made deliberately
 * mild. This is a working tool an agent sits in front of all day; the
 * sound has to be noticeable once and forgettable afterwards, which is
 * a different thing from an alarm.
 */

type Listener = (armed: boolean) => void

let ctx: AudioContext | null = null
let armed = false
const listeners = new Set<Listener>()

function notify() {
  for (const l of listeners) l(armed)
}

/** Subscribe to whether sound will actually play. Returns an
 *  unsubscribe. */
export function onArmedChange(listener: Listener): () => void {
  listeners.add(listener)
  listener(armed)
  return () => listeners.delete(listener)
}

export function isArmed(): boolean {
  return armed
}

/**
 * Start listening for the gesture the browser is waiting for.
 *
 * Idempotent, and it removes its own listeners the moment it succeeds —
 * there is nothing to keep watching for once audio works.
 */
export function armOnFirstGesture(): void {
  if (typeof window === 'undefined' || armed) return

  const unlock = async () => {
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      ctx = ctx ?? new Ctor()
      // Created suspended when there has been no gesture; resume() is
      // what the gesture buys.
      await ctx.resume()
      if (ctx.state === 'running') {
        armed = true
        notify()
        for (const evt of GESTURES) window.removeEventListener(evt, unlock)
      }
    } catch {
      // A browser with no Web Audio at all. The visual alert still
      // works, and the screen will keep saying sound is off — which is
      // true.
    }
  }

  for (const evt of GESTURES) window.addEventListener(evt, unlock, { passive: true })
}

const GESTURES = ['pointerdown', 'keydown', 'touchstart'] as const

/**
 * Two short notes, rising.
 *
 * Rising rather than falling because a falling pair reads as something
 * finishing, and this is something starting. Short and quiet on
 * purpose: it plays while an agent is mid-sentence with another
 * customer, and an alert that makes somebody lose their place is one
 * they will find a way to switch off.
 *
 * Silent if audio was never unlocked. The caller does not have to
 * check — it asks the screen to say so instead.
 */
export function playAlert(): void {
  if (!armed || !ctx) return
  try {
    const now = ctx.currentTime
    for (const [i, freq] of [660, 880].entries()) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = now + i * 0.16
      // An envelope rather than a square start and stop, which clicks.
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.12, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.14)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.16)
    }
  } catch {
    // Never worth surfacing: the visual alert is the one that matters
    // and it has already happened.
  }
}
