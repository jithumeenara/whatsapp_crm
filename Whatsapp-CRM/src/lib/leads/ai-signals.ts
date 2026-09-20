/**
 * What a business might count as "this person is worth calling".
 *
 * ── Why a catalogue and not a fixed rule ────────────────────────────
 *
 * "A lead" means something different in a training institute, a clinic,
 * a hardware shop and a travel agency. Asking the price is the strongest
 * possible signal in one and idle curiosity in another; asking where you
 * are is a buying signal for a showroom and noise for a company that
 * ships. A fixed definition would be wrong for most businesses using
 * this, so the definition is theirs: they tick what counts, write what
 * else counts, and write what never does.
 *
 * ── Where the list comes from ───────────────────────────────────────
 *
 * The signal set follows what the CRM industry has converged on for
 * reading intent out of a conversation rather than out of a form: what
 * the person typed, which product or service they named, whether they
 * gave a timeline, whether they mentioned a competitor, whether they
 * handed over their own details, and how much they engaged. Those are
 * reported as more predictive of readiness than anything on a contact
 * record — and they are exactly what a WhatsApp thread contains.
 *
 * Each one is phrased as something a shop owner would recognise, not as
 * a marketing term. "Asked what it costs" is a question somebody asks;
 * "pricing intent signal" is a thing somebody sells.
 */

export interface LeadSignal {
  key: string
  /** As it appears beside the checkbox. */
  label: string
  /** What the model is told this means. Written as an instruction, and
   *  deliberately concrete — a vague criterion is how a model ends up
   *  agreeing with everything. */
  prompt: string
  /** Suggested for a business that has never configured this. The four
   *  that are a buying signal almost everywhere. */
  defaultOn: boolean
  group: 'Buying intent' | 'About them' | 'Engagement'
}

export const LEAD_SIGNALS: LeadSignal[] = [
  // ── Buying intent ────────────────────────────────────────────────
  {
    key: 'asked_price',
    label: 'Asked what it costs',
    prompt: 'They asked about price, fees, charges, discounts or payment terms.',
    defaultOn: true,
    group: 'Buying intent',
  },
  {
    key: 'asked_availability',
    label: 'Asked about dates or availability',
    prompt:
      'They asked when something starts, whether a slot or seat is free, or about a schedule, batch, appointment or delivery date.',
    defaultOn: true,
    group: 'Buying intent',
  },
  {
    key: 'wants_to_proceed',
    label: 'Asked to buy, book, join or register',
    prompt:
      'They said they want to go ahead — to register, enrol, book, order, apply, reserve or pay — or asked how to do so.',
    defaultOn: true,
    group: 'Buying intent',
  },
  {
    key: 'named_item',
    label: 'Named a specific product, service or course',
    prompt:
      'They named a specific thing the business offers rather than asking in general. Naming one is a narrower question than asking what exists.',
    defaultOn: true,
    group: 'Buying intent',
  },
  {
    key: 'gave_timeline',
    label: 'Mentioned when they need it',
    prompt:
      'They gave a timeframe — this week, next month, before a date, urgently. A timeline is a commitment that idle curiosity does not make.',
    defaultOn: false,
    group: 'Buying intent',
  },
  {
    key: 'compared',
    label: 'Compared you with somewhere else',
    prompt:
      'They mentioned another provider, compared options, or asked what makes this one different. Somebody comparing is somebody choosing.',
    defaultOn: false,
    group: 'Buying intent',
  },
  {
    key: 'asked_eligibility',
    label: 'Asked whether they qualify',
    prompt:
      'They asked about eligibility, requirements, documents, qualifications or conditions for taking part. People check the rules for something they intend to do.',
    defaultOn: false,
    group: 'Buying intent',
  },

  // ── About them ───────────────────────────────────────────────────
  {
    key: 'shared_details',
    label: 'Gave their own details',
    prompt:
      'They volunteered their name, place, organisation, email, age or any other detail about themselves without being asked twice.',
    defaultOn: true,
    group: 'About them',
  },
  {
    key: 'named_organisation',
    label: 'Named their company or organisation',
    prompt: 'They said where they work, study, or which society, firm or institution they belong to.',
    defaultOn: false,
    group: 'About them',
  },
  {
    key: 'asked_location',
    label: 'Asked where you are or how to reach you',
    prompt:
      'They asked for the address, directions, opening hours or how to visit. Somebody planning a journey is further along than somebody browsing.',
    defaultOn: false,
    group: 'About them',
  },

  // ── Engagement ───────────────────────────────────────────────────
  {
    key: 'asked_for_person',
    label: 'Asked to speak to somebody',
    prompt:
      'They asked for a person, a callback, a phone number or a meeting rather than continuing in chat.',
    defaultOn: false,
    group: 'Engagement',
  },
  {
    key: 'sustained',
    label: 'Kept the conversation going',
    prompt:
      'They asked several questions or replied more than a couple of times. Effort spent is interest shown.',
    defaultOn: false,
    group: 'Engagement',
  },
  {
    key: 'returned',
    label: 'Came back after a gap',
    prompt:
      'They wrote again days after an earlier conversation. Coming back is a stronger signal than a first message.',
    defaultOn: false,
    group: 'Engagement',
  },
]

export const DEFAULT_SIGNALS = LEAD_SIGNALS.filter((s) => s.defaultOn).map((s) => s.key)

export const SIGNAL_GROUPS = ['Buying intent', 'About them', 'Engagement'] as const

export function signalsFor(keys: unknown): LeadSignal[] {
  const wanted = new Set(
    Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : DEFAULT_SIGNALS,
  )
  return LEAD_SIGNALS.filter((s) => wanted.has(s.key))
}

/** Only keys this app knows, so a stored list survives a signal being
 *  renamed or removed without becoming an instruction nothing defines. */
export function sanitizeSignals(keys: unknown): string[] {
  const known = new Set(LEAD_SIGNALS.map((s) => s.key))
  const raw = Array.isArray(keys) ? keys : []
  return [...new Set(raw.filter((k): k is string => typeof k === 'string' && known.has(k)))]
}

export type LeadThreshold = 'strict' | 'balanced' | 'loose'

/**
 * How sure the model has to be, said to the model in words.
 *
 * Not a number. A confidence score out of ten invites a model to
 * produce one and stop thinking; an instruction about what to do when
 * unsure changes what it actually does with a borderline case.
 */
export const THRESHOLD_PROMPTS: Record<LeadThreshold, string> = {
  strict:
    'Say yes only when the signals are unmistakable and you can quote the exact words that show it. If there is any doubt at all, say no.',
  balanced:
    'Say yes when a reasonable person reading this conversation would call the customer back. If you are genuinely unsure, say no.',
  loose:
    'Say yes when there is a plausible chance this person is interested, even if the signals are weak. Still say no to conversations with no sign of interest at all.',
}

export const THRESHOLD_LABELS: Record<LeadThreshold, { label: string; hint: string }> = {
  strict: { label: 'Only when certain', hint: 'Fewer leads, almost all real' },
  balanced: { label: 'Balanced', hint: 'What most businesses want' },
  loose: { label: 'Cast wide', hint: 'More leads, more to sift through' },
}

export function normalizeThreshold(value: unknown): LeadThreshold {
  return value === 'strict' || value === 'loose' ? value : 'balanced'
}

export type LeadMode = 'suggest' | 'create'

export function normalizeMode(value: unknown): LeadMode {
  return value === 'create' ? 'create' : 'suggest'
}
