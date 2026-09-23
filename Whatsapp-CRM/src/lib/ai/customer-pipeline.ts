/**
 * One definition of how a customer-facing prompt is assembled, and one
 * definition of what happens to the answer afterwards.
 *
 * This exists because of the evaluation suite. A suite that runs a
 * *similar* pipeline to the live one measures nothing useful: it passes
 * while customers get bad replies, or fails on something no customer
 * would ever hit. The only version worth having runs the same assembly,
 * the same confidence rules and the same validator as the real path — so
 * those live here, and both callers use them.
 *
 * The flow engine keeps its own control flow (it has node-level
 * overrides and it actually sends messages); what it no longer keeps is
 * its own private copy of the prompt.
 */

import { loadCompanyProfile, formatCompanyBlock } from './company-profile'
import { localDate, localWeekday } from '@/lib/agents/zoned-time'
import { buildCustomerContext } from './customer-context'
import { loadKnowledge } from './knowledge-store'
import { selectRelevantContext, formatKnowledgeBlock, type SelectedContext } from './knowledge'
import { buildLanguageBlock } from './language'
import { assessConfidence, type ConfidenceAssessment } from './confidence'
import { validateReply, type ValidationResult } from './validator'
import { generateCustomerReply } from './customer-agent'
import { buildCustomerToolInstruction } from './customer-tools'
import { scanActionTokens } from './action-tokens'
import { checkSafetyGuard } from './safety-guard'
import { WHATSAPP_REPLY_STYLE } from '@/lib/whatsapp/markdown-to-whatsapp'
import { markdownToWhatsApp } from '@/lib/whatsapp/markdown-to-whatsapp'
import { getProviderKeys } from './providers/registry'
import { decrypt } from '@/lib/whatsapp/encryption'

/** The subset of AiConfig this module reads. Declared structurally so
 *  callers can pass a Prisma row or a per-node override of one. */
export interface CustomerAiConfig {
  id: string
  active_provider: string
  fallback_provider: string | null
  provider_keys: unknown
  temperature: number
  max_tokens: number
  safety_filter?: string
  /** How long the model may deliberate. See src/lib/ai/reasoning.ts —
   *  this is the largest single lever on how long a customer waits. */
  reasoning_effort?: string
  system_prompt: string | null
  fallback_answer: string | null
  escalation_topics: unknown
  reply_language: string | null
  knowledge_base_enabled: boolean
  retrieval_mode: string
  max_context_results: number
  customer_context_enabled: boolean
  confidence_threshold: number
  low_confidence_handoff_enabled: boolean
  composite_confidence_enabled: boolean
  response_validation_enabled: boolean
}

export interface PromptAssembly {
  systemPrompt: string
  knowledgeBlock: string
  companyBlock: string
  /** Today's date and the business's zone, so the model can resolve
   *  "tomorrow at nine" into something storable. */
  nowBlock: string
  /** The zone those dates are in — IANA, e.g. "Asia/Kolkata". */
  timezone: string
  customerContext: string
  /** The pieces the validator is allowed to treat as source material. */
  contextParts: string[]
}

/** Everything the prompt needs that is *not* the retrieved knowledge —
 *  who the business is, who this customer is, and what the assistant is
 *  allowed to do. Loaded separately so it can be started before
 *  retrieval finishes; see `loadPromptSources`. */
export interface PromptSources {
  companyBlock: string
  /** Today's date and the business's zone. A model has no clock, so
   *  without this it cannot turn "tomorrow at nine" into anything —
   *  which is exactly what a customer asking for a callback says. */
  nowBlock: string
  /** The zone those dates are in — IANA, e.g. "Asia/Kolkata". */
  timezone: string
  customerContext: string
  toolInstruction: string
}

/**
 * The three lookups the prompt needs, started together.
 *
 * Split out of `buildCustomerSystemPrompt` so the caller can start them
 * *before* awaiting retrieval. None of them depend on what retrieval
 * finds — the business's own profile, this customer's history and the
 * list of registration forms are the same whatever the customer asked —
 * so waiting for the embedding round trip before even beginning them was
 * pure stacked latency in the one place a customer is watching a typing
 * bubble.
 *
 * Every branch is caught: a prompt is better off missing a block than a
 * customer is waiting for a reply that never comes.
 */
export async function loadPromptSources(args: {
  aiConfig: Pick<CustomerAiConfig, 'customer_context_enabled'>
  accountId: string
  contactId: string | null
  currentChannel?: string
  toolsAvailable: boolean
}): Promise<PromptSources> {
  const [companyProfile, customerContext, toolInstruction] = await Promise.all([
    loadCompanyProfile(args.accountId).catch(() => null),
    args.aiConfig.customer_context_enabled && args.contactId
      ? buildCustomerContext({
          accountId: args.accountId,
          contactId: args.contactId,
          currentChannel: args.currentChannel ?? 'whatsapp',
        }).catch(() => '')
      : Promise.resolve(''),
    args.toolsAvailable
      ? buildCustomerToolInstruction(args.accountId).catch(() => '')
      : Promise.resolve(''),
  ])

  // ── What day it is, where the business is ──────────────────────
  //
  // A model has no clock. Without this it cannot turn "tomorrow at
  // nine" into anything, which is exactly what a customer asking for a
  // callback says — and the assistant was answering such messages
  // without ever being able to act on them.
  //
  // The zone matters as much as the date. A wall clock is not a moment
  // until you know whose wall it is on: "nine in the morning" is four
  // different instants for a business in Kerala, one in Dubai and a
  // server in Frankfurt, and being wrong means ringing somebody at six.
  const timezone = companyProfile?.timezone?.trim() || 'Asia/Kolkata'
  const today = localDate(timezone)
  const weekday = localWeekday(timezone)
  const nowBlock =
    today && weekday
      ? `Today is ${weekday}, ${today}. The business operates in the ${timezone} time zone — every date and time you are told, or that you record, is in that zone.`
      : ''

  return {
    companyBlock: formatCompanyBlock(companyProfile, 'customer') || '',
    customerContext,
    toolInstruction,
    nowBlock,
    timezone,
  }
}

/**
 * Builds the system prompt for one customer message.
 *
 * Order matters and is deliberate: who the business is, then who this
 * customer is, then what the assistant was told to be, then the
 * knowledge retrieved for this specific question. The model reads it as
 * context narrowing towards the task. Formatting rules go last so they
 * are the most recent instruction it sees.
 */
export async function buildCustomerSystemPrompt(args: {
  aiConfig: CustomerAiConfig
  accountId: string
  contactId: string | null
  customerMessage: string
  selected: SelectedContext
  currentChannel?: string
  /** A flow node's extra instruction for this one step, if any. */
  stepInstruction?: string | null
  /** True when this thread has been handed to a person and nobody has
   *  taken it yet. Changes what the assistant is for: acknowledging,
   *  not advising. */
  awaitingHuman?: boolean
  /** False when there is no contact to scope lookups to. */
  toolsAvailable: boolean
  /** Already in flight, or already resolved, from `loadPromptSources`.
   *  Omit and this loads them itself, which is what every caller that
   *  isn't racing a customer's patience should do. */
  sources?: PromptSources | Promise<PromptSources>
}): Promise<PromptAssembly> {
  const { aiConfig } = args
  const knowledgeBlock = formatKnowledgeBlock(args.selected)

  const { companyBlock, customerContext, toolInstruction, nowBlock, timezone } = await (args.sources ??
    loadPromptSources({
      aiConfig,
      accountId: args.accountId,
      contactId: args.contactId,
      currentChannel: args.currentChannel,
      toolsAvailable: args.toolsAvailable,
    }))

  const parts: string[] = [nowBlock, companyBlock, customerContext, aiConfig.system_prompt ?? '', knowledgeBlock]
    .filter((p) => Boolean(p && p.trim()))

  // Prompt-level guidance, not code-enforced — a model can ignore an
  // instruction. The validator below is the part that cannot be ignored.
  if (aiConfig.fallback_answer) {
    parts.push(
      `If the knowledge above doesn't contain a confident answer to the user's question, respond with exactly: "${aiConfig.fallback_answer}" — do not guess or make up an answer.`,
    )
  }

  const escalationTopics = Array.isArray(aiConfig.escalation_topics)
    ? (aiConfig.escalation_topics as string[])
    : []
  if (escalationTopics.length > 0) {
    parts.push(
      `If the user asks about any of: ${escalationTopics.join(', ')} — say a team member will follow up shortly, and don't try to answer it yourself.`,
    )
  }

  if (args.stepInstruction) parts.push(`Additionally, for this step: ${args.stepInstruction}`)

  // ── Somebody has already been promised a person ──────────────────
  //
  // This conversation was handed over and nobody has picked it up yet.
  // The assistant is still the only thing answering, and the failure to
  // avoid is not silence — it is carrying on as though the handover had
  // not happened.
  //
  // A real one: a customer wrote "please call me", was told a colleague
  // would ring them back, then said "I am retired from service", and was
  // asked whether they were interested in the training programmes. Two
  // things wrong at once. The business had just promised a call and then
  // started selling, and it offered staff training to somebody who had
  // just said they no longer work.
  //
  // So while a thread is waiting on a person, the assistant
  // acknowledges and stops. It does not open a new subject, and it does
  // not ask a question, because a question invites a reply that nobody
  // is there to answer.
  if (args.awaitingHuman) {
    parts.push(
      [
        'IMPORTANT — this conversation has already been passed to a colleague, and the customer has been told somebody will contact them.',
        'Acknowledge what they just said, briefly, and confirm that a colleague will be in touch. Nothing else.',
        'Do NOT ask a question. Do NOT introduce a new topic. Do NOT offer or suggest any service, product, course or programme, even if it seems relevant to what they wrote.',
        'If they have given information — a phone number, a time, a detail about themselves — say it has been noted and passed on.',
        'Two short sentences at most.',
      ].join(' '),
    )
  }

  // A language pinned in settings still wins when explicitly set;
  // otherwise it is inferred from what this customer actually wrote.
  if (aiConfig.reply_language) {
    parts.push(`Always reply in ${aiConfig.reply_language}, regardless of which language the customer writes in.`)
  } else {
    parts.push(buildLanguageBlock(args.customerMessage))
  }

  // Built per account rather than pinned: the registration half of
  // this instruction only applies to a business that has actually
  // opened a form, and telling every other assistant how to take a
  // registration is how one gets offered where none exists.
  if (toolInstruction) parts.push(toolInstruction)

  parts.push(WHATSAPP_REPLY_STYLE)

  return {
    systemPrompt: parts.join('\n\n') || 'You are a helpful assistant.',
    knowledgeBlock,
    companyBlock,
    nowBlock,
    timezone,
    customerContext,
    // The account's own prompt counts as source material.
    //
    // Caught by the evaluation suite: "Where are you located?" was
    // blocked for citing "8.9", and "Do you have hostel facilities?" for
    // citing "161" — the 8.90-acre campus and its bed count, both of
    // which this account had written into its system prompt rather than
    // into a knowledge entry. Treating the prompt as unciteable made the
    // validator reject correct answers, which is the failure mode that
    // gets a safety check switched off entirely.
    contextParts: [knowledgeBlock, companyBlock, customerContext, aiConfig.system_prompt ?? '']
      .filter(Boolean),
  }
}

/** Retrieves knowledge for one message, using the account's configured
 *  mode. Split out so the eval runner retrieves exactly as the live path
 *  does rather than approximating it. */
/** A message this short is almost certainly a reply rather than a
 *  question, and has too little in it to retrieve against alone. */
const SHORT_REPLY_CHARS = 25

export async function retrieveForMessage(args: {
  aiConfig: CustomerAiConfig
  customerMessage: string
  /** What was said just before, newest last. Used only to give a short
   *  reply something to retrieve against. */
  conversationHistory?: { role: 'user' | 'model'; text: string }[]
}): Promise<SelectedContext> {
  const { aiConfig } = args
  if (!aiConfig.knowledge_base_enabled) {
    return { qaPairs: [], documentChunks: [], confidence: 0 }
  }

  // 'customer' explicitly: this is what a real person receives, so
  // staff-only entries must not even enter the prompt.
  const { qaPairs, documents, version } = await loadKnowledge(aiConfig.id, 'customer')

  // What to search for.
  //
  // Usually the message itself. But "upcoming", "yes", "the second one"
  // carry their meaning in what came before them, and searching the
  // knowledge base for the word "upcoming" finds nothing useful — which
  // then reads as low confidence and hands a customer over in the middle
  // of answering a question the assistant asked them. For a short reply,
  // the previous turns are folded into the query so it inherits the
  // subject; the customer's own message still leads, so it dominates the
  // match.
  const trimmed = args.customerMessage.trim()
  const recent = (args.conversationHistory ?? []).slice(-2).map((h) => h.text).join(' ')
  const query =
    trimmed.length <= SHORT_REPLY_CHARS && recent ? `${trimmed} ${recent}`.slice(0, 500) : trimmed

  const geminiEntry = getProviderKeys(aiConfig).gemini
  const geminiApiKey = geminiEntry?.api_key ? decrypt(geminiEntry.api_key) : null
  const useSemantic = aiConfig.retrieval_mode !== 'keyword' && Boolean(geminiApiKey)
  const contextLimit = Math.max(1, aiConfig.max_context_results)

  return selectRelevantContext(query, qaPairs, documents, {
    cacheKey: `${aiConfig.id}:${version}`,
    maxQaPairs: contextLimit,
    maxDocChunks: contextLimit,
    ...(useSemantic ? { semantic: { aiConfigId: aiConfig.id, geminiApiKey: geminiApiKey! } } : {}),
  })
}

export type TurnDecision =
  | {
      action: 'reply'
      reply: string
      /** The model asked for a person *and* answered properly. Send the
       *  answer, and put the conversation in front of somebody too. */
      notifyHuman?: boolean
    }
  | {
      action: 'handoff'
      reason:
        | 'low_confidence'
        | 'unsupported_details'
        | 'model_requested'
        | 'safety'
        /** The provider refused or errored. In production this fetches a
         *  human rather than ending the run silently, so it is a handoff
         *  here too — anything else would have the suite contradicting
         *  the behaviour it exists to measure. */
        | 'generation_failed'
      /** Set for 'safety': what to tell the customer, and why. */
      safety?: { reason: string; customerMessage: string }
      /** Set for 'generation_failed': the provider's own message. */
      error?: string
    }

/**
 * What to do with the turn the model just produced.
 *
 * Order matters: an unverifiable figure is a stronger reason to stop
 * than the model politely asking for help, and the handoff note should
 * say the more serious thing.
 *
 * ── Why asking for a human no longer silences the answer ────────────
 *
 * The other handoff reasons all mean the same thing: *this reply cannot
 * be trusted*. Low confidence, a figure the retrieved context does not
 * support, the safety filter, a provider error — in every one of those
 * the right move is to throw the draft away and fetch a person.
 *
 * "The model asked for a human" is not that. The reply is usually fine;
 * the model has simply been told to flag something. This account's own
 * prompt says it outright: "append [ACTION: TRIGGER_HUMAN_ADMIN] to your
 * response **so the backend can flag the ticket**" — a request to raise
 * a ticket, not to stop helping. Treating it as a full handoff meant a
 * customer who said "I want to register" got their answer deleted and
 * replaced with "let me connect you with a team member", from an
 * assistant that was by then perfectly able to register them.
 *
 * So a flagged reply is now sent *and* escalated. The account gets its
 * ticket, the customer gets their answer, and neither has to be traded
 * for the other.
 *
 * A token on its own, with no real reply behind it, still hands over —
 * there is nothing to send, and silence would be worse.
 */
export function decideTurn(args: {
  validation: ValidationResult | null
  modelAskedForHuman: boolean
  reply: string
}): TurnDecision {
  if (args.validation && !args.validation.ok) return { action: 'handoff', reason: 'unsupported_details' }
  if (args.modelAskedForHuman) {
    // Short enough to be a bare acknowledgement rather than an answer:
    // nothing worth sending, so this is a real handoff.
    if (args.reply.trim().length < 15) return { action: 'handoff', reason: 'model_requested' }
    return { action: 'reply', reply: args.reply, notifyHuman: true }
  }
  return { action: 'reply', reply: args.reply }
}

/**
 * The phases of one turn, so a slow reply can be explained rather than
 * guessed at.
 *
 * Every field is wall-clock milliseconds. `retrieval` and `promptSources`
 * overlap deliberately (see `runCustomerTurn`), so they do not sum to
 * the total and are not meant to.
 */
export interface TurnTimings {
  /** Loading the knowledge base and finding what matches this message. */
  retrieval: number
  /** Embedding the customer's message — a provider round trip inside
   *  `retrieval`, called out because it is usually the larger half. */
  embedding: number
  /** The business profile, this customer's history, the tool list. */
  promptSources: number
  /** The model itself, including every tool round. Nearly always the
   *  biggest number here, which is why reasoning effort is a setting. */
  generation: number
  /** The validator and the confidence rules. Pure CPU; should be small,
   *  and worth noticing on the day it isn't. */
  checks: number
  total: number
}

/** One line for a log, ordered biggest-cost-last so the eye lands on the
 *  model. Kept here rather than at the call site so the evaluation suite
 *  and the live path describe a slow turn the same way. */
export function formatTurnTimings(t: TurnTimings, extra?: Record<string, string | number>): string {
  const parts = [
    `total=${t.total}ms`,
    `retrieval=${t.retrieval}ms(embed=${t.embedding}ms)`,
    `prompt=${t.promptSources}ms`,
    `checks=${t.checks}ms`,
    `model=${t.generation}ms`,
  ]
  for (const [k, v] of Object.entries(extra ?? {})) parts.push(`${k}=${v}`)
  return parts.join(' ')
}

export interface CustomerTurnResult {
  decision: TurnDecision
  /** Present unless the turn handed off before generating. */
  reply: string | null
  confidence: ConfidenceAssessment
  effectiveConfidence: number
  validation: ValidationResult | null
  selected: SelectedContext
  systemPrompt: string
  toolsUsed: string[]
  knowledgeUsed: string[]
  truncated: boolean
  /** A chatbot took the conversation over. The caller must not send
   *  `reply` — the bot has already spoken. */
  handedToChatbot: boolean
  latencyMs: number
  /** Where the time actually went, in milliseconds. Recorded on every
   *  turn rather than behind a debug flag, because "the reply is slow"
   *  is reported after the fact and never reproduces on demand — a
   *  number that only exists while somebody is watching is a number
   *  nobody ever has. See `formatTurnTimings`. */
  timings: TurnTimings
  /** What the provider counted for this turn. Null on the paths that
   *  hand off before the model is called at all — a real zero, not a
   *  missing number. The generator has always returned these; nothing
   *  carried them out to the caller, so every customer reply was
   *  recorded as costing nothing. */
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null
}

/**
 * Runs one complete customer turn and returns what should happen,
 * without sending anything.
 *
 * The engine uses its own control flow around these same pieces because
 * it also has to send, log and advance a flow run. The evaluation suite
 * uses this, so a suite result means "this is what the customer would
 * have received".
 */
export async function runCustomerTurn(args: {
  aiConfig: CustomerAiConfig
  accountId: string
  contactId: string | null
  customerMessage: string
  conversationHistory?: { role: 'user' | 'model'; text: string }[]
  currentChannel?: string
  /** Both, or neither. Present only on a live thread, and what makes
   *  handing the conversation to a chatbot possible at all — see
   *  customer-tools' start_chatbot. */
  conversationId?: string
  userId?: string
  /** This conversation is already waiting on a colleague. The assistant
   *  keeps answering — going quiet would strand a customer nobody has
   *  picked up — but it acknowledges rather than advises. See the block
   *  it turns on in buildCustomerSystemPrompt. */
  awaitingHuman?: boolean
}): Promise<CustomerTurnResult> {
  const startedAt = Date.now()
  const history = args.conversationHistory ?? []
  const timings: TurnTimings = {
    retrieval: 0,
    embedding: 0,
    promptSources: 0,
    generation: 0,
    checks: 0,
    total: 0,
  }
  const finish = () => {
    timings.total = Date.now() - startedAt
    return timings
  }

  // Checked before anything else, including retrieval.
  //
  // These requests are well-formed questions that match the knowledge
  // base — confidence on them ran 0.59-0.62 in testing — so no
  // confidence threshold will ever catch them. And a prompt instruction
  // is the wrong defence against an attempt to talk a model out of its
  // prompt. The model is simply not asked.
  const safety = checkSafetyGuard(args.customerMessage)
  if (safety) {
    return {
      decision: {
        action: 'handoff',
        reason: 'safety',
        safety: { reason: safety.reason, customerMessage: safety.customerMessage },
      },
      reply: null,
      confidence: assessConfidence({ retrievalConfidence: 0, customerMessage: args.customerMessage }),
      effectiveConfidence: 0,
      validation: null,
      selected: { qaPairs: [], documentChunks: [], confidence: 0 },
      systemPrompt: '',
      toolsUsed: [],
      knowledgeUsed: [],
      truncated: false,
      handedToChatbot: false,
      latencyMs: Date.now() - startedAt,
      timings: finish(),
      usage: null,
    }
  }

  const toolContext = args.contactId
    ? {
        accountId: args.accountId,
        contactId: args.contactId,
        ...(args.conversationId && args.userId
          ? { conversationId: args.conversationId, userId: args.userId }
          : {}),
      }
    : null

  // Started here, not after retrieval, and this is the point.
  //
  // The business's own profile, this customer's history and the list of
  // registration forms are the same whatever the customer just asked, so
  // none of them has any reason to wait for an embedding round trip and
  // a vector search to finish first. Stacked, those two phases were the
  // whole gap between "message received" and "model called"; overlapped,
  // the shorter one is free.
  //
  // The handoff path below returns before using this. That costs a few
  // database reads nobody looks at, on the minority of turns that hand
  // over — a fair trade for taking it off the majority that don't. Every
  // branch inside is caught, so an unused promise cannot reject.
  const sourcesStartedAt = Date.now()
  const sourcesPromise = loadPromptSources({
    aiConfig: args.aiConfig,
    accountId: args.accountId,
    contactId: args.contactId,
    currentChannel: args.currentChannel,
    toolsAvailable: Boolean(toolContext),
  }).then((sources) => {
    timings.promptSources = Date.now() - sourcesStartedAt
    return sources
  })

  const retrievalStartedAt = Date.now()
  const selected = await retrieveForMessage({
    aiConfig: args.aiConfig,
    customerMessage: args.customerMessage,
    conversationHistory: history,
  })
  timings.retrieval = Date.now() - retrievalStartedAt
  timings.embedding = selected.embeddingMs ?? 0

  const knowledgeUsed = [
    ...selected.qaPairs.map((q) => q.question),
    ...selected.documentChunks.map((d) => d.title),
  ]

  const checksStartedAt = Date.now()
  const confidence = assessConfidence({
    retrievalConfidence: selected.confidence,
    customerMessage: args.customerMessage,
    recentCustomerMessages: history.filter((m) => m.role === 'user').map((m) => m.text),
    // With the speakers, so "asked again" can mean what it says: we
    // answered and it did not land, rather than the same message
    // arriving twice.
    conversationTurns: history,
    knowledgeEmpty: selected.qaPairs.length === 0 && selected.documentChunks.length === 0,
    // The assistant spoke last, so this message is a reply to it. Short
    // does not mean unclear when it answers a question we just asked.
    isAnsweringOurQuestion: history.length > 0 && history[history.length - 1]?.role === 'model',
  })
  const effectiveConfidence = args.aiConfig.composite_confidence_enabled
    ? confidence.score
    : selected.confidence
  timings.checks += Date.now() - checksStartedAt

  if (
    args.aiConfig.low_confidence_handoff_enabled &&
    effectiveConfidence < args.aiConfig.confidence_threshold
  ) {
    return {
      decision: { action: 'handoff', reason: 'low_confidence' },
      reply: null,
      confidence,
      effectiveConfidence,
      validation: null,
      selected,
      systemPrompt: '',
      toolsUsed: [],
      knowledgeUsed,
      truncated: false,
      handedToChatbot: false,
      latencyMs: Date.now() - startedAt,
      timings: finish(),
      usage: null,
    }
  }

  const assembly = await buildCustomerSystemPrompt({
    aiConfig: args.aiConfig,
    accountId: args.accountId,
    contactId: args.contactId,
    customerMessage: args.customerMessage,
    selected,
    currentChannel: args.currentChannel,
    toolsAvailable: Boolean(toolContext),
    sources: sourcesPromise,
    awaitingHuman: args.awaitingHuman,
  })

  // A provider refusal is a handoff, not an exception for the caller to
  // deal with. Gemini's safety filter blocks exactly the messages that
  // most need a person — an angry complaint, a third-time-asking
  // customer — and the flow engine already responds by fetching one.
  // Catching it here means the evaluation suite measures that same
  // behaviour instead of reporting a crash.
  let generated: Awaited<ReturnType<typeof generateCustomerReply>>
  const generationStartedAt = Date.now()
  try {
    generated = await generateCustomerReply({
      aiConfig: args.aiConfig,
      systemPrompt: assembly.systemPrompt,
      userMessage: args.customerMessage,
      conversationHistory: history,
      toolContext,
    })
    timings.generation = Date.now() - generationStartedAt
  } catch (err) {
    timings.generation = Date.now() - generationStartedAt
    return {
      decision: {
        action: 'handoff',
        reason: 'generation_failed',
        error: err instanceof Error ? err.message : String(err),
      },
      reply: null,
      confidence,
      effectiveConfidence,
      validation: null,
      selected,
      systemPrompt: assembly.systemPrompt,
      toolsUsed: [],
      knowledgeUsed,
      truncated: false,
      handedToChatbot: false,
      latencyMs: Date.now() - startedAt,
      timings: finish(),
      usage: null,
    }
  }

  // An account's prompt may instruct the model to append a directive
  // like [ACTION: TRIGGER_HUMAN_ADMIN]. Stripped from what the customer
  // sees, and honoured as a real handoff rather than sent as text.
  const scanned = scanActionTokens(generated.reply)
  const reply = markdownToWhatsApp(scanned.cleanedText)
  const modelAskedForHuman = scanned.actions.includes('handoff')

  const validationStartedAt = Date.now()
  let validation: ValidationResult | null = null
  if (args.aiConfig.response_validation_enabled) {
    validation = validateReply({
      reply,
      contextParts: [
        ...assembly.contextParts,
        ...generated.toolOutputs,
        args.customerMessage,
        ...history.map((m) => m.text),
      ],
    })
  }
  timings.checks += Date.now() - validationStartedAt

  return {
    decision: decideTurn({ validation, modelAskedForHuman, reply }),
    reply,
    confidence,
    effectiveConfidence,
    validation,
    selected,
    systemPrompt: assembly.systemPrompt,
    toolsUsed: generated.toolsUsed,
    knowledgeUsed,
    truncated: generated.truncated,
    handedToChatbot: generated.handedToChatbot,
    latencyMs: Date.now() - startedAt,
    timings: finish(),
    usage: generated.usage ?? null,
  }
}
