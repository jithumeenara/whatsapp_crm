/**
 * Where a Data Store row came from.
 *
 * Stored on every new row (data_records.source) so the grid can say
 * "WhatsApp Flow" or "Web form" next to it, alerts can be limited to the
 * channels somebody cares about, and a report can count sign-ups per
 * channel. Rows written before this was recorded have none, and show as
 * "—" rather than a guess.
 */

export const RECORD_SOURCES = [
  'manual',
  'api',
  'import',
  'whatsapp_ai',
  'chatbot',
  'whatsapp_flow',
  'web_form',
  'payment',
  'integration',
] as const

export type RecordSource = (typeof RECORD_SOURCES)[number]

export const RECORD_SOURCE_LABELS: Record<RecordSource, string> = {
  manual: 'Added by staff',
  api: 'API',
  import: 'Excel import',
  whatsapp_ai: 'WhatsApp AI',
  chatbot: 'Chatbot',
  whatsapp_flow: 'WhatsApp Flow',
  web_form: 'Web form',
  payment: 'Payment',
  integration: 'Integration',
}

/** Sources that arrive one at a time from a person, which is what an
 *  alert is for. An import of 2,000 rows or an integration re-sync is
 *  not 2,000 things anybody wants to be told about. */
export const ALERTABLE_SOURCES: readonly RecordSource[] = [
  'manual',
  'api',
  'whatsapp_ai',
  'chatbot',
  'whatsapp_flow',
  'web_form',
  'payment',
]

export function isRecordSource(value: unknown): value is RecordSource {
  return typeof value === 'string' && (RECORD_SOURCES as readonly string[]).includes(value)
}

export function sourceLabel(value: string | null | undefined): string {
  return isRecordSource(value) ? RECORD_SOURCE_LABELS[value] : '—'
}
