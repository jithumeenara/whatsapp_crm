/**
 * The Spending report's arithmetic, apart from the database.
 *
 * The rules this holds:
 *  - Money in different currencies is never added. Every amount is kept per
 *    currency; a combined total exists only when each part can honestly be
 *    put in the business's currency, and what was left out is named.
 *  - What cannot be attributed to a person, channel or number is shown as
 *    "Not attributed" / "Not recorded", never guessed.
 *  - AI cost is an estimate in US dollars (token counts times a price list).
 *    It is converted to the business's currency only for rupees (at the
 *    stated rate) or dollars (as is); for any other currency it stays in
 *    dollars and is left out of the combined total.
 *  - An empty period is zeros and empty lists.
 *
 * Pure: rows in, report out. spending.ts reads the rows.
 */

export type Money = Record<string, number>

const round6 = (n: number) => Math.round(n * 1e6) / 1e6
const round4 = (n: number) => Math.round(n * 1e4) / 1e4

function add(m: Money, currency: string | null, amount: number): void {
  if (!currency) return
  m[currency] = round6((m[currency] ?? 0) + amount)
}

function addAll(into: Money, from: Money): void {
  for (const [c, a] of Object.entries(from)) add(into, c, a)
}

export interface SpendingRows {
  waCategory: Array<{ category: string | null; type: string | null; currency: string | null; n: number; amount: number; unpriced: number }>
  waNumber: Array<{ id: string | null; currency: string | null; n: number; amount: number }>
  waPerson: Array<{ userId: string | null; senderType: string | null; currency: string | null; n: number; amount: number }>
  waDay: Array<{ day: string; currency: string | null; amount: number }>
  /** Messages reported as sent but not yet delivered (not yet charged). */
  waPending: number
  aiFeature: Array<{ feature: string; calls: number; costUsd: number }>
  aiChannel: Array<{ channel: string | null; calls: number; costUsd: number }>
  aiPerson: Array<{ userId: string | null; calls: number; costUsd: number }>
  aiDay: Array<{ day: string; costUsd: number }>
  /** WhatsApp number id → its label. */
  numbers: Record<string, string>
  /** User id → name. */
  people: Record<string, string>
  /** User id → team. */
  teams: Record<string, string>
  ads: { connected: boolean; spend: number | null; currency: string | null; clicks: number; impressions: number; error: string | null }
  leads: number
  wonDeals: number
  businessCurrency: string
  usdRate: number
}

const CHANNEL_NAMES: Record<string, string> = {
  whatsapp: 'WhatsApp', instagram: 'Instagram', facebook: 'Facebook', telegram: 'Telegram',
  website: 'Website', sms: 'SMS', email: 'Email', rcs: 'RCS',
}

/** A channel's name as people write it: "WhatsApp", not "whatsapp". Anything
 *  else (including "Not attributed") is returned as it is. */
export function channelLabel(channel: string): string {
  return CHANNEL_NAMES[channel] ?? channel
}

const FORMER = 'Former member'
const NOT_ATTRIBUTED = 'Not attributed'
const NOT_RECORDED = 'Not recorded'

/** The amount to sort by: the business currency when present, else the largest. */
function sortKey(m: Money, business: string): number {
  if (business in m) return m[business]
  const v = Object.values(m)
  return v.length ? Math.max(...v) : 0
}

/** What a day's bar is drawn from: the business currency only. Another currency
 *  is never drawn as if it were this one (it used to be, as the largest value). */
export function dayAmount(m: Money, business: string): number {
  return m[business.toUpperCase()] ?? 0
}

export function assembleSpending(r: SpendingRows) {
  // Upper case, so a currency typed in lower case is not a different one.
  const business = r.businessCurrency.trim().toUpperCase()

  // ── WhatsApp ───────────────────────────────────────────────────────
  const waTotal: Money = {}
  let delivered = 0
  let free = 0
  let unpriced = 0
  const cat = new Map<string, { category: string | null; type: string | null; count: number; unpriced: number; amount: Money }>()
  for (const row of r.waCategory) {
    delivered += row.n
    unpriced += row.unpriced
    if ((row.type ?? '').startsWith('free') || row.category === 'referral_conversion') free += row.n
    add(waTotal, row.currency, row.amount)
    const key = `${row.category}|${row.type}`
    const c = cat.get(key) ?? { category: row.category, type: row.type, count: 0, unpriced: 0, amount: {} }
    c.count += row.n
    c.unpriced += row.unpriced
    add(c.amount, row.currency, row.amount)
    cat.set(key, c)
  }
  const byCategory = [...cat.values()].sort((a, b) => sortKey(b.amount, business) - sortKey(a.amount, business) || b.count - a.count)

  const num = new Map<string, { id: string | null; label: string; count: number; amount: Money }>()
  for (const row of r.waNumber) {
    const key = row.id ?? '∅'
    const label = row.id === null ? NOT_RECORDED : (r.numbers[row.id] ?? 'Removed number')
    const n = num.get(key) ?? { id: row.id, label, count: 0, amount: {} }
    n.count += row.n
    add(n.amount, row.currency, row.amount)
    num.set(key, n)
  }
  const byNumber = [...num.values()].sort((a, b) => sortKey(b.amount, business) - sortKey(a.amount, business) || b.count - a.count)

  type Kind = 'person' | 'bot' | 'system' | 'unknown'
  const per = new Map<string, { userId: string | null; name: string; kind: Kind; count: number; amount: Money }>()
  for (const row of r.waPerson) {
    let name: string
    let kind: Kind
    if (row.userId) {
      name = r.people[row.userId] ?? FORMER
      kind = 'person'
    } else if (row.senderType === 'bot') {
      name = 'AI assistant'
      kind = 'bot'
    } else if (row.senderType === 'system') {
      name = 'System'
      kind = 'system'
    } else {
      name = NOT_RECORDED
      kind = 'unknown'
    }
    const key = row.userId ?? `~${row.senderType ?? ''}`
    const p = per.get(key) ?? { userId: row.userId, name, kind, count: 0, amount: {} }
    p.count += row.n
    add(p.amount, row.currency, row.amount)
    per.set(key, p)
  }
  const waByPerson = [...per.values()].sort((a, b) => sortKey(b.amount, business) - sortKey(a.amount, business) || b.count - a.count)

  const days = new Map<string, { whatsapp: Money; aiUsd: number }>()
  const dayOf = (d: string) => days.get(d) ?? { whatsapp: {}, aiUsd: 0 }
  for (const row of r.waDay) {
    const d = dayOf(row.day)
    add(d.whatsapp, row.currency, row.amount)
    days.set(row.day, d)
  }

  // ── AI ─────────────────────────────────────────────────────────────
  const aiCalls = r.aiFeature.reduce((s, x) => s + x.calls, 0)
  const aiUsd = r.aiFeature.reduce((s, x) => s + x.costUsd, 0)
  const byFeature = [...r.aiFeature].sort((a, b) => b.costUsd - a.costUsd)

  const aiPersonRows = r.aiPerson
    .map((p) => ({
      userId: p.userId,
      name: p.userId ? (r.people[p.userId] ?? FORMER) : NOT_ATTRIBUTED,
      calls: p.calls,
      costUsd: p.costUsd,
    }))
    // Work done for nobody in particular goes last, whatever it cost.
    .sort((a, b) => Number(a.userId === null) - Number(b.userId === null) || b.costUsd - a.costUsd)
  const aiChannelRows = r.aiChannel
    .map((c) => ({ channel: c.channel ?? NOT_ATTRIBUTED, calls: c.calls, costUsd: c.costUsd, none: c.channel === null }))
    .sort((a, b) => Number(a.none) - Number(b.none) || b.costUsd - a.costUsd)
    .map((c) => ({ channel: c.channel, calls: c.calls, costUsd: c.costUsd }))
  const unattributedRow = r.aiPerson.find((p) => p.userId === null)

  for (const row of r.aiDay) {
    const d = dayOf(row.day)
    d.aiUsd = round6(d.aiUsd + row.costUsd)
    days.set(row.day, d)
  }

  let inBusinessCurrency: { currency: string; amount: number; rate: number } | null = null
  if (business === 'USD') inBusinessCurrency = { currency: 'USD', amount: round6(aiUsd), rate: 1 }
  else if (business === 'INR') inBusinessCurrency = { currency: 'INR', amount: round4(aiUsd * r.usdRate), rate: r.usdRate }

  // ── Teams ──────────────────────────────────────────────────────────
  const teams = new Map<string, { team: string; people: Set<string>; whatsapp: Money; aiUsd: number }>()
  const teamOf = (userId: string) => {
    const name = r.teams[userId] || 'No team'
    const t = teams.get(name) ?? { team: name, people: new Set<string>(), whatsapp: {}, aiUsd: 0 }
    teams.set(name, t)
    return t
  }
  for (const p of waByPerson) {
    if (!p.userId) continue
    const t = teamOf(p.userId)
    t.people.add(p.userId)
    addAll(t.whatsapp, p.amount)
  }
  for (const p of r.aiPerson) {
    if (!p.userId) continue
    const t = teamOf(p.userId)
    t.people.add(p.userId)
    t.aiUsd = round6(t.aiUsd + p.costUsd)
  }
  const byTeam = [...teams.values()]
    .map((t) => ({ team: t.team, people: t.people.size, whatsapp: t.whatsapp, aiUsd: t.aiUsd }))
    .sort((a, b) => Number(a.team === 'No team') - Number(b.team === 'No team') || sortKey(b.whatsapp, business) - sortKey(a.whatsapp, business))

  // ── Channels ───────────────────────────────────────────────────────
  const channels = new Map<string, { channel: string; messages: Money; aiUsd: number }>()
  const channelOf = (name: string) => {
    const c = channels.get(name) ?? { channel: name, messages: {}, aiUsd: 0 }
    channels.set(name, c)
    return c
  }
  if (delivered > 0) addAll(channelOf('whatsapp').messages, waTotal)
  for (const c of aiChannelRows) channelOf(c.channel).aiUsd = round6(channelOf(c.channel).aiUsd + c.costUsd)
  const byChannel = [...channels.values()].sort(
    (a, b) => Number(a.channel === NOT_ATTRIBUTED) - Number(b.channel === NOT_ATTRIBUTED) || a.channel.localeCompare(b.channel),
  )

  // ── Totals ─────────────────────────────────────────────────────────
  const perCurrency: Money = {}
  addAll(perCurrency, waTotal)
  if (r.ads.spend !== null && r.ads.currency) add(perCurrency, r.ads.currency, r.ads.spend)
  if (aiUsd > 0) add(perCurrency, 'USD', aiUsd)

  let combined = 0
  const left = new Map<string, string[]>() // currency → sources left out
  const leave = (currency: string, source: string) => left.set(currency, [...(left.get(currency) ?? []), source])
  for (const [currency, amount] of Object.entries(waTotal)) {
    if (currency === business) combined += amount
    else leave(currency, 'WhatsApp')
  }
  if (r.ads.spend !== null && r.ads.currency) {
    if (r.ads.currency === business) combined += r.ads.spend
    else leave(r.ads.currency, 'Meta Ads')
  }
  if (aiUsd > 0) {
    if (inBusinessCurrency) combined += inBusinessCurrency.amount
    else leave('USD', 'AI')
  }
  const excluded = [...left.entries()].map(
    ([currency, sources]) => `${currency} amounts (${sources.join(', ')}) are not included: a different currency from ${business}.`,
  )
  combined = round4(combined)

  const comparable = excluded.length === 0 && r.ads.error === null
  const costPerLead = comparable && r.leads > 0 && combined > 0 ? combined / r.leads : null
  const costPerWon = comparable && r.wonDeals > 0 && combined > 0 ? combined / r.wonDeals : null

  return {
    businessCurrency: business,
    whatsapp: {
      delivered,
      free,
      unpriced,
      pending: r.waPending,
      total: waTotal,
      byCategory,
      byNumber,
      byPerson: waByPerson,
    },
    ai: {
      calls: aiCalls,
      costUsd: round6(aiUsd),
      inBusinessCurrency,
      byFeature,
      byChannel: aiChannelRows,
      byPerson: aiPersonRows,
      unattributed: unattributedRow ? { calls: unattributedRow.calls, costUsd: unattributedRow.costUsd } : { calls: 0, costUsd: 0 },
    },
    ads: r.ads,
    byTeam,
    byChannel,
    byDay: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, whatsapp: v.whatsapp, aiUsd: v.aiUsd })),
    totals: { combinedCurrency: business, combined, excluded, perCurrency },
    outcomes: { leads: r.leads, wonDeals: r.wonDeals, costPerLead, costPerWon, currency: business },
  }
}

export type SpendingReport = ReturnType<typeof assembleSpending>
