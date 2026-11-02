/**
 * Turning audit events into a downloadable file (plan §16). Every value
 * that came from people goes through safeText, so no cell can run as a
 * spreadsheet formula. Pure: the route does the reading and the limits.
 */

import { safeText } from '@/lib/files/spreadsheet-safe'
import type { EventOut } from './read'

export const EXPORT_MAX_ROWS = 50_000
export const EXPORT_MAX_DAYS = 92
export const EXPORT_PER_HOUR = 3

export const CSV_COLUMNS = [
  'id', 'seq', 'occurred_at', 'actor_type', 'actor_id', 'actor_name', 'actor_label', 'actor_role', 'on_behalf_of',
  'action', 'category', 'outcome', 'reason', 'target_type', 'target_id', 'target_label', 'changes',
  'request_id', 'correlation_id', 'source', 'ip', 'user_agent', 'meta', 'row_hash',
] as const

function cell(v: unknown): string {
  const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v)
  return `"${safeText(s).replace(/"/g, '""')}"`
}

export function csvLine(values: unknown[]): string {
  return values.map(cell).join(',') + '\r\n'
}

export function csvEventLine(e: EventOut): string {
  return csvLine(CSV_COLUMNS.map((c) => (e as unknown as Record<string, unknown>)[c]))
}

export interface ExportHead {
  through_seq: string
  through_hash: string
  cut_at: string
  filters: Record<string, string>
}

/** The first lines of a CSV: what it is and the chain head it was cut at,
 *  so a recipient can check it against a signed checkpoint. */
export function csvPreamble(h: ExportHead): string {
  return '﻿' + csvLine([
    'audit_export', `through_seq=${h.through_seq}`, `through_hash=${h.through_hash}`, `cut_at=${h.cut_at}`,
    `filters=${JSON.stringify(h.filters)}`,
  ]) + csvLine([...CSV_COLUMNS])
}
