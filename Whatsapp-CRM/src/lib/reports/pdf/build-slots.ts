/**
 * How many PDFs this process builds at once, shared by every report that
 * makes one. A build holds a CPU for seconds (a worst-case one took 4 s of
 * synchronous work in review), so a few at once would starve everything else
 * on a small server. A request that finds no free slot is asked to try again.
 *
 *   const release = tryAcquirePdfSlot()
 *   if (!release) return busy()
 *   try { ...build... } finally { release() }
 *
 * Per process, in memory: with several processes the limit applies to each.
 */
export const PDF_BUILD_SLOTS = 2

let active = 0

/** A function that gives the slot back (once; calling it again does nothing), or null when all are taken. */
export function tryAcquirePdfSlot(): (() => void) | null {
  if (active >= PDF_BUILD_SLOTS) return null
  active += 1
  let released = false
  return () => {
    if (released) return
    released = true
    active -= 1
  }
}
