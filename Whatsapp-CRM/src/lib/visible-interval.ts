/**
 * setInterval that rests while the tab is hidden.
 *
 * Every open CRM tab polled the server several times a minute whether
 * anybody was looking or not. An agent with three tabs behind other
 * windows all day was most of the background load on a 2 GB server.
 * This skips ticks while the tab is hidden and runs once the moment it
 * is shown again, so what is on screen is fresh when somebody looks.
 *
 * Not for anything that has to reach a person in a background tab — an
 * alert that plays a sound, say. Those keep a plain setInterval.
 *
 * Returns the cleanup function.
 */
export function everyWhileVisible(fn: () => void, ms: number): () => void {
  const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'
  const timer = setInterval(() => {
    if (visible()) fn()
  }, ms)
  const onVisibility = () => {
    if (visible()) fn()
  }
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
