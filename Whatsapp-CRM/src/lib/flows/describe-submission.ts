/**
 * A submitted WhatsApp Flow, written out the way a person reads it.
 *
 * The inbound message used to say only "Flow submitted". That told the
 * agent in the Inbox nothing, and told the assistant nothing either — it
 * reads the conversation, and there was nothing in it to read. With the
 * answers written into the message, both see what the customer entered,
 * and the assistant can confirm it back when no chatbot step does.
 *
 * The answers arrive keyed twice — by a component's own name
 * ("comp_12") and by its Field Mapping key ("training_programe") — see
 * flowAnswers in webhook-handler.ts. The readable key wins; an internal
 * name is kept only when nothing else carries the same answer.
 */

/** Marks the message as a form submission, for people and for code. */
export const FORM_SUBMITTED_PREFIX = 'Submitted the form:'

const MAX_LINES = 30
const MAX_VALUE = 200

const isInternal = (key: string) => /(^|_)comp_\d+/i.test(key) || key.startsWith('__') || key === 'flow_token'
const isIdNumber = (key: string) => /aadh?aa?r|uidai/i.test(key)

function humanise(key: string): string {
  const words = key.replace(/__+/g, ' ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Keeps the last four digits of an Aadhaar-style number. Values from the
 *  endpoint are already masked; a Flow without one sends them as typed. */
function maskId(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 12) return `XXXX XXXX ${digits.slice(-4)}`
  if (/^X+/.test(value)) return value
  return value.length <= 4 ? value : `${'X'.repeat(Math.min(value.length - 4, 8))}${value.slice(-4)}`
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(', ')
  if (typeof value === 'object') return ''
  return String(value).trim()
}

/** "Submitted the form:\n• Training programe: PSC\n…", or null when the
 *  submission carried nothing readable. */
export function describeFlowSubmission(response: Record<string, unknown>): string | null {
  const entries = Object.entries(response)
    .map(([key, value]) => [key, asText(value)] as const)
    .filter(([key, text]) => key !== 'flow_token' && !key.startsWith('__') && text !== '')

  const readableValues = new Set(entries.filter(([k]) => !isInternal(k)).map(([, v]) => v))
  const lines: string[] = []
  const seen = new Set<string>()
  for (const [key, raw] of entries) {
    // An internal name is only worth showing when it is the one place
    // this answer appears.
    if (isInternal(key) && readableValues.has(raw)) continue
    const value = (isIdNumber(key) ? maskId(raw) : raw).slice(0, MAX_VALUE)
    const label = humanise(key.replace(/(^|_)comp_\d+/gi, '').replace(/^_+|_+$/g, '') || 'Answer')
    const line = `• ${label}: ${value}`
    if (seen.has(line)) continue
    seen.add(line)
    lines.push(line)
    if (lines.length >= MAX_LINES) break
  }
  return lines.length ? `${FORM_SUBMITTED_PREFIX}\n${lines.join('\n')}` : null
}
