/**
 * Ad spend beside the leads it bought, for the owner dashboard.
 *
 * Spend is typed in per month and per source in Settings → Reports
 * (report_settings.manualSpend). Leads and wins are the Reports engine's
 * own per-source counts for the same month (summary.bySource), so this
 * table never invents a second "lead" or "won".
 */
import { prisma } from '@/lib/db'
import { parseReportSettings, type ManualSpend } from '@/lib/reports/settings'
import type { Count } from '@/lib/reports/summary'

/** The spend typed in Settings → Reports, checked by the same parser Reports uses. */
export async function loadManualSpend(accountId: string): Promise<ManualSpend[]> {
  const row = await prisma.leadSettings.findUnique({ where: { account_id: accountId }, select: { report_settings: true } })
  return parseReportSettings(row?.report_settings).manualSpend
}

export interface SpendRow {
  /** The lead source key as stored, or the spend row's own name when no lead matched it. */
  source: string
  currency: string | null
  /** Null: no spend was entered for this source this month. */
  spend: number | null
  leads: number
  won: number
  /** Null when there is no spend, or nothing to divide by. */
  costPerLead: number | null
  costPerWin: number | null
}

/** "Walk in", "walk_in" and "WALK-IN" are one source. */
export function sourceKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function spendTable(
  bySource: Array<{ source: string } & Count>,
  manualSpend: ManualSpend[],
  month: string,
): SpendRow[] {
  const leadsByKey = new Map<string, { source: string; leads: number; won: number }>()
  for (const r of bySource) {
    const k = sourceKey(r.source || '')
    const had = leadsByKey.get(k)
    if (had) { had.leads += r.total; had.won += r.won }
    else leadsByKey.set(k, { source: r.source, leads: r.total, won: r.won })
  }

  // Spend for this month, added per source and currency (never across currencies).
  const spent = new Map<string, { key: string; name: string; currency: string; amount: number }>()
  for (const s of manualSpend) {
    if (s.month !== month) continue
    const key = sourceKey(s.source)
    if (!key) continue
    const id = `${key}|${s.currency}`
    const had = spent.get(id)
    if (had) had.amount = round2(had.amount + s.amount)
    else spent.set(id, { key, name: s.source, currency: s.currency, amount: s.amount })
  }

  const rows: SpendRow[] = []
  const withSpend = new Set<string>()
  for (const s of spent.values()) {
    withSpend.add(s.key)
    const l = leadsByKey.get(s.key)
    const leads = l?.leads ?? 0
    const won = l?.won ?? 0
    rows.push({
      source: l?.source ?? s.name,
      currency: s.currency,
      spend: s.amount,
      leads,
      won,
      costPerLead: leads > 0 ? round2(s.amount / leads) : null,
      costPerWin: won > 0 ? round2(s.amount / won) : null,
    })
  }
  for (const [key, l] of leadsByKey) {
    if (withSpend.has(key) || l.leads === 0) continue
    rows.push({ source: l.source, currency: null, spend: null, leads: l.leads, won: l.won, costPerLead: null, costPerWin: null })
  }

  return rows.sort((a, b) => {
    if (a.spend !== null && b.spend !== null) return b.spend - a.spend
    if (a.spend !== null) return -1
    if (b.spend !== null) return 1
    return b.leads - a.leads
  })
}
