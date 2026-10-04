/**
 * The report engine: a sentence in, numbers out.
 *
 * Every report is one of four shapes asked of a moment
 * (src/lib/reports/moments.ts):
 *
 *   count    — how many times it happened
 *   sum      — how much of a number it carried (amount, talk time…)
 *   from_to  — of the customers it happened to, how many went on to a
 *              second moment, and how long that took
 *   again    — how many customers it happened to more than once
 *
 * optionally split "by" one detail of the moment, over a period, with up
 * to three "where detail is value" filters. A saved report is just this
 * spec as JSON; the engine is the only thing that turns it into SQL, from
 * constants plus bound parameters, inside a read with a statement
 * timeout. Results are aggregates only — no names, numbers or messages —
 * so what a report shows or exports cannot leak a customer.
 */

import { prisma } from '@/lib/db'
import { Params, findMoment, type MomentDef, type StoreTable } from './moments'
import { bucketFor, bucketStarts, resolvePeriod, type PeriodSpec, type ResolvedPeriod, PRESETS } from './period'

export const SHAPES = ['count', 'sum', 'from_to', 'again'] as const
export type Shape = (typeof SHAPES)[number]

/** "Where <detail> is any of these values". "(none)" stands for empty. */
export interface ReportFilter {
  prop: string
  values: string[]
}

export interface ReportSpec {
  v: 1
  shape: Shape
  moment: string
  /** from_to: the moment customers should reach. */
  to?: string
  /** sum: which number to add up. */
  value?: string
  by?: string | null
  period: PeriodSpec
  filters?: ReportFilter[]
  /** from_to: how long after the first moment the second still counts. */
  window_days?: number
  /** A time chart's step; chosen from the period's length when absent. */
  bucket?: 'day' | 'week' | 'month'
  /** How the report is shown. Saved with it; the engine ignores it. */
  display?: ReportDisplay
}

export const CHART_KINDS = ['auto', 'bar', 'line', 'area', 'pie', 'table'] as const
export interface ReportDisplay {
  chart?: (typeof CHART_KINDS)[number]
  compare?: boolean
  top?: 5 | 10 | 25
}

export interface GroupRow {
  key: string
  label: string
  value: number
  previous: number
}

export interface FunnelRow {
  key: string
  label: string
  started: number
  converted: number
  rate: number
  medianSeconds: number | null
}

export interface ReportResult {
  title: string
  shape: Shape
  periodLabel: string
  period: { from: string; toExclusive: string; prevFrom: string; prevToExclusive: string }
  unit: 'INR' | 'min' | null
  byLabel: string | null
  total: number
  previousTotal: number
  bucket?: 'day' | 'week' | 'month'
  series?: { t: string; value: number }[]
  /** The period before, step by step, for a comparison line. */
  previousSeries?: { t: string; value: number }[]
  groups?: GroupRow[]
  /** Everything outside the top groups, so the table still adds up. */
  other?: number
  funnel?: { all: FunnelRow; groups: FunnelRow[]; windowDays: number; toLabel: string }
  again?: { customers: number; returning: number; rate: number; distribution: { times: string; customers: number }[] }
}

export class ReportError extends Error {}

const MAX_GROUPS = 25
/** A year of days is the most a chart can usefully draw. */
const MAX_BUCKETS = 366
const DEFAULT_WINDOW = 90
const NONE = '(none)'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── Reading a spec ───────────────────────────────────────────────────

/** Shape-checks untrusted JSON into a spec, or says what is wrong. Whether
 *  the moments and details exist for this account is checkSpec's job. */
export function parseSpec(raw: unknown): ReportSpec {
  const r = (raw ?? {}) as Record<string, unknown>
  const str = (v: unknown, max = 120) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined)

  const shape = r.shape as Shape
  if (!SHAPES.includes(shape)) throw new ReportError('Choose what to measure: how many, how much, from → to, or again.')
  const moment = str(r.moment)
  if (!moment) throw new ReportError('Choose a moment.')

  const p = (r.period ?? {}) as Record<string, unknown>
  const period: PeriodSpec = {}
  if (typeof p.preset === 'string') {
    if (!PRESETS.includes(p.preset as (typeof PRESETS)[number])) throw new ReportError('Unknown period.')
    period.preset = p.preset as PeriodSpec['preset']
  }
  if (p.from !== undefined || p.to !== undefined) {
    period.from = str(p.from, 10)
    period.to = str(p.to, 10)
  }

  const filters: ReportFilter[] = []
  if (Array.isArray(r.filters)) {
    if (r.filters.length > 3) throw new ReportError('At most three filters.')
    for (const f of r.filters as Record<string, unknown>[]) {
      const prop = str(f?.prop)
      // `value` is how a report saved before multi-value filters says it.
      const raw: unknown[] = Array.isArray(f?.values) ? f.values : typeof f?.value === 'string' ? [f.value] : []
      if (!prop || raw.length === 0) throw new ReportError('A filter needs a detail and at least one value.')
      if (raw.length > 20) throw new ReportError('A filter can hold up to 20 values.')
      if (!raw.every((v) => typeof v === 'string' && v.length > 0 && v.length <= 200)) {
        throw new ReportError('A filter value must be text of up to 200 characters.')
      }
      filters.push({ prop, values: [...new Set(raw as string[])] })
    }
  }

  const bucket = r.bucket === undefined || r.bucket === null ? undefined : r.bucket
  if (bucket !== undefined && bucket !== 'day' && bucket !== 'week' && bucket !== 'month') {
    throw new ReportError('Show by day, week or month.')
  }

  const windowDays = r.window_days === undefined ? undefined : Number(r.window_days)
  if (windowDays !== undefined && (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 365)) {
    throw new ReportError('The follow-on window must be between 1 and 365 days.')
  }

  return {
    v: 1,
    shape,
    moment,
    to: str(r.to),
    value: str(r.value),
    by: str(r.by) ?? null,
    period,
    filters,
    window_days: windowDays,
    bucket,
    display: parseDisplay(r.display),
  }
}

function parseDisplay(raw: unknown): ReportDisplay | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const d = raw as Record<string, unknown>
  const out: ReportDisplay = {}
  if (CHART_KINDS.includes(d.chart as ReportDisplay['chart'] & string)) out.chart = d.chart as ReportDisplay['chart']
  if (typeof d.compare === 'boolean') out.compare = d.compare
  if (d.top === 5 || d.top === 10 || d.top === 25) out.top = d.top
  return out
}

interface Checked {
  spec: ReportSpec
  from: MomentDef
  to: MomentDef | null
  valueLabel: string | null
  unit: 'INR' | 'min' | null
  byLabel: string | null
  byIsAgent: boolean
}

export function checkSpec(spec: ReportSpec, store: StoreTable[]): Checked {
  const from = findMoment(spec.moment, store)
  if (!from) throw new ReportError('That moment does not exist for this account.')

  let to: MomentDef | null = null
  if (spec.shape === 'from_to') {
    if (!spec.to) throw new ReportError('Choose the moment customers should reach.')
    to = findMoment(spec.to, store)
    if (!to) throw new ReportError('That second moment does not exist for this account.')
    if (to.kind === from.kind) throw new ReportError('Choose two different moments.')
  }

  let valueLabel: string | null = null
  let unit: 'INR' | 'min' | null = null
  if (spec.shape === 'sum') {
    const v = from.values.find((x) => x.key === spec.value)
    if (!v) throw new ReportError(`"${from.label}" has no number to add up${spec.value ? ' by that name' : ''}.`)
    valueLabel = v.label
    unit = v.unit ?? null
  }

  let byLabel: string | null = null
  let byIsAgent = false
  if (spec.by) {
    const b = from.props.find((x) => x.key === spec.by)
    if (!b) throw new ReportError('That detail cannot split this moment.')
    byLabel = b.label
    byIsAgent = !!b.agent
  }
  for (const f of spec.filters ?? []) {
    if (!from.props.some((x) => x.key === f.prop)) throw new ReportError('A filter uses a detail this moment does not have.')
  }

  return { spec, from, to, valueLabel, unit, byLabel, byIsAgent }
}

// ── Saying it in words ───────────────────────────────────────────────

export function describe(c: Checked, periodLabel: string): string {
  const { spec, from, to, valueLabel, byLabel } = c
  const by = byLabel ? `, by ${byLabel.toLowerCase()}` : ''
  switch (spec.shape) {
    case 'count':
      return `How many ${from.noun}${by} — ${periodLabel}`
    case 'sum':
      return `Total ${valueLabel!.toLowerCase()} of ${from.noun}${by} — ${periodLabel}`
    case 'from_to':
      return `${capital(from.noun)} → ${to!.noun} within ${spec.window_days ?? DEFAULT_WINDOW} days${by} — ${periodLabel}`
    case 'again':
      return `Customers with more than one of ${from.noun} — ${periodLabel}`
  }
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ── Running it ───────────────────────────────────────────────────────

interface Ctx {
  accountId: string
  timezone: string
  store: StoreTable[]
}

export async function loadContext(accountId: string): Promise<Ctx> {
  const [profile, tables] = await Promise.all([
    prisma.companyProfile.findFirst({ where: { account_id: accountId }, select: { timezone: true } }),
    prisma.dataTable.findMany({
      where: { account_id: accountId },
      orderBy: { sort_order: 'asc' },
      select: {
        id: true,
        name: true,
        fields: { orderBy: { sort_order: 'asc' }, select: { field_key: true, label: true, field_type: true } },
      },
    }),
  ])
  return { accountId, timezone: validZone(profile?.timezone), store: tables }
}

function validZone(zone: string | null | undefined): string {
  const z = zone?.trim()
  if (!z) return 'Asia/Kolkata'
  try {
    new Intl.DateTimeFormat('en', { timeZone: z })
    return z
  } catch {
    return 'Asia/Kolkata'
  }
}

/** One moment's rows in a range, as at / contact_id / g / value. */
function source(
  def: MomentDef,
  p: Params,
  account: string,
  tz: string,
  fromDay: string,
  toDay: string,
  by: string | null | undefined,
  valueKey: string | undefined,
  filters: ReportFilter[],
): string {
  const s = def.sql(p, account)
  const g = by ? `coalesce(nullif(btrim((${s.prop[by]})::text), ''), '${NONE}')` : `'all'`
  const value = valueKey ? s.value[valueKey] : 'NULL::numeric'
  const where = [
    s.where,
    `${s.at} >= (${p.add(fromDay)}::date::timestamp AT TIME ZONE ${tz})`,
    `${s.at} < (${p.add(toDay)}::date::timestamp AT TIME ZONE ${tz})`,
  ]
  for (const f of filters) {
    const expr = `(${s.prop[f.prop]})::text`
    const named = f.values.filter((v) => v !== NONE)
    const parts: string[] = []
    if (named.length) parts.push(`btrim(${expr}) = ANY(${p.add(named)}::text[])`)
    if (named.length !== f.values.length) parts.push(`nullif(btrim(${expr}), '') IS NULL`)
    where.push(`(${parts.join(' OR ')})`)
  }
  return `SELECT ${s.at} AS at, ${s.contact} AS contact_id, ${g} AS g, (${value})::numeric AS value FROM ${s.from} WHERE ${where.join(' AND ')}`
}

type Row = Record<string, unknown>

/** Reports read only, and give up after 15 seconds rather than hold a
 *  connection the rest of the app needs. */
async function read(sql: string, params: unknown[]): Promise<Row[]> {
  return prisma.$transaction(
    async (tx) => {
      // READ ONLY has to come first: Postgres refuses it once the
      // transaction has run anything else.
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '15s'`)
      return tx.$queryRawUnsafe<Row[]>(sql, ...params)
    },
    // Prisma's own default would end the transaction at 5 seconds, before
    // the database's 15 had a chance to.
    { maxWait: 5_000, timeout: 20_000 },
  )
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

export async function runReport(ctx: Ctx, rawSpec: ReportSpec, now: Date = new Date()): Promise<ReportResult> {
  const c = checkSpec(rawSpec, ctx.store)
  const period = resolvePeriod(c.spec.period, ctx.timezone, now)
  if (!period) throw new ReportError('That period is not valid (custom ranges can be up to two years).')

  const base: ReportResult = {
    title: describe(c, period.label),
    shape: c.spec.shape,
    periodLabel: period.label,
    period: {
      from: period.from,
      toExclusive: period.toExclusive,
      prevFrom: period.prevFrom,
      prevToExclusive: period.prevToExclusive,
    },
    unit: c.unit,
    byLabel: c.byLabel,
    total: 0,
    previousTotal: 0,
  }

  switch (c.spec.shape) {
    case 'count':
    case 'sum':
      return withAgentNames(ctx, c, await runTotals(ctx, c, period, base))
    case 'from_to':
      return withAgentNames(ctx, c, await runFromTo(ctx, c, period, base))
    case 'again':
      return runAgain(ctx, c, period, base)
  }
}

async function runTotals(ctx: Ctx, c: Checked, period: ResolvedPeriod, base: ReportResult): Promise<ReportResult> {
  const agg = c.spec.shape === 'sum' ? 'coalesce(sum(s.value), 0)' : 'count(*)'
  const filters = c.spec.filters ?? []

  const total = async (fromDay: string, toDay: string) => {
    const p = new Params()
    const a = p.add(ctx.accountId)
    const tz = p.add(ctx.timezone)
    const src = source(c.from, p, a, tz, fromDay, toDay, null, c.spec.value, filters)
    const rows = await read(`SELECT ${agg} AS v FROM (${src}) s`, p.values)
    return num(rows[0]?.v)
  }

  const [current, previous] = await Promise.all([
    total(period.from, period.toExclusive),
    total(period.prevFrom, period.prevToExclusive),
  ])
  const result: ReportResult = { ...base, total: current, previousTotal: previous }

  if (!c.spec.by) {
    const bucket = c.spec.bucket ?? bucketFor(period.days)
    const series = async (fromDay: string, toDay: string) => {
      const p = new Params()
      const a = p.add(ctx.accountId)
      const tz = p.add(ctx.timezone)
      const src = source(c.from, p, a, tz, fromDay, toDay, null, c.spec.value, filters)
      // The bucket is one of three constants, never user text.
      const rows = await read(
        `SELECT to_char(date_trunc('${bucket}', s.at AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS t, ${agg} AS v FROM (${src}) s GROUP BY 1 ORDER BY 1`,
        p.values,
      )
      const byT = new Map(rows.map((r) => [String(r.t), num(r.v)]))
      return bucketStarts(fromDay, toDay, bucket).map((t) => ({ t, value: byT.get(t) ?? 0 }))
    }
    if (bucketStarts(period.from, period.toExclusive, bucket).length > MAX_BUCKETS) {
      throw new ReportError('Too many points to draw — show this period by week or month.')
    }
    const [now, before] = await Promise.all([
      series(period.from, period.toExclusive),
      series(period.prevFrom, period.prevToExclusive),
    ])
    result.bucket = bucket
    result.series = now
    result.previousSeries = before
    return result
  }

  const grouped = async (fromDay: string, toDay: string, limit: number) => {
    const p = new Params()
    const a = p.add(ctx.accountId)
    const tz = p.add(ctx.timezone)
    const src = source(c.from, p, a, tz, fromDay, toDay, c.spec.by, c.spec.value, filters)
    return read(`SELECT s.g AS g, ${agg} AS v FROM (${src}) s GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT ${limit}`, p.values)
  }
  const [now, before] = await Promise.all([
    grouped(period.from, period.toExclusive, MAX_GROUPS),
    grouped(period.prevFrom, period.prevToExclusive, 500),
  ])
  const prevBy = new Map(before.map((r) => [String(r.g), num(r.v)]))
  result.groups = now.map((r) => ({
    key: String(r.g),
    label: String(r.g),
    value: num(r.v),
    previous: prevBy.get(String(r.g)) ?? 0,
  }))
  const shown = result.groups.reduce((s, g) => s + g.value, 0)
  const other = current - shown
  if (other > 0.0001) result.other = other
  return result
}

async function runFromTo(ctx: Ctx, c: Checked, period: ResolvedPeriod, base: ReportResult): Promise<ReportResult> {
  const windowDays = c.spec.window_days ?? DEFAULT_WINDOW
  const p = new Params()
  const a = p.add(ctx.accountId)
  const tz = p.add(ctx.timezone)
  const aSrc = source(c.from, p, a, tz, period.from, period.toExclusive, c.spec.by, undefined, c.spec.filters ?? [])
  // The second moment may come after the period ends, up to the window.
  const bEnd = new Date(Date.parse(`${period.toExclusive}T00:00:00Z`) + windowDays * 86_400_000).toISOString().slice(0, 10)
  const bSrc = source(c.to!, p, a, tz, period.from, bEnd, null, undefined, [])
  const win = p.add(windowDays)

  const sql = `
    WITH a AS (
      SELECT s.contact_id, min(s.at) AS at, (array_agg(s.g ORDER BY s.at))[1] AS g
      FROM (${aSrc}) s WHERE s.contact_id IS NOT NULL GROUP BY s.contact_id
    ), b AS (
      SELECT a.contact_id, min(s.at) AS at
      FROM a JOIN (${bSrc}) s
        ON s.contact_id = a.contact_id AND s.at >= a.at AND s.at < a.at + (${win}::int * interval '1 day')
      GROUP BY a.contact_id
    )
    SELECT a.g AS g, GROUPING(a.g) AS is_total, count(*) AS started, count(b.contact_id) AS converted,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM b.at - a.at)) AS median_sec
    FROM a LEFT JOIN b ON b.contact_id = a.contact_id
    GROUP BY ROLLUP (a.g)`
  const rows = await read(sql, p.values)

  const toRow = (r: Row, key: string): FunnelRow => {
    const started = num(r.started)
    const converted = num(r.converted)
    return {
      key,
      label: key,
      started,
      converted,
      rate: started ? converted / started : 0,
      medianSeconds: r.median_sec === null || r.median_sec === undefined ? null : num(r.median_sec),
    }
  }
  const totalRow = rows.find((r) => num(r.is_total) === 1)
  const all = totalRow ? toRow(totalRow, 'all') : toRow({ started: 0, converted: 0, median_sec: null }, 'all')
  const groups = c.spec.by
    ? rows
        .filter((r) => num(r.is_total) === 0)
        .map((r) => toRow(r, String(r.g)))
        .sort((x, y) => y.started - x.started)
        .slice(0, MAX_GROUPS)
    : []

  return {
    ...base,
    total: all.started,
    previousTotal: 0,
    funnel: { all, groups, windowDays, toLabel: c.to!.label },
  }
}

async function runAgain(ctx: Ctx, c: Checked, period: ResolvedPeriod, base: ReportResult): Promise<ReportResult> {
  const p = new Params()
  const a = p.add(ctx.accountId)
  const tz = p.add(ctx.timezone)
  const src = source(c.from, p, a, tz, period.from, period.toExclusive, null, undefined, c.spec.filters ?? [])
  const rows = await read(
    `SELECT x.n AS n, count(*) AS customers FROM (SELECT s.contact_id, count(*) AS n FROM (${src}) s WHERE s.contact_id IS NOT NULL GROUP BY 1) x GROUP BY 1 ORDER BY 1`,
    p.values,
  )
  const buckets = new Map<string, number>([['1', 0], ['2', 0], ['3', 0], ['4', 0], ['5+', 0]])
  let customers = 0
  let returning = 0
  for (const r of rows) {
    const n = num(r.n)
    const k = n >= 5 ? '5+' : String(n)
    const count = num(r.customers)
    buckets.set(k, (buckets.get(k) ?? 0) + count)
    customers += count
    if (n >= 2) returning += count
  }
  return {
    ...base,
    total: customers,
    again: {
      customers,
      returning,
      rate: customers ? returning / customers : 0,
      distribution: [...buckets].map(([times, n]) => ({ times, customers: n })),
    },
  }
}

/** Team-member details are stored as user ids; show the person's name,
 *  and only for people in this account. */
async function withAgentNames(ctx: Ctx, c: Checked, result: ReportResult): Promise<ReportResult> {
  if (!c.byIsAgent) return result
  const ids = new Set<string>()
  for (const g of result.groups ?? []) if (UUID.test(g.key)) ids.add(g.key)
  for (const g of result.funnel?.groups ?? []) if (UUID.test(g.key)) ids.add(g.key)
  if (ids.size === 0) return result
  const people = await prisma.profile.findMany({
    where: { account_id: ctx.accountId, user_id: { in: [...ids] } },
    select: { user_id: true, full_name: true, email: true },
  })
  const name = new Map(people.map((p) => [p.user_id, p.full_name?.trim() || p.email || 'Team member']))
  const label = (key: string) => (key === NONE ? 'Unassigned' : name.get(key) ?? 'Former member')
  result.groups = result.groups?.map((g) => ({ ...g, label: label(g.key) }))
  if (result.funnel) result.funnel.groups = result.funnel.groups.map((g) => ({ ...g, label: label(g.key) }))
  return result
}
