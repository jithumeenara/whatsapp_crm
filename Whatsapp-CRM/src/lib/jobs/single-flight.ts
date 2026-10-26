/**
 * A background job that never runs twice at once: a tick that arrives
 * while the last run is still going (a slow Google or Meta call) is
 * skipped instead of starting a second copy that does the same work —
 * and sends the same message — again.
 */
export function singleFlight<T>(job: () => Promise<T>): () => Promise<T | undefined> {
  let running = false
  return async () => {
    if (running) return undefined
    running = true
    try {
      return await job()
    } finally {
      running = false
    }
  }
}
