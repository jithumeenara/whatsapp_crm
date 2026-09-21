/**
 * Proposing a business's own category list, so nobody faces an empty box.
 *
 * ── Why this exists at all ──────────────────────────────────────────
 *
 * The category list cannot ship in the application: a hospital's is
 * Ortho and Dental, a coaching institute's is LGS and LDC, a jeweller's
 * is gold and repairs, and the fourth customer is always one nobody
 * thought of. So it has to be per account.
 *
 * Which creates the real problem. An owner opens Settings, finds an
 * empty box, and does not fill it. Ever. The feature is then dead, not
 * because it was badly built but because nobody could be bothered to
 * start it — which is how most configurable features die.
 *
 * ── Why the answer is already in the database ───────────────────────
 *
 * This business has told us who it is several times over: its industry
 * and section on the company profile, its own description of what it
 * does, every entry in its knowledge base and the department each one
 * was filed under, and a few hundred real conversations. That is more
 * than enough to propose a list.
 *
 * So the owner presses one button and edits a list that is already
 * mostly right, which is a completely different act from writing one
 * from nothing.
 *
 * ── Why it proposes rather than saves ───────────────────────────────
 *
 * Nothing here writes. The suggestion is shown with its own evidence —
 * how often each one actually appeared — and the owner ticks what to
 * keep. A list that installed itself would be a list nobody had read,
 * and every judgement afterwards would be sorted into categories the
 * business never agreed to.
 */

import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from '@google/generative-ai'
import { prisma } from '@/lib/db'
import { geminiCredentials } from '@/lib/ai/providers/registry'
import { recordAiUsage, tokensFromGemini } from '@/lib/ai/usage'
import { thinkingConfigFor } from '@/lib/ai/reasoning'

const SUGGEST_MODEL = 'gemini-3.5-flash-lite'

/**
 * Twenty is the ceiling, and it is a real one.
 *
 * Classification accuracy falls as labels multiply and start to
 * overlap. A business that genuinely has forty departments is better
 * served by twelve broad ones that route correctly than by forty that
 * are guessed between.
 */
const MAX_CATEGORIES = 20

/** How many real conversations to read. Enough to see what people
 *  actually ask about, few enough to stay cheap and fast. */
const CONVERSATION_SAMPLE = 200

export interface SuggestedCategory {
  key: string
  label: string
  hint: string
  /** How many of the sampled conversations looked like this one. Shown
   *  beside the tick box: a category seen three times is a different
   *  proposition from one seen ninety times, and the owner should be
   *  the one to decide. */
  seen: number
}

export type SuggestResult =
  | { ok: true; categories: SuggestedCategory[]; sampled: number }
  | { ok: false; error: 'no_key' | 'no_data' | 'failed'; message: string }

export async function suggestCategories(accountId: string): Promise<SuggestResult> {
  const [aiConfig, company, knowledge, conversations, existing] = await Promise.all([
    prisma.aiConfig
      .findUnique({ where: { account_id: accountId }, select: { provider_keys: true } })
      .catch(() => null),
    prisma.companyProfile
      .findUnique({
        where: { account_id: accountId },
        select: { category: true, section: true, about: true, services: true, display_name: true },
      })
      .catch(() => null),
    prisma.aiKnowledgeItem
      .findMany({
        where: { account_id: accountId },
        select: { title: true, department: true },
        take: 200,
      })
      .catch(() => []),
    prisma.conversation
      .findMany({
        where: { account_id: accountId, last_message_text: { not: null } },
        orderBy: { last_message_at: 'desc' },
        take: CONVERSATION_SAMPLE,
        select: { last_message_text: true },
      })
      .catch(() => []),
    prisma.serviceCategory
      .findMany({ where: { account_id: accountId }, select: { key: true, label: true } })
      .catch(() => []),
  ])

  const { apiKey } = aiConfig ? geminiCredentials(aiConfig) : { apiKey: null }
  if (!apiKey) return { ok: false, error: 'no_key', message: 'No Gemini key on this account.' }

  const hasSomething =
    Boolean(company?.about?.trim() || company?.services?.trim() || company?.section) ||
    knowledge.length > 0 ||
    conversations.length > 0
  if (!hasSomething) {
    return {
      ok: false,
      error: 'no_data',
      message:
        'There is nothing to read yet. Fill in the business profile, or come back once some conversations have happened.',
    }
  }

  const started = Date.now()
  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: SUGGEST_MODEL,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: SCHEMA,
        ...(thinkingConfigFor(SUGGEST_MODEL, 'minimal') ?? {}),
      },
    })

    const result = await model.generateContent(
      buildSuggestPrompt({ company, knowledge, conversations, existing }),
    )

    void recordAiUsage({
      accountId,
      model: SUGGEST_MODEL,
      feature: 'judgement',
      tokens: tokensFromGemini(result.response.usageMetadata),
      latencyMs: Date.now() - started,
    })

    let parsed: { categories?: unknown }
    try {
      parsed = JSON.parse(result.response.text())
    } catch {
      return { ok: false, error: 'failed', message: 'The model did not return JSON.' }
    }

    return {
      ok: true,
      categories: normalizeSuggestions(parsed.categories, existing),
      sampled: conversations.length,
    }
  } catch (err) {
    return { ok: false, error: 'failed', message: err instanceof Error ? err.message : String(err) }
  }
}

const SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    categories: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          key: {
            type: SchemaType.STRING,
            description: 'lowercase_with_underscores, short, stable. e.g. "lgs", "dental".',
          },
          label: {
            type: SchemaType.STRING,
            description: 'What staff would call it, in their own words. e.g. "Sub Staff (LGS)".',
          },
          hint: {
            type: SchemaType.STRING,
            description:
              'One line saying where this one ends and the neighbouring one begins. This is the most important field: it is what stops two similar categories being guessed between.',
          },
          seen: {
            type: SchemaType.INTEGER,
            description: 'Roughly how many of the sampled conversations were about this.',
          },
        },
        required: ['key', 'label', 'hint', 'seen'],
      },
    },
  },
  required: ['categories'],
}

/** Safe, deduplicated, capped, and sorted by how often it actually came
 *  up — so the ones worth keeping are at the top of the list. */
export function normalizeSuggestions(
  raw: unknown,
  existing: Array<{ key: string }> = [],
): SuggestedCategory[] {
  if (!Array.isArray(raw)) return []
  const already = new Set(existing.map((e) => e.key))
  const seenKeys = new Set<string>()
  const out: SuggestedCategory[] = []

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const key = String(o.key ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40)
    const label = String(o.label ?? '').trim().slice(0, 60)
    if (!key || !label) continue
    // Already on the list, or the model said it twice.
    if (already.has(key) || seenKeys.has(key)) continue
    seenKeys.add(key)
    out.push({
      key,
      label,
      hint: String(o.hint ?? '').trim().slice(0, 200),
      seen: Number.isFinite(Number(o.seen)) ? Math.max(0, Math.round(Number(o.seen))) : 0,
    })
    if (out.length >= MAX_CATEGORIES) break
  }

  return out.sort((a, b) => b.seen - a.seen)
}

export function buildSuggestPrompt(args: {
  company: {
    category: string | null
    section: string | null
    about: string | null
    services: string | null
    display_name: string | null
  } | null
  knowledge: Array<{ title: string | null; department: string | null }>
  conversations: Array<{ last_message_text: string | null }>
  existing: Array<{ key: string; label: string }>
}): string {
  const p: string[] = [
    'You are setting up a business messaging system. Propose the list of subjects this business handles — the things a customer message could be about — so incoming messages can be sorted and sent to the right person.',
    '',
    'Rules:',
    `  • At most ${MAX_CATEGORIES}, and fewer is better. Accuracy falls when categories overlap.`,
    '  • Use the words this business itself uses, not generic ones.',
    '  • Every category needs a hint that separates it from its nearest neighbour.',
    '  • Only propose what the evidence below actually shows. Do not pad the list with things a business like this might have.',
    '',
  ]

  const c = args.company
  if (c) {
    p.push('The business:')
    if (c.display_name) p.push(`  Name: ${c.display_name}`)
    if (c.category) p.push(`  Industry: ${c.category}`)
    if (c.section) p.push(`  Type: ${c.section}`)
    if (c.about?.trim()) p.push(`  About: ${c.about.trim().slice(0, 800)}`)
    if (c.services?.trim()) p.push(`  Services: ${c.services.trim().slice(0, 800)}`)
    p.push('')
  }

  // The departments already used on knowledge entries are the closest
  // thing to an answer the business has already written down.
  const departments = [
    ...new Set(args.knowledge.map((k) => k.department?.trim()).filter(Boolean) as string[]),
  ]
  if (departments.length > 0) {
    p.push(`Departments already used in its knowledge base: ${departments.join(', ')}`, '')
  }

  const titles = args.knowledge
    .map((k) => k.title?.trim())
    .filter(Boolean)
    .slice(0, 60)
  if (titles.length > 0) {
    p.push('What it has written answers about:')
    for (const t of titles) p.push(`  • ${t}`)
    p.push('')
  }

  const messages = args.conversations
    .map((m) => m.last_message_text?.trim().replace(/\s+/g, ' ').slice(0, 120))
    .filter(Boolean)
    .slice(0, 150)
  if (messages.length > 0) {
    p.push(`What customers actually sent (${messages.length} recent messages):`)
    for (const m of messages) p.push(`  • ${m}`)
    p.push('')
  }

  if (args.existing.length > 0) {
    p.push(
      'Already on the list — do not propose these again:',
      args.existing.map((e) => `  ${e.key} (${e.label})`).join('\n'),
      '',
    )
  }

  return p.join('\n')
}
