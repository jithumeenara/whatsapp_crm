/**
 * One writer at a time per spreadsheet tab, inside this server.
 *
 * Two customers finishing a chatbot at the same moment both read the
 * sheet, both decide "not there yet", both add — a duplicate. Or both
 * find "row 7" and one deletes it while the other writes to what is now
 * a different row. Queuing the read-decide-write for one tab behind the
 * previous one removes both. The app runs as one process (pm2, one
 * instance); a second process would also be safe for writes because
 * every write re-reads and re-checks its rows first (sheet-rows.ts
 * relocate), only the "add if missing" check could then double up.
 */

const tails = new Map<string, Promise<unknown>>()

export function sheetLockKey(spreadsheetId: string, tab: string): string {
  return `${spreadsheetId}\u0000${tab.trim().toLowerCase()}`
}

export async function withSheetLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve()
  let release!: () => void
  const mine = new Promise<void>((r) => { release = r })
  const tail = prev.then(() => mine)
  tails.set(key, tail)
  try {
    await prev.catch(() => {})
    return await fn()
  } finally {
    release()
    if (tails.get(key) === tail) tails.delete(key)
  }
}
