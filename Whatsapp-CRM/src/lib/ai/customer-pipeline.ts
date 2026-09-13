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
import { buildCustomerContext } from './customer-context'
import { loadKnowledge } from './knowledge-store'
import { selectRelevantContext, formatKnowledgeBlock, type SelectedContext } from './knowledge'
import { buildLanguageBlock } from './language'
import { assessConfidence, type ConfidenceAssessment } from './confidence'
import { validateReply, type ValidationResult } from './validator'
import { generateCustomerReply } from './customer-agent'
import { CUSTOMER_TOOL_INSTRUCTION } from './customer-tools'
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
  customerContext: string
  /** The pieces the validator is allowed to treat as source material. */
  contextParts: string[]
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
  /** False when there is no contact to scope lookups to. */
  toolsAvailable: boolean
}): Promise<PromptAssembly> {
  const { aiConfig } = args
  const knowledgeBlock = formatKnowledgeBlock(args.selected)

  // Neither depends on the other, and this sits directly between a
  // customer's message and their reply, so the two round trips overlap
  // rather than stack.
  const [companyProfile, customerContext] = await Promise.all([
    loadCompanyProfile(args.accountId).catch(() => null),
    aiConfig.customer_context_enabled && args.contactId
      ? buildCustomerContext({
          accountId: args.accountId,
          contactId: args.contactId,
          currentChannel: args.currentChannel ?? 'whatsapp',
        }).catch(() => '')
      : Promise.resolve(''),
  ])

  const companyBlock = formatCompanyBlock(companyProfile, 'customer') || ''

  const parts: string[] = [companyBlock, customerContext, aiConfig.system_prompt ?? '', knowledgeBlock]
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

  // A language pinned in settings still wins when explicitly set;
  // otherwise it is inferred from what this customer actually wrote.
  if (aiConfig.reply_language) {
    parts.push(`Always reply in ${aiConfig.reply_language}, regardless of which language the customer writes in.`)
  } else {
    parts.push(buildLanguageBlock(args.customerMessage))
  }

  if (args.toolsAvailable) parts.push(CUSTOMER_TOOL_INSTRUCTION)

  parts.push(WHATSAPP_REPLY_STYLE)

  return {
    systemPrompt: parts.join('\n\n') || 'You are a helpful assistant.',
    knowledgeBlock,
    companyBlock,
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
export async function retrieveForMessage(args: {
  aiConfig: CustomerAiConfig
  customerMessage: string
}): Promise<SelectedContext> {
  const { aiConfig } = args
  if (!aiConfig.knowledge_base_enabled) {
    return { qaPairs: [], documentChunks: [], confidence: 0 }
  }

  // 'customer' explicitly: this is what a real person receives, so
  // staff-only entries must not even enter the prompt.
  const { qaPairs, documents, version } = await loadKnowledge(aiConfig.id, 'customer')

  const geminiEntry = getProviderKeys(aiConfig).gemini
  const geminiApiKey = geminiEntry?.api_key ? decrypt(geminiEntry.api_key) : null
  const useSemantic = aiConfig.retrieval_mode !== 'keyword' && Boolean(geminiApiKey)
  const contextLimit = Math.max(1, aiConfig.max_context_results)

  return selectRelevantContext(args.customerMessage, qaPairs, documents, {
    cacheKey: `${aiConfig.id}:${version}`,
    maxQaPairs: contextLimit,
    maxDocChunks: contextLimit,
    ...(useSemantic ? { semantic: { aiConfigId: aiConfig.id, geminiApiKey: geminiApiKey! } } : {}),
  })
}

export type TurnDecision =
  | { action: 'reply'; reply: string }
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

/** Order matters: an unverifiable figure is a stronger reason to stop
 *  than the model politely asking for help, and the handoff note should
 *  say the more serious thing. */
function decideTurn(args: {
  validation: ValidationResult | null
  modelAskedForHuman: boolean
  reply: string
}): TurnDecision {
  if (args.validation && !args.validation.ok) return { action: 'handoff', reason: 'unsupported_details' }
  if (args.modelAskedForHuman) return { action: 'handoff', reason: 'model_requested' }
  return { action: 'reply', reply: args.reply }
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
  latencyMs: number
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
}): Promise<CustomerTurnResult> {
  const startedAt = Date.now()
  const history = args.conversationHistory ?? []

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
      latencyMs: Date.now() - startedAt,
    }
  }

  const selected = await retrieveForMessage({ aiConfig: args.aiConfig, customerMessage: args.customerMessage })

  const knowledgeUsed = [
    ...selected.qaPairs.map((q) => q.question),
    ...selected.documentChunks.map((d) => d.title),
  ]

  const confidence = assessConfidence({
    retrievalConfidence: selected.confidence,
    customerMessage: args.customerMessage,
    recentCustomerMessages: history.filter((m) => m.role === 'user').map((m) => m.text),
    knowledgeEmpty: selected.qaPairs.length === 0 && selected.documentChunks.length === 0,
  })
  const effectiveConfidence = args.aiConfig.composite_confidence_enabled
    ? confidence.score
    : selected.confidence

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
      latencyMs: Date.now() - startedAt,
    }
  }

  const toolContext = args.contactId
    ? { accountId: args.accountId, contactId: args.contactId }
    : null

  const assembly = await buildCustomerSystemPrompt({
    aiConfig: args.aiConfig,
    accountId: args.accountId,
    contactId: args.contactId,
    customerMessage: args.customerMessage,
    selected,
    currentChannel: args.currentChannel,
    toolsAvailable: Boolean(toolContext),
  })

  // A provider refusal is a handoff, not an exception for the caller to
  // deal with. Gemini's safety filter blocks exactly the messages that
  // most need a person — an angry complaint, a third-time-asking
  // customer — and the flow engine already responds by fetching one.
  // Catching it here means the evaluation suite measures that same
  // behaviour instead of reporting a crash.
  let generated: Awaited<ReturnType<typeof generateCustomerReply>>
  try {
    generated = await generateCustomerReply({
      aiConfig: args.aiConfig,
      systemPrompt: assembly.systemPrompt,
      userMessage: args.customerMessage,
      conversationHistory: history,
      toolContext,
    })
  } catch (err) {
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
      latencyMs: Date.now() - startedAt,
    }
  }

  // An account's prompt may instruct the model to append a directive
  // like [ACTION: TRIGGER_HUMAN_ADMIN]. Stripped from what the customer
  // sees, and honoured as a real handoff rather than sent as text.
  const scanned = scanActionTokens(generated.reply)
  const reply = markdownToWhatsApp(scanned.cleanedText)
  const modelAskedForHuman = scanned.actions.includes('handoff')

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
    latencyMs: Date.now() - startedAt,
  }
}
