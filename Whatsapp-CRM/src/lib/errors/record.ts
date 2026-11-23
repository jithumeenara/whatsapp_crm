/**
 * Errors somebody can see (migration 195, app_errors).
 *
 * The app logs about six hundred kinds of failure with console.error, and
 * all of it went to the pm2 log, which nobody reads; a browser error went
 * nowhere. installErrorCapture() (server.ts) copies every console.error
 * into app_errors as well — one row per distinct error with a repeat
 * count — and /api/client-errors does the same for the browser. The
 * alert sweep (alert-sweep.ts) tells somebody when a new error repeats.
 *
 * Three rules:
 *   - It never breaks what it watches: every write is swallowed, and its
 *     own failures go to the original console.error, never back through
 *     the capture (no loop).
 *   - It never stores a secret: messages pass redactSecrets first.
 *   - It never floods the database: one write per error per 30 s (repeats
 *     in between are added to the next write) and at most 120 writes a
 *     minute for the whole process.
 *
 * No next/server import: server.ts loads this (see memory
 * server-ts-cannot-import-next-server).
 */

import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { normaliseForFingerprint, redactSecrets } from './redact'
import { currentRequestId } from '@/lib/net/log-context'

export type ErrorSource = 'server' | 'browser'

export interface AppErrorInput {
  source: ErrorSource
  /** A short place: a log tag like "[auto-reply]", a route, a page path. */
  where: string
  message: string
  accountId?: string | null
}

const PER_ERROR_MS = 30_000
const MAX_WRITES_PER_MIN = 120

const pending = new Map<string, { input: AppErrorInput; message: string; where: string; extra: number; lastWrite: number }>()
const MAX_BROWSER_WRITES_PER_MIN = 30
let windowStart = 0
let writesThisWindow = 0
let browserWritesThisWindow = 0
let originalError: (...args: unknown[]) => void = console.error.bind(console)

export function fingerprintOf(source: ErrorSource, where: string, message: string, accountId?: string | null): string {
  return createHash('sha1').update(`${source}|${accountId ?? ''}|${where}|${normaliseForFingerprint(message)}`).digest('hex')
}

function clean(where: string, message: string): { where: string; message: string } {
  return {
    where: redactSecrets(where).replace(/[\r\n\t]+/g, ' ').slice(0, 200),
    message: redactSecrets(message).replace(/\s+/g, ' ').trim().slice(0, 500) || '(no message)',
  }
}

/** Records one occurrence. Never throws, never awaits the database for the caller. */
export function recordAppError(input: AppErrorInput, now: number = Date.now()): void {
  try {
    const { where, message } = clean(input.where, input.message)
    const fp = fingerprintOf(input.source, where, message, input.accountId)
    const seen = pending.get(fp)
    if (seen && now - seen.lastWrite < PER_ERROR_MS) {
      seen.extra += 1
      return
    }
    if (now - windowStart >= 60_000) { windowStart = now; writesThisWindow = 0; browserWritesThisWindow = 0 }
    // Browser reports come from signed-in staff and have their own, smaller
    // share, so a few people (or one person scripting the endpoint) cannot
    // crowd real server errors out of the minute's allowance.
    const overShare = input.source === 'browser' && browserWritesThisWindow >= MAX_BROWSER_WRITES_PER_MIN
    if (writesThisWindow >= MAX_WRITES_PER_MIN || overShare) {
      if (seen) seen.extra += 1
      return
    }
    writesThisWindow += 1
    if (input.source === 'browser') browserWritesThisWindow += 1
    const add = 1 + (seen?.extra ?? 0)
    pending.set(fp, { input, message, where, extra: 0, lastWrite: now })
    if (pending.size > 2000) pending.delete(pending.keys().next().value as string)
    void write(fp, input, where, message, add)
  } catch (err) {
    originalError('[app-errors] could not record:', err instanceof Error ? err.message : err)
  }
}

async function write(fp: string, input: AppErrorInput, where: string, message: string, add: number): Promise<void> {
  try {
    const accountId = input.accountId && /^[0-9a-f-]{36}$/i.test(input.accountId) ? input.accountId : null
    // A resolved error that comes back starts over, so it is alerted again.
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO app_errors (fingerprint, account_id, source, where_at, message, count)
      VALUES (${fp}, ${accountId}::uuid, ${input.source}, ${where}, ${message}, ${add}::int)
      ON CONFLICT (fingerprint) DO UPDATE SET
        count      = CASE WHEN app_errors.resolved_at IS NULL THEN app_errors.count + ${add}::int ELSE ${add}::int END,
        first_seen = CASE WHEN app_errors.resolved_at IS NULL THEN app_errors.first_seen ELSE now() END,
        alerted_at = CASE WHEN app_errors.resolved_at IS NULL THEN app_errors.alerted_at ELSE NULL END,
        resolved_at = NULL,
        message    = EXCLUDED.message,
        last_seen  = now()`)
  } catch (err) {
    // Straight to the original console: going through the capture again
    // would loop on a database that is down.
    originalError('[app-errors] write failed:', err instanceof Error ? err.message : err)
  }
}

/** Turns console.error's arguments into a place and a message. */
export function describeConsoleArgs(args: unknown[]): { where: string; message: string } {
  const parts: string[] = []
  let where = ''
  args.forEach((a, i) => {
    if (i === 0 && typeof a === 'string') {
      const tag = a.match(/^\s*(\[[^\]]{1,60}\])/)
      if (tag) where = tag[1]
    }
    if (a instanceof Error) {
      const firstFrame = (a.stack ?? '').split('\n').find((l) => l.trim().startsWith('at '))?.trim() ?? ''
      parts.push(`${a.name}: ${a.message}${firstFrame ? ` (${firstFrame.slice(0, 160)})` : ''}`)
    } else if (typeof a === 'string') {
      parts.push(a)
    } else {
      try { parts.push(JSON.stringify(a)?.slice(0, 300) ?? String(a)) } catch { parts.push(String(a)) }
    }
  })
  const message = parts.join(' ').slice(0, 2000)
  return { where: where || message.slice(0, 60), message }
}

let installed = false

/**
 * What the server log itself gets: strings and error stacks with secrets
 * removed (a Graph URL with its token, a request body with a password),
 * led by the request's short id when there is one, so one request's lines
 * can be read together. Objects are passed through untouched.
 */
export function safeLogArgs(args: unknown[], requestId: string): unknown[] {
  const out = args.map((a) => {
    if (typeof a === 'string') return redactSecrets(a)
    if (a instanceof Error) {
      const copy = new Error(redactSecrets(a.message), { cause: (a as { cause?: unknown }).cause })
      copy.name = a.name
      copy.stack = a.stack ? redactSecrets(a.stack) : undefined
      // Keep what debugging needs: an error code (P2002, ECONNRESET) and
      // Prisma's meta (which field), not the values.
      const extra = a as { code?: unknown; meta?: unknown }
      if (extra.code !== undefined) Object.assign(copy, { code: extra.code })
      if (extra.meta !== undefined) Object.assign(copy, { meta: extra.meta })
      return copy
    }
    return a
  })
  return requestId ? [`[rid:${requestId}]`, ...out] : out
}

/** server.ts calls this once. Every console.error is also recorded, and
 *  console.error / console.warn lines are redacted before they are written. */
export function installErrorCapture(): void {
  if (installed || process.env.VITEST) return
  installed = true
  originalError = console.error.bind(console)
  const originalWarn = console.warn.bind(console)
  console.error = (...args: unknown[]) => {
    try {
      originalError(...safeLogArgs(args, currentRequestId()))
    } catch {
      originalError(...args)
    }
    try {
      const { where, message } = describeConsoleArgs(args)
      recordAppError({ source: 'server', where, message })
    } catch {
      // never let the log itself fail
    }
  }
  console.warn = (...args: unknown[]) => {
    try {
      originalWarn(...safeLogArgs(args, currentRequestId()))
    } catch {
      originalWarn(...args)
    }
  }
}

/** For tests: forget throttling state. */
export function resetErrorCaptureForTests(): void {
  pending.clear()
  windowStart = 0
  writesThisWindow = 0
  browserWritesThisWindow = 0
}
