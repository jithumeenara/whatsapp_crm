"use client"

import { useEffect, useRef, useState } from "react"
import { prefersReducedMotion, valueAt } from "@/lib/count-up"

/**
 * A number that counts up to its value the first time a screen shows it.
 *
 * Only that first time: a refresh, or a change of period, shows the new
 * number at once, because a figure that counts up again every time it is
 * reloaded is slow, not smooth. For somebody who asked their device for less
 * motion it is never animated at all. A requestAnimationFrame loop, so it
 * costs nothing while the tab is hidden, and it is cancelled when the screen
 * goes away or the value changes mid-way.
 */
export function useCountUp(target: number, durationMs = 600): number {
  const [shown, setShown] = useState(0)
  const animated = useRef(false)

  useEffect(() => {
    const instant = animated.current || prefersReducedMotion(window)
    animated.current = true
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const progress = instant ? 1 : (now - start) / durationMs
      setShown(valueAt(0, target, progress))
      if (progress < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs])

  return shown
}
