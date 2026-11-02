/**
 * Audit housekeeping run by server.ts: a boot event (so a period with the
 * log switched off shows as a gap with a reason), partitions kept three
 * months ahead with an alarm on the default partition, and replay of any
 * events that had to wait in the fallback file. Never sends anything.
 */

import { audit, auditEnabled } from './write'
import { systemCtx } from './context'
import { maintainAuditPartitions } from './verify'
import { replayAuditFallback } from './fallback'

async function partitionsOnce(): Promise<void> {
  const { defaultRows } = await maintainAuditPartitions()
  if (defaultRows > 0) {
    console.error(`[audit] ${defaultRows} event(s) are in the default partition — a month's partition was missing`)
    await audit(systemCtx(null, 'audit-partitions'), { action: 'system.default_partition_used', outcome: 'failure', meta: { rows: defaultRows } })
  }
}

export function startAuditHousekeeping(version: string | null): void {
  const run = (label: string, fn: () => Promise<unknown>) => fn().catch((err) => console.error(`[audit] ${label} failed:`, err instanceof Error ? err.message : err))
  void run('start', async () => {
    await partitionsOnce()
    // Recorded even when switched off would be ideal, but off means off:
    // the boot event of the next "on" start says when it came back.
    if (auditEnabled()) {
      await audit(systemCtx(null, 'server'), { action: 'system.boot', meta: { audit: 'on', version, node: process.version } })
    } else {
      console.warn('[audit] AUDIT_LOG=off — no audit events are being recorded')
    }
    await replayAuditFallback()
  })
  setInterval(() => void run('partitions', partitionsOnce), 24 * 60 * 60_000).unref()
  setInterval(() => void run('replay', replayAuditFallback), 10 * 60_000).unref()
}
