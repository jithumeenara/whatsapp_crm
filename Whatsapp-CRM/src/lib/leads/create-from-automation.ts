/**
 * The automation step that files a lead.
 *
 * ── Two ways to decide, one action ──────────────────────────────────
 *
 * Without AI, the step matches words: exact, whole-word, substring or
 * close-enough — see keyword-match.ts, which explains why those are
 * four different jobs. It is instant, free, and does exactly what it
 * says, which is the right answer whenever the business can name the
 * words. "Fees", "price", "admission", "book" covers most enquiries in
 * most inboxes.
 *
 * With AI, the step reads the message and answers the same question in
 * meaning rather than in letters. That is worth paying for when the
 * words are unlistable — "I've been thinking about this for my
 * daughter" is an enquiry and shares no vocabulary with any keyword
 * anybody would think to write down.
 *
 * ── Why the AI mode is one message, not the thread ──────────────────
 *
 * This is an automation step: it fires on a specific message, and the
 * account wired it to that trigger deliberately. Reading the whole
 * conversation is what the Suggested tab does, on its own schedule,
 * with its own settings. Two features that both read everything would
 * charge twice for the same judgement.
 */

import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import { prisma } from '@/lib/db'
import { geminiCredentials } from '@/lib/ai/providers/registry'
import { recordAiUsage, tokensFromGemini } from '@/lib/ai/usage'
import { thinkingConfigFor } from '@/lib/ai/reasoning'
import { LEAD_DETECT_MODEL, loadAiLeadSettings } from './ai-detect'
import { signalsFor } from './ai-signals'
import { matchKeywords, normalizeMatchMode, type MatchMode } from './keyword-match'

export type CreateLeadMatchMode = MatchMode | 'ai'

export function normalizeCreateLeadMode(value: unknown): CreateLeadMatchMode {
  return value === 'ai' ? 'ai' : normalizeMatchMode(value)
}

export interface CreateLeadConfig {
  match_mode?: string
  keywords?: string[]
  similarity?: number
  case_sensitive?: boolean
  ai_instruction?: string
  source?: string
  score?: string
  assign_to?: string
  assign_method?: 'pool' | 'specific' | 'round_robin' | 'least_busy'
  team_user_ids?: string[]
  also_assign_chat?: boolean
  sticky?: boolean
  skip_if_open_lead?: boolean
}

/** Older automations stored only assign_to ('pool' or a user id). */
export function leadAssignMethod(config: Pick<CreateLeadConfig, 'assign_method' | 'assign_to'>): 'pool' | 'specific' | 'round_robin' | 'least_busy' {
  if (config.assign_method) return config.assign_method
  return config.assign_to && config.assign_to !== 'pool' ? 'specific' : 'pool'
}

export interface CreateLeadOutcome {
  created: boolean
  /** One line for the automation log, written so somebody reading the
   *  run history can tell why nothing happened. A step that silently
   *  does nothing is the hardest kind of automation to debug. */
  detail: string
  leadId?: string
}

export async function createLeadFromAutomation(args: {
  accountId: string
  userId: string
  contactId: string
  conversationId?: string | null
  /** The message that triggered the run. Empty for a time-based or
   *  tag-based trigger, where there is nothing to match against. */
  message: string
  config: CreateLeadConfig
  /** The turn queue for round robin (e.g. "automation:<id>:lead"). */
  queueScope?: string
}): Promise<CreateLeadOutcome> {
  const { config } = args
  const mode = normalizeCreateLeadMode(config.match_mode)
  const keywords = (config.keywords ?? []).filter((k) => typeof k === 'string' && k.trim())

  // Default on: a second lead for somebody an agent is already working
  // is a duplicate, not an opportunity.
  if (config.skip_if_open_lead !== false) {
    const open = await prisma.lead.findFirst({
      where: {
        account_id: args.accountId,
        contact_id: args.contactId,
        status: { not: 'closed' },
        ai_suggested: false,
      },
      select: { id: true },
    })
    if (open) return { created: false, detail: 'skipped — already has an open lead' }
  }

  // ── Does this message qualify? ────────────────────────────────────

  let matchDetail = ''

  if (mode === 'ai') {
    const verdict = await askModel({
      accountId: args.accountId,
      message: args.message,
      instruction: config.ai_instruction ?? '',
    })
    if (verdict === 'no_key') {
      return { created: false, detail: 'skipped — no Gemini key saved for this account' }
    }
    if (verdict === 'error') {
      return { created: false, detail: 'skipped — the model could not be reached' }
    }
    if (verdict === false) return { created: false, detail: 'skipped — AI judged it not an enquiry' }
  } else if (keywords.length > 0) {
    if (!args.message.trim()) {
      return { created: false, detail: 'skipped — this trigger carries no message to match' }
    }
    const hit = matchKeywords(args.message, keywords, {
      mode,
      threshold: config.similarity,
      caseSensitive: config.case_sensitive === true,
    })
    if (!hit) return { created: false, detail: `skipped — no ${mode} match` }
    // The matched words go in the log, so a rule firing on the wrong
    // thing can be seen doing it rather than inferred.
    matchDetail = `matched "${hit.keyword}" on "${hit.matched}"`
  }

  // ── File it ───────────────────────────────────────────────────────

  const contact = await prisma.contact.findFirst({
    where: { id: args.contactId, account_id: args.accountId },
    select: { name: true, phone: true },
  })
  if (!contact) return { created: false, detail: 'skipped — contact not found' }

  // ── Who gets it ──────────────────────────────────────────────────
  const method = leadAssignMethod(config)
  let assignee: { userId: string; reason: string } | null = null
  let poolReason: string | null = null
  if (method !== 'pool') {
    const { chooseAssignee } = await import('@/lib/agents/assign')
    // The person already handling this customer's chat keeps them, if they
    // are here — a returning customer is not handed to a stranger.
    if (config.sticky !== false) {
      const chat = await prisma.conversation.findFirst({
        where: { account_id: args.accountId, contact_id: args.contactId, status: { not: 'closed' }, assigned_agent_id: { not: null } },
        orderBy: { last_message_at: 'desc' },
        select: { assigned_agent_id: true },
      })
      if (chat?.assigned_agent_id) {
        const { findAgents } = await import('@/lib/flows/agent-routing')
        const owner = (await findAgents({ accountId: args.accountId })).find((a) => a.userId === chat.assigned_agent_id)
        if (owner && owner.online && owner.onShift) assignee = { userId: owner.userId, reason: `${owner.fullName} — already handling this customer's chat` }
      }
    }
    if (!assignee) {
      const choice = await chooseAssignee({
        accountId: args.accountId,
        method: method === 'specific' ? 'specific' : method,
        userId: config.assign_to ?? null,
        teamUserIds: config.team_user_ids ?? null,
        scope: args.queueScope ?? 'lead-automation',
      })
      if (choice.userId) assignee = { userId: choice.userId, reason: choice.reason }
      else poolReason = choice.reason
    }
  }

  const lead = await prisma.lead.create({
    data: {
      account_id: args.accountId,
      user_id: args.userId,
      contact_id: args.contactId,
      title: contact.name || contact.phone,
      source: config.source?.trim() || 'whatsapp',
      status: 'new',
      ...(config.score?.trim() ? { score: config.score.trim() } : {}),
      ...(assignee ? { assigned_to: assignee.userId, claimed_at: new Date() } : {}),
    },
    select: { id: true },
  })

  if (assignee) {
    await announceAutoAssignment({
      accountId: args.accountId,
      leadId: lead.id,
      contactId: args.contactId,
      contactLabel: contact.name || contact.phone,
      userId: assignee.userId,
      reason: assignee.reason,
      method,
      alsoChat: config.also_assign_chat !== false,
    })
  } else if (poolReason) {
    await prisma.leadActivity
      .create({ data: { account_id: args.accountId, lead_id: lead.id, contact_id: args.contactId, type: 'note', title: 'Left in New Leads', description: poolReason } })
      .catch(() => {})
  }

  const why =
    mode === 'ai'
      ? 'AI judged this message a genuine enquiry'
      : matchDetail || 'the automation ran'

  await prisma.leadActivity
    .create({
      data: {
        account_id: args.accountId,
        lead_id: lead.id,
        contact_id: args.contactId,
        type: 'created',
        title: 'Lead created by an automation',
        description: why,
      },
    })
    .catch(() => {})

  return { created: true, detail: `lead created — ${why}`, leadId: lead.id }
}

/**
 * The assignment, made visible: on the lead's timeline (with the reason),
 * in the assignment log, as a push to the person, and — when asked — the
 * customer's open chat goes to the same person.
 */
async function announceAutoAssignment(args: {
  accountId: string
  leadId: string
  contactId: string
  contactLabel: string
  userId: string
  reason: string
  method: string
  alsoChat: boolean
}) {
  const { recordAssignment } = await import('@/lib/agents/assign')
  await prisma.leadActivity
    .create({ data: { account_id: args.accountId, lead_id: args.leadId, contact_id: args.contactId, type: 'assigned', title: 'Assigned automatically', description: args.reason } })
    .catch(() => {})
  await recordAssignment({ accountId: args.accountId, recordType: 'lead', recordId: args.leadId, previousUserId: null, newUserId: args.userId, source: 'automation', method: args.method, reason: args.reason })

  if (args.alsoChat) {
    const chats = await prisma.conversation.findMany({
      where: { account_id: args.accountId, contact_id: args.contactId, status: { not: 'closed' }, // NOT { = x } would skip unassigned chats (NULL), the very ones to move.
        OR: [{ assigned_agent_id: null }, { assigned_agent_id: { not: args.userId } }] },
      select: { id: true, assigned_agent_id: true },
    })
    for (const chat of chats) {
      // Only if nobody else took it meanwhile.
      const moved = await prisma.conversation.updateMany({ where: { id: chat.id, assigned_agent_id: chat.assigned_agent_id }, data: { assigned_agent_id: args.userId } })
      if (moved.count > 0) {
        await recordAssignment({ accountId: args.accountId, recordType: 'conversation', recordId: chat.id, previousUserId: chat.assigned_agent_id, newUserId: args.userId, source: 'automation', method: args.method, reason: `with their lead — ${args.reason}` })
        const updated = await prisma.conversation.findUnique({ where: { id: chat.id } })
        if (updated) {
          const { emitToAccount } = await import('@/lib/socket')
          emitToAccount(args.accountId, 'conversation', { eventType: 'UPDATE', new: updated, old: {} })
        }
      }
    }
  }

  const { sendPushToUser } = await import('@/lib/push')
  void sendPushToUser(args.userId, { title: 'New lead for you', body: args.contactLabel, tag: `lead-${args.leadId}`, data: { url: `/leads/${args.leadId}` } }).catch(() => {})
}

/**
 * Ask the model about one message.
 *
 * Falls back to the account's Lead Settings definition when the step
 * has no instruction of its own, so a business that has already written
 * down what counts as a lead does not have to write it again here.
 */
async function askModel(args: {
  accountId: string
  message: string
  instruction: string
}): Promise<boolean | 'no_key' | 'error'> {
  const text = args.message.trim()
  if (!text) return false

  const aiConfig = await prisma.aiConfig
    .findUnique({ where: { account_id: args.accountId }, select: { provider_keys: true } })
    .catch(() => null)
  const { apiKey } = aiConfig ? geminiCredentials(aiConfig) : { apiKey: null }
  if (!apiKey) return 'no_key'

  let criteria = args.instruction.trim()
  if (!criteria) {
    const settings = await loadAiLeadSettings(args.accountId)
    const signals = signalsFor(settings?.signals)
    criteria = [
      'Count it as an enquiry when any of these is true:',
      ...signals.map((s) => `- ${s.prompt}`),
      ...(settings?.rules ? ['', 'Also count:', settings.rules] : []),
      ...(settings?.exclusions ? ['', 'Never count:', settings.exclusions] : []),
    ].join('\n')
  }

  const started = Date.now()
  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: LEAD_DETECT_MODEL,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            is_enquiry: { type: SchemaType.BOOLEAN },
          },
          required: ['is_enquiry'],
        },
        ...(thinkingConfigFor(LEAD_DETECT_MODEL, 'minimal') ?? {}),
      },
    })

    const result = await model.generateContent(
      [
        'A customer sent a business the message below on WhatsApp.',
        'Answer one question: is this person making an enquiry the business should follow up?',
        '',
        criteria,
        '',
        'If you are unsure, answer no.',
        '',
        `Message: ${text.slice(0, 2000)}`,
      ].join('\n'),
    )

    void recordAiUsage({
      accountId: args.accountId,
      model: LEAD_DETECT_MODEL,
      feature: 'lead_detect',
      tokens: tokensFromGemini(result.response.usageMetadata),
      latencyMs: Date.now() - started,
    })

    const parsed = JSON.parse(result.response.text()) as { is_enquiry?: boolean }
    return parsed.is_enquiry === true
  } catch (err) {
    void recordAiUsage({
      accountId: args.accountId,
      model: LEAD_DETECT_MODEL,
      feature: 'lead_detect',
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - started,
    })
    console.error(
      '[create-lead] model call failed:',
      err instanceof Error ? err.message : err,
    )
    return 'error'
  }
}
