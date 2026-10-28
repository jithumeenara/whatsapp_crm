/**
 * Several people in one public-form submission — optional, per form.
 *
 * Some questions are asked once (programme, month, district, society) and
 * the rest once per person, behind "Add participant". Each person is still
 * one row of the table, with the asked-once answers copied in, so Google
 * Sheets, exports, the assistant and "my registrations" see ordinary rows.
 * The rows of one submission share a batch id (migration 149).
 *
 * This is the shape the event tools use (Odoo's "ask once per order",
 * Eventbrite's buyer vs attendee); the form builders that keep everyone in
 * one nested answer leave every export joining them back apart.
 *
 * Pure and client-safe: the settings panel, the public page and the
 * submit route read the same rules.
 */

/** No submission carries more people than this, whatever is configured. */
export const GROUP_HARD_MAX = 50

export interface FormGroup {
  enabled: boolean
  /** What one person is called on the form: "Participant", "Student"… */
  label: string
  /** Questions asked once per person; every other question is asked once. */
  person_keys: string[]
  min: number
  max: number
}

export const DEFAULT_GROUP: FormGroup = { enabled: false, label: 'Participant', person_keys: [], min: 1, max: 20 }

/** A WhatsApp confirmation: an approved template and what fills it. */
export interface FormConfirm {
  template: string
  /** The question holding the number it goes to. For the person who
   *  filled the form, empty = only a contact from a personal link. */
  phone_key: string
  /** What goes in {{1}}, {{2}}… in order (CONFIRM_VALUES, or field:<key>). */
  params: string[]
}

export const CONFIRM_VALUES = ['names', 'count', 'reference', 'business', 'person_name'] as const
export type ConfirmValue = (typeof CONFIRM_VALUES)[number]

function clampInt(raw: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : fallback
}

export function parseGroup(raw: unknown, fieldKeys?: readonly string[]): FormGroup {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_GROUP }
  const r = raw as Record<string, unknown>
  const keys = Array.isArray(r.person_keys)
    ? Array.from(new Set(r.person_keys.filter((k): k is string => typeof k === 'string' && k.length <= 100)))
        .filter((k) => !fieldKeys || fieldKeys.includes(k))
        .slice(0, 100)
    : []
  const label = typeof r.label === 'string' ? r.label.replace(/\s+/g, ' ').trim().slice(0, 40) : ''
  const max = clampInt(r.max, 1, GROUP_HARD_MAX, DEFAULT_GROUP.max)
  return {
    enabled: r.enabled === true,
    label: label || DEFAULT_GROUP.label,
    person_keys: keys,
    min: Math.min(max, clampInt(r.min, 1, GROUP_HARD_MAX, DEFAULT_GROUP.min)),
    max,
  }
}

/** Is the group form actually in use — switched on, with something to ask per person. */
export function groupActive(g: FormGroup | null | undefined): g is FormGroup {
  return !!g && g.enabled && g.person_keys.length > 0
}

export function parseConfirm(raw: unknown, fieldKeys?: readonly string[]): FormConfirm | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const template = typeof r.template === 'string' ? r.template.trim().slice(0, 512) : ''
  if (!template || !/^[a-z0-9_]+$/.test(template)) return null
  const known = (k: string) => !fieldKeys || fieldKeys.includes(k)
  const phone = typeof r.phone_key === 'string' && known(r.phone_key) ? r.phone_key : ''
  const params = (Array.isArray(r.params) ? r.params : [])
    .slice(0, 20)
    .map((p) => (typeof p === 'string' ? p : ''))
    .map((p) => ((CONFIRM_VALUES as readonly string[]).includes(p) || (p.startsWith('field:') && known(p.slice(6))) ? p : ''))
  return { template, phone_key: phone, params }
}

/** The per-person question a person is shown by on their card: a name if there is one. */
export function personNameKey(fields: ReadonlyArray<{ key: string; label: string; type: string; columnLabel?: string }>, personKeys: readonly string[]): string | null {
  const mine = fields.filter((f) => personKeys.includes(f.key) && (f.type === 'text' || f.type === 'textarea'))
  // The column's own name, not a form heading the business reworded.
  const words = (f: (typeof mine)[number]) => `${f.key} ${f.columnLabel ?? f.label}`
  const named = mine.find((f) => /\bname\b|name$|^name/i.test(words(f)) && !/father|mother|guardian|society|company|institution|organi[sz]ation/i.test(words(f)))
  return (named ?? mine[0])?.key ?? null
}

type Answers = Record<string, unknown>

/**
 * A submission split into what was asked once and what each person said.
 * Anything sent in the wrong place is dropped, never moved: a per-person
 * answer in the shared part (or the reverse) is not trusted to mean anything.
 */
export function splitSubmission(
  values: unknown,
  people: unknown,
  group: FormGroup,
): { ok: true; shared: Answers; people: Answers[] } | { ok: false; problem: string } {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return { ok: false, problem: 'Nothing was sent.' }
  if (!Array.isArray(people)) return { ok: false, problem: `Add at least one ${group.label.toLowerCase()}.` }
  const max = Math.min(group.max, GROUP_HARD_MAX)
  if (people.length < group.min) {
    return { ok: false, problem: group.min === 1 ? `Add at least one ${group.label.toLowerCase()}.` : `Add at least ${group.min} people.` }
  }
  if (people.length > max) return { ok: false, problem: `At most ${max} people can be sent in one form.` }
  const per = new Set(group.person_keys)
  const shared: Answers = {}
  for (const [k, v] of Object.entries(values as Answers)) if (!per.has(k)) shared[k] = v
  const out: Answers[] = []
  for (const p of people) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, problem: 'The list of people could not be read. Reload the page and try again.' }
    const one: Answers = {}
    for (const [k, v] of Object.entries(p as Answers)) if (per.has(k)) one[k] = v
    out.push(one)
  }
  return { ok: true, shared, people: out }
}

function sameKey(type: string, v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  if (type === 'phone') {
    const d = s.replace(/\D/g, '')
    return d.length >= 7 ? d.slice(-10) : null
  }
  if (type === 'email') return s.toLowerCase()
  return null
}

/**
 * The same person twice in one submission: a repeated phone number or
 * email in a per-person question, or two people whose answers are all the
 * same. Messages name the person: "Participant 3: …".
 */
export function batchDuplicates(
  people: readonly Answers[],
  fields: ReadonlyArray<{ key: string; label: string; type: string }>,
  group: Pick<FormGroup, 'person_keys' | 'label'>,
): string[] {
  const problems: string[] = []
  const per = fields.filter((f) => group.person_keys.includes(f.key))
  const seen = new Map<string, number>()
  const whole = new Map<string, number>()
  people.forEach((p, i) => {
    for (const f of per) {
      const k = sameKey(f.type, p[f.key])
      if (!k) continue
      const id = `${f.key}\u0000${k}`
      const first = seen.get(id)
      if (first !== undefined) problems.push(`${group.label} ${i + 1}: the same ${f.label} as ${group.label.toLowerCase()} ${first + 1}.`)
      else seen.set(id, i)
    }
    const sig = per.map((f) => String(p[f.key] ?? '').trim().toLowerCase()).join('\u0001')
    if (sig.replace(/\u0001/g, '')) {
      const first = whole.get(sig)
      if (first !== undefined) problems.push(`${group.label} ${i + 1} is the same as ${group.label.toLowerCase()} ${first + 1}.`)
      else whole.set(sig, i)
    }
  })
  return Array.from(new Set(problems))
}

/** ID numbers, bank details, secrets: never put in a message to a number
 *  a stranger typed into a public form. */
export function isSensitiveQuestion(f: { key: string; label: string; columnLabel?: string }): boolean {
  // The column's own name counts too: a form heading must not hide it.
  return /aadha?a?r|\bpan\b|passport|bank|account|ifsc|card|password|otp|\bpin\b|voter|licen[cs]e/i.test(`${f.key.replace(/_/g, ' ')} ${f.label} ${f.columnLabel ?? ''}`)
}

/** A stranger's words in the business's message: no links, short. */
export function cleanParam(text: string, max = 60): string {
  return text
    .replace(/\S*(?:https?:\/\/|www\.)\S*/gi, '')
    .replace(/\b[\w-]+(?:\.[\w-]+)*\.(?:com|in|net|org|ly|io|me|co|xyz|info|biz|link|app|site|online|top|click|shop|live)\b\S*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** What a confirmation's {{1}}, {{2}}… say for one message. Answers typed
 *  on the form lose links and are kept short; a sensitive question is never sent. */
export function confirmParams(
  spec: FormConfirm,
  ctx: { data: Answers; names: string[]; count: number; reference: string; business: string; personName?: string; sensitive?: ReadonlySet<string> },
): string[] {
  return spec.params.map((p) => {
    if (p === 'names') {
      const list = ctx.names.map((n) => cleanParam(n, 40)).filter(Boolean)
      return cleanParam(list.slice(0, 8).join(', ') + (list.length > 8 ? ` +${list.length - 8}` : ''), 160)
    }
    if (p === 'count') return String(ctx.count)
    if (p === 'reference') return ctx.reference
    if (p === 'business') return ctx.business
    if (p === 'person_name') return cleanParam(ctx.personName || ctx.names[0] || '', 40)
    if (p.startsWith('field:')) {
      const key = p.slice(6)
      if (ctx.sensitive?.has(key)) return ''
      const v = ctx.data[key]
      return cleanParam(Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v ?? ''))
    }
    return ''
  }).map((v) => v.trim() || '-')
}

/**
 * A typed number as WhatsApp wants it: digits with the country code. A
 * local number (no "+", the length of the business's own local numbers)
 * gets the business's country code; anything unclear is refused rather
 * than sent somewhere it was not meant for.
 */
export function whatsappNumber(raw: unknown, dial: string): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  let d = s.replace(/\D/g, '')
  const cc = dial.replace(/\D/g, '')
  if (s.startsWith('+') || s.startsWith('00')) d = d.replace(/^00/, '')
  else if (d.startsWith('0') && d.length === 11) d = cc + d.slice(1)
  else if (d.length === 10) d = cc + d
  return d.length >= 8 && d.length <= 15 ? d : null
}
