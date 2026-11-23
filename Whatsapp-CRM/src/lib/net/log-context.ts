/**
 * A short id for each HTTP request, so the log lines one request wrote can
 * be read together (server.ts runs every request inside it; the error
 * capture in errors/record.ts prefixes it). Separate from the audit log's
 * x-request-id, which the proxy makes itself and never takes from outside.
 * No next/server import: server.ts loads this.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'

const store = new AsyncLocalStorage<{ rid: string }>()

export function runWithRequestId<T>(fn: () => T): T {
  return store.run({ rid: randomBytes(4).toString('hex') }, fn)
}

/** The current request's id, or '' outside a request (jobs, start-up). */
export function currentRequestId(): string {
  return store.getStore()?.rid ?? ''
}
