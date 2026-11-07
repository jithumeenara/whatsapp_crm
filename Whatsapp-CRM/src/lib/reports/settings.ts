/**
 * Settings → Reports (migration 158: lead_settings.funnel_stages and
 * report_settings). Parsed and checked here, the only place either is
 * read or written, so a malformed row can never break a report.
 *
 * The funnel is the business's own: stage names are data, never code
 * (all-industry rule). Each stage maps to open, won or lost, so the same
 * report works for a hospital (Appointment → Visited → Surgery) and a
 * training institute (Enquiry → Registered → Attended). Pure.
 */

export const STAGE_OUTCOMES = ['open', 'won', 'lost'] as const
export type StageOutcome = (typeof STAGE_OUTCOMES)[number]

export interface FunnelStage {
  /** Stable, never shown: a renamed stage keeps its history. */
  key: string
  label: string
  outcome: StageOutcome
}

export interface ManualSpend {
  /** "YYYY-MM": spend is entered per month. */
  month: string
  source: string
  amount: number
  currency: string
}

export interface ReportSettings {
  /** Open work older than this is a leak. Null: the leads SLA warning hours. */
  leakHours: number | null
  manualSpend: ManualSpend[]
}

export const MAX_STAGES = 12
export const MAX_LABEL = 40
export const MAX_SPEND_ROWS = 120

/** Starting points only; the business renames, reorders and edits freely. */
export const FUNNEL_TEMPLATES: Record<string, { label: string; stages: Array<Omit<FunnelStage, 'key'>> }> = {
  simple: { label: 'Simple', stages: [{ label: 'Contacted', outcome: 'open' }, { label: 'Interested', outcome: 'open' }, { label: 'Won', outcome: 'won' }] },
  clinic: { label: 'Hospital or clinic', stages: [{ label: 'Appointment', outcome: 'open' }, { label: 'Visited', outcome: 'open' }, { label: 'Procedure or surgery', outcome: 'won' }] },
  training: { label: 'Training or education', stages: [{ label: 'Enquiry', outcome: 'open' }, { label: 'Registered', outcome: 'open' }, { label: 'Attended', outcome: 'won' }] },
  realEstate: { label: 'Real estate', stages: [{ label: 'Site visit', outcome: 'open' }, { label: 'Negotiation', outcome: 'open' }, { label: 'Booking', outcome: 'won' }] },
  retail: { label: 'Sales or retail', stages: [{ label: 'Quote sent', outcome: 'open' }, { label: 'Order', outcome: 'won' }] },
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

export function stageKey(label: string, taken: Set<string>): string {
  const base = label.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'stage'
  let key = base
  for (let i = 2; taken.has(key); i++) key = `${base}_${i}`
  taken.add(key)
  return key
}

/** Whatever is stored, a valid list (possibly empty). Never throws. */
export function parseFunnel(raw: unknown): FunnelStage[] {
  if (!Array.isArray(raw)) return []
  const taken = new Set<string>()
  const out: FunnelStage[] = []
  for (const r of raw.slice(0, MAX_STAGES)) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const label = clean(o.label, MAX_LABEL)
    if (!label) continue
    const outcome = (STAGE_OUTCOMES as readonly string[]).includes(o.outcome as string) ? (o.outcome as StageOutcome) : 'open'
    const wanted = clean(o.key, 40)
    const key = wanted && /^[\p{L}\p{N}_]+$/u.test(wanted) && !taken.has(wanted) ? (taken.add(wanted), wanted) : stageKey(label, taken)
    out.push({ key, label, outcome })
  }
  return out
}

/** Checks a list sent by an admin; an error in plain words, or the clean list. */
export function validateFunnel(raw: unknown): { ok: true; stages: FunnelStage[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'Send the stages as a list.' }
  if (raw.length > MAX_STAGES) return { ok: false, error: `Use at most ${MAX_STAGES} stages.` }
  for (const r of raw) {
    const label = clean((r as Record<string, unknown> | null)?.label, MAX_LABEL + 1)
    if (!label) return { ok: false, error: 'Every stage needs a name.' }
    if (label.length > MAX_LABEL) return { ok: false, error: `Keep stage names under ${MAX_LABEL} characters.` }
  }
  const stages = parseFunnel(raw)
  const labels = new Set(stages.map((s) => s.label.toLowerCase()))
  if (labels.size !== stages.length) return { ok: false, error: 'Two stages have the same name.' }
  return { ok: true, stages }
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const CURRENCY = /^[A-Z]{3}$/

export function parseReportSettings(raw: unknown): ReportSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const hours = Number(o.leakHours)
  const leakHours = Number.isInteger(hours) && hours >= 1 && hours <= 720 ? hours : null
  const manualSpend: ManualSpend[] = []
  for (const r of Array.isArray(o.manualSpend) ? o.manualSpend.slice(0, MAX_SPEND_ROWS) : []) {
    if (!r || typeof r !== 'object') continue
    const x = r as Record<string, unknown>
    const amount = Number(x.amount)
    const month = clean(x.month, 7)
    const source = clean(x.source, MAX_LABEL)
    const currency = clean(x.currency, 3).toUpperCase()
    if (!MONTH.test(month) || !source || !Number.isFinite(amount) || amount < 0 || amount > 9_999_999_999 || !CURRENCY.test(currency)) continue
    manualSpend.push({ month, source, amount: Math.round(amount * 100) / 100, currency })
  }
  return { leakHours, manualSpend }
}

export function validateReportSettings(raw: unknown): { ok: true; settings: ReportSettings } | { ok: false; error: string } {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!o) return { ok: false, error: 'Nothing to save.' }
  if (o.leakHours !== null && o.leakHours !== undefined) {
    const h = Number(o.leakHours)
    if (!Number.isInteger(h) || h < 1 || h > 720) return { ok: false, error: 'Choose between 1 and 720 hours.' }
  }
  if (o.manualSpend !== undefined && !Array.isArray(o.manualSpend)) return { ok: false, error: 'Send ad spend as a list.' }
  const rows = Array.isArray(o.manualSpend) ? o.manualSpend : []
  if (rows.length > MAX_SPEND_ROWS) return { ok: false, error: `Keep at most ${MAX_SPEND_ROWS} spend rows.` }
  const settings = parseReportSettings(o)
  if (settings.manualSpend.length !== rows.length) return { ok: false, error: 'Each spend row needs a month, a source, an amount of 0 or more and a currency.' }
  return { ok: true, settings }
}
