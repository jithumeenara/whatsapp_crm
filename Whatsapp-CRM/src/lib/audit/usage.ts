/**
 * API-key and MCP calls, grouped per key per endpoint per method per hour
 * (review H5). One access.api_key_used event per group, with the count and
 * first/last time — never one per call. Counters live in memory and are
 * written hourly and when the process is about to exit; a crash loses at
 * most the current hour's counts. Safe for server.ts (no 'next/server').
 */

import { audit, type AuditSource } from './write'

interface Counter {
  accountId: string
  keyId: string
  endpoint: string
  method: string
  source: AuditSource
  count: number
  firstAt: Date
  lastAt: Date
  ips: Set<string>
}

const HOUR_MS = 60 * 60_000
const MAX_COUNTERS = 5000
const counters = new Map<string, Counter>()
let timer: ReturnType<typeof setInterval> | null = null

const UUID_SEG = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi
const NUM_SEG = /\/\d{3,}(?=\/|$)/g
const LONG_SEG = /\/[A-Za-z0-9_-]{24,}(?=\/|$)/g

/** /api/leads/<uuid>/notes → /api/leads/:id/notes, so groups stay few. */
export function normaliseEndpoint(path: string): string {
  const p = (path.split('?')[0] || '/').slice(0, 200)
  return p.replace(UUID_SEG, '/:id').replace(NUM_SEG, '/:n').replace(LONG_SEG, '/:token')
}

function hourOf(d: Date): string {
  return d.toISOString().slice(0, 13)
}

function pathOf(url: string): string {
  try {
    return new URL(url, 'http://local').pathname
  } catch {
    return url
  }
}

/** Counts one call. Never throws, never waits. */
export function recordApiKeyUse(args: {
  accountId: string
  keyId: string | null | undefined
  url: string
  method: string
  source?: AuditSource
  ip?: string | null
  now?: Date
}): void {
  try {
    if (!args.keyId) return
    const now = args.now ?? new Date()
    const endpoint = normaliseEndpoint(pathOf(args.url))
    const method = (args.method || 'GET').toUpperCase().slice(0, 10)
    const key = `${args.accountId}|${args.keyId}|${endpoint}|${method}|${hourOf(now)}`
    const c = counters.get(key)
    if (c) {
      c.count += 1
      c.lastAt = now
      if (args.ip && c.ips.size < 5) c.ips.add(args.ip)
      return
    }
    if (counters.size >= MAX_COUNTERS) void flushApiKeyUsage()
    counters.set(key, {
      accountId: args.accountId,
      keyId: args.keyId,
      endpoint,
      method,
      source: args.source ?? 'api',
      count: 1,
      firstAt: now,
      lastAt: now,
      ips: new Set(args.ip ? [args.ip] : []),
    })
    if (!timer) {
      timer = setInterval(() => void flushApiKeyUsage(), HOUR_MS)
      ;(timer as { unref?: () => void }).unref?.()
    }
  } catch (err) {
    console.error('[audit] api key usage not counted:', err instanceof Error ? err.message : err)
  }
}

/** Writes and clears every counter. */
export async function flushApiKeyUsage(): Promise<void> {
  const all = [...counters.values()]
  counters.clear()
  for (const c of all) {
    await audit(
      { accountId: c.accountId, actor: { type: 'api_key', id: c.keyId }, source: c.source, ip: [...c.ips][0] ?? null },
      {
        action: 'access.api_key_used',
        target: { type: 'endpoint', id: c.endpoint },
        meta: {
          key_id: c.keyId,
          endpoint: c.endpoint,
          method: c.method,
          count: c.count,
          first_at: c.firstAt.toISOString(),
          last_at: c.lastAt.toISOString(),
          ips: [...c.ips],
        },
      },
    ).catch(() => {})
  }
}

/** For tests. */
export function pendingApiKeyUsage(): Array<Omit<Counter, 'ips'> & { ips: string[] }> {
  return [...counters.values()].map((c) => ({ ...c, ips: [...c.ips] }))
}

process.once('beforeExit', () => void flushApiKeyUsage())
