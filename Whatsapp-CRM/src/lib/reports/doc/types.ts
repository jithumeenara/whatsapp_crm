/**
 * The one shape every report comes back in (docs/plans/reports-sections-plan.md).
 *
 * A report is a ReportDoc: a title, the period it covers, and an ordered
 * list of blocks — figure cards, charts, tables, notes, findings. One
 * React view draws any ReportDoc on screen, and three builders turn any
 * ReportDoc into a PDF, an Excel workbook and a PowerPoint deck. A new
 * report therefore gets the screen and all three exports for free.
 *
 * Plain, JSON-safe data only (it is sent to the browser): numbers are
 * numbers, money carries its currency, text is already the business's
 * language. Builders clean and cap every string again before drawing.
 * Never a customer's name or number in a ReportDoc that leaves the
 * team view's own screen (exports, scheduled sends).
 */

/** good / bad decide colour; a falling cost is good, so the report says which. */
export type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'brand' | 'money'

/** How a number is shown. Money always carries its currency. */
export type Fmt =
  | { kind: 'count' }
  | { kind: 'percent'; digits?: number }
  | { kind: 'money'; currency: string }
  | { kind: 'minutes' }
  | { kind: 'text' }

/** A value with its comparison: "now", "before" and whether up is good. */
export interface Compared {
  now: number | null
  before: number | null
  /** true when a rise is good (leads), false when a fall is good (cost, reply time). */
  higherIsBetter: boolean
  /** Too few to judge: shown faded, no colour. */
  small?: boolean
}

export interface KpiItem {
  label: string
  /** The value as already formatted text, e.g. "₹12,500" or "142". */
  value: string
  /** The raw comparison, when the report compares (it nearly always does). */
  compare?: Compared & { fmt: Fmt }
  /** One short line under the value, e.g. "55.9% of calls". */
  sub?: string
  tone?: Tone
  /** Report path this card opens on the All report, e.g. "/reports/leads". */
  href?: string
}

export interface Series {
  name: string
  values: number[]
  /** Previous period, drawn faded/dotted on the same chart. */
  previous?: number[]
  /** 'right' puts a line on the second axis (spend vs conversations). */
  axis?: 'left' | 'right'
  /** How this series is drawn when the chart mixes kinds. */
  kind?: 'bar' | 'line'
  fmt?: Fmt
}

export interface ChartBlock {
  kind: 'chart'
  id: string
  title: string
  /** bar: columns by label; line: trend; hbar: ranked rows; funnel: stepped stages. */
  chart: 'bar' | 'line' | 'barline' | 'hbar' | 'funnel'
  labels: string[]
  series: Series[]
  /** Text alternative for screen readers and the PDF tags. */
  alt?: string
  note?: string
}

export interface Column {
  label: string
  align?: 'left' | 'right' | 'center'
  fmt?: Fmt
  /** Relative width hint (default 1). */
  width?: number
}

export interface TableCell {
  /** Display text. */
  text: string
  /** Raw value for Excel (a number stays a number there). */
  value?: number | string | null
  tone?: Tone
  /** A link on screen (e.g. to a lead or an agent's report card). Never exported. */
  href?: string
}

export interface TableBlock {
  kind: 'table'
  id: string
  title: string
  columns: Column[]
  rows: TableCell[][]
  /** A bold last row (team total, overall). */
  total?: TableCell[]
  note?: string
  /** On screen, rows past this are behind "Show all". */
  initialRows?: number
}

export interface KpiBlock {
  kind: 'kpis'
  id: string
  title?: string
  items: KpiItem[]
}

export interface TextBlock {
  kind: 'text'
  id: string
  title?: string
  /** Each line one paragraph or bullet. */
  lines: string[]
  style?: 'headline' | 'bullets' | 'note' | 'warning'
}

export interface Finding {
  severity: 'high' | 'medium' | 'low' | 'good'
  title: string
  evidence: string
  suggestion: string
  /** Report to open for the detail. */
  href?: string
  /** Written by AI (label it); otherwise written by code from the numbers. */
  byAi?: boolean
}

export interface FindingsBlock {
  kind: 'findings'
  id: string
  title?: string
  items: Finding[]
}

export type Block = KpiBlock | ChartBlock | TableBlock | TextBlock | FindingsBlock

export interface ReportPeriodInfo {
  kind: string
  firstDay: string
  lastDay: string
  timeZone: string
  /** The comparison period, when there is one. */
  previous?: { firstDay: string; lastDay: string } | null
  /** Still running: compared with the same elapsed part of the period before. */
  partial?: boolean
}

export interface ReportDoc {
  /** Stable report key, e.g. "leads". */
  key: string
  title: string
  /** One sentence written by code: the answer first. */
  headline?: string
  period: ReportPeriodInfo
  /** "team" or "self" — who the numbers cover. */
  scope: 'team' | 'self'
  blocks: Block[]
  /** "Data since…", "too few to judge…", "ad account not connected…". */
  notes?: string[]
  generatedAt: string
}

/** Business details for the header of an exported file. */
export interface DocBusiness {
  name: string
  lines: string[]
  taxId: string | null
  logo: { bytes: Buffer; mime: 'image/png' | 'image/jpeg' } | null
  /** Six hex digits without "#"; null for the app's own colour. */
  brandColor: string | null
}
