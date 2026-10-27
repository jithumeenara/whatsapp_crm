/**
 * The AI template kit's drafts, checked — pure.
 *
 * The model writes a business's templates (staff alerts, customer
 * reminders, an offer); this file turns what it wrote into something Meta
 * will accept, and says plainly what is wrong with any that will not:
 *   - Meta's own rules, through the validators the submit route uses;
 *   - the rules Meta rejects for without saying so: a variable at the very
 *     start or end, two variables side by side, more variables than words
 *     can carry, promotion in a Utility template;
 *   - a name Meta allows, unique among the drafts.
 * Staff alerts carry the alert field each {{n}} stands for, so choosing
 * the approved template for an alert fills its mapping by itself.
 */
import { validateTemplatePayload } from './template-validators'
import { ALERT_FIELD_SAMPLE, isAlertField, type AlertField } from './alert-fields'

export type KitPurpose = 'handoff_alert' | 'new_contact_alert' | 'customer_utility' | 'customer_marketing'
export const KIT_PURPOSES: readonly KitPurpose[] = ['handoff_alert', 'new_contact_alert', 'customer_utility', 'customer_marketing']
export type KitLanguage = 'en' | 'ml'

export interface KitDraft {
  purpose: KitPurpose
  name: string
  category: 'Utility' | 'Marketing'
  language: KitLanguage
  body: string
  /** One example per {{n}}, in order — Meta requires them. */
  samples: string[]
  /** Staff alerts: what each {{n}} carries. */
  variable_fields?: AlertField[]
  /** Why this template helps this business, one line. */
  why: string
  /** Meta would refuse it as written. */
  problems: string[]
  /** It may pass, but is likely to be rejected or re-categorised. */
  warnings: string[]
}

const PROMO = /\b(offer|discount|sale|deal|% ?off|free|limited time|hurry|buy now|coupon|cashback|ഓഫർ|ഡിസ്കൗണ്ട്|സൗജന്യ)\b/i

function cleanName(raw: unknown, taken: Set<string>): string {
  let base = String(raw ?? '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60)
  if (!base) base = 'template'
  let name = base
  for (let i = 2; taken.has(name); i++) name = `${base.slice(0, 56)}_${i}`
  taken.add(name)
  return name
}

/** {{1}}, {{2}}… in order of number. */
function indices(body: string): number[] {
  return [...new Set([...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b)
}

export function checkKitDraft(d: Pick<KitDraft, 'name' | 'category' | 'language' | 'body' | 'samples'>): { problems: string[]; warnings: string[] } {
  const problems: string[] = []
  const warnings: string[] = []
  try {
    validateTemplatePayload({
      name: d.name,
      category: d.category,
      language: d.language,
      body_text: d.body,
      sample_values: { body: d.samples },
    })
  } catch (err) {
    problems.push(err instanceof Error ? err.message : String(err))
  }
  const body = d.body.trim()
  if (/^\{\{/.test(body)) problems.push('A template cannot start with a variable — Meta rejects it.')
  if (/\}\}[.!?]?$/.test(body)) problems.push('A template cannot end with a variable — add a few words after it.')
  if (/\}\}\s*\{\{/.test(body)) problems.push('Two variables side by side are rejected — put words between them.')
  const n = indices(body).length
  const words = body.replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/).filter(Boolean).length
  if (n > 0 && words < n * 3) warnings.push('Very few words for its variables — Meta often rejects this as "too many variables".')
  if (d.category === 'Utility' && PROMO.test(body)) {
    warnings.push('Sounds like a promotion — Meta may move it to Marketing (costlier, and opt-out applies).')
  }
  return { problems, warnings }
}

/** The model's raw answer into checked drafts. Unknown shapes are dropped. */
export function normaliseKitDrafts(raw: unknown, takenNames: Iterable<string> = []): KitDraft[] {
  const list = Array.isArray((raw as { templates?: unknown })?.templates) ? (raw as { templates: unknown[] }).templates : []
  const taken = new Set(takenNames)
  const out: KitDraft[] = []
  for (const item of list.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const purpose = KIT_PURPOSES.includes(r.purpose as KitPurpose) ? (r.purpose as KitPurpose) : null
    const body = typeof r.body === 'string' ? r.body.trim().slice(0, 1100) : ''
    if (!purpose || !body) continue
    const language: KitLanguage = r.language === 'ml' ? 'ml' : 'en'
    const isAlert = purpose === 'handoff_alert' || purpose === 'new_contact_alert'
    const category: KitDraft['category'] = isAlert || purpose === 'customer_utility' ? 'Utility' : 'Marketing'
    const n = indices(body).length
    const vars = Array.isArray(r.variables) ? (r.variables as Array<Record<string, unknown>>) : []
    const fields = isAlert ? vars.map((v) => v?.field).filter(isAlertField) : []
    const variable_fields = isAlert && fields.length === n && n > 0 ? fields : undefined
    const samples = Array.from({ length: n }, (_, i) => {
      const fromModel = typeof vars[i]?.sample === 'string' ? String(vars[i].sample).trim().slice(0, 60) : ''
      return fromModel || (variable_fields ? ALERT_FIELD_SAMPLE[variable_fields[i]] : `example ${i + 1}`)
    })
    const name = cleanName(r.name ?? purpose, taken)
    const draft: KitDraft = {
      purpose,
      name,
      category,
      language,
      body,
      samples,
      ...(variable_fields ? { variable_fields } : {}),
      why: typeof r.why === 'string' ? r.why.trim().slice(0, 200) : '',
      problems: [],
      warnings: [],
    }
    if (isAlert && !variable_fields && n > 0) draft.warnings.push('The variables are not labelled — set what each carries in the alert settings after approval.')
    const checked = checkKitDraft(draft)
    draft.problems.push(...checked.problems)
    draft.warnings.push(...checked.warnings)
    out.push(draft)
  }
  return out
}
