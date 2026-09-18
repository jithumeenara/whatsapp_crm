/**
 * Generating a customer reply, with the option of looking things up.
 *
 * Sits in front of `generateAiReplyWithFallback` rather than replacing
 * it. Function calling is a Gemini-specific protocol here, and the
 * account may be running on any of five providers — so this module takes
 * the tool path when it can and hands straight back to the existing
 * provider-agnostic path when it cannot. An account on DeepSeek keeps
 * working exactly as before; it just does not get lookups.
 *
 * Two details were established by debugging the Admin assistant against
 * the live API and apply identically here:
 *
 *   1. Tool results must be sent back under role `'user'`. The SDK's
 *      ChatSession wraps them in role `'function'` — the older v1beta
 *      convention — and current models reject that with a 400.
 *   2. The model's own turn must be echoed back **verbatim**, from
 *      `candidates[0].content`, not reconstructed from `functionCalls()`.
 *      Gemini 3.x attaches a `thoughtSignature` to function-call parts,
 *      and rebuilding the turn drops it, producing "Function call is
 *      missing a thought_signature".
 */

import { GoogleGenerativeAI, type Content } from '@google/generative-ai'
import {
  generateAiReplyWithFallback,
  getProviderKeys,
  type AiReplyResult,
} from './providers/registry'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  CUSTOMER_TOOL_DECLARATIONS,
  runCustomerTool,
  type CustomerToolContext,
} from './customer-tools'
import { thinkingConfigFor, isThinkingRejection } from './reasoning'

/** Enough rounds for "look up their enquiry, then check the catalog",
 *  which is the deepest real chain seen. Past this the model is looping
 *  rather than working, and the customer is still waiting. */
const MAX_TOOL_ROUNDS = 4

/** Matches the ceiling used on every other provider call in this app.
 *  Node's fetch has no default timeout — without this a hung provider
 *  waits forever and the customer simply never gets a reply. */
const AI_REQUEST_TIMEOUT_MS = 20_000

export type CustomerReplyResult = AiReplyResult & {
  /** Tool names actually called, in order. Empty when the reply was
   *  generated without lookups, which is the common case. */
  toolsUsed: string[]
  /** Everything the tools returned, serialized. Passed to the validator
   *  as legitimate source material — a price that came from the catalog
   *  is supported even though it appears in no knowledge document. */
  toolOutputs: string[]
}

export async function generateCustomerReply(args: {
  aiConfig: {
    active_provider: string
    fallback_provider: string | null
    provider_keys: unknown
    temperature: number
    max_tokens: number
    safety_filter?: string
    reasoning_effort?: string
  }
  systemPrompt: string
  userMessage: string
  conversationHistory: { role: 'user' | 'model'; text: string }[]
  /** Absent, or tools disabled, means the plain provider-agnostic path. */
  toolContext?: CustomerToolContext | null
}): Promise<CustomerReplyResult> {
  const geminiEntry = getProviderKeys(args.aiConfig).gemini

  const canUseTools =
    Boolean(args.toolContext) &&
    args.aiConfig.active_provider === 'gemini' &&
    Boolean(geminiEntry?.api_key)

  if (!canUseTools) {
    const plain = await generateAiReplyWithFallback(
      args.aiConfig,
      args.systemPrompt,
      args.userMessage,
      args.conversationHistory,
    )
    return { ...plain, toolsUsed: [], toolOutputs: [] }
  }

  try {
    return await runToolLoop({
      apiKey: decrypt(geminiEntry!.api_key),
      model: geminiEntry!.model || 'gemini-3.6-flash',
      temperature: args.aiConfig.temperature,
      maxTokens: args.aiConfig.max_tokens,
      systemPrompt: args.systemPrompt,
      userMessage: args.userMessage,
      conversationHistory: args.conversationHistory,
      toolContext: args.toolContext!,
      reasoningEffort: args.aiConfig.reasoning_effort,
    })
  } catch (err) {
    // A failure in the tool path must not cost the customer their
    // reply. The plain path uses the same key and model and has its own
    // fallback provider, so it is a genuine second chance rather than a
    // retry of the same thing.
    console.error('[customer-agent] tool path failed, falling back:', err instanceof Error ? err.message : err)
    const plain = await generateAiReplyWithFallback(
      args.aiConfig,
      args.systemPrompt,
      args.userMessage,
      args.conversationHistory,
    )
    return { ...plain, toolsUsed: [], toolOutputs: [] }
  }
}

async function runToolLoop(args: {
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
  systemPrompt: string
  userMessage: string
  conversationHistory: { role: 'user' | 'model'; text: string }[]
  toolContext: CustomerToolContext
  reasoningEffort?: string
}): Promise<CustomerReplyResult> {
  const genAI = new GoogleGenerativeAI(args.apiKey)

  // Thinking costs the customer seconds on every round of this loop, not
  // just the first — a registration that needs two tool calls pays it
  // three times. See src/lib/ai/reasoning.ts for why the default is
  // lower than Gemini's own.
  const thinking = thinkingConfigFor(args.model, args.reasoningEffort)
  const buildModel = (withThinking: object | undefined) =>
    genAI.getGenerativeModel(
      {
        model: args.model,
        systemInstruction: args.systemPrompt,
        tools: [{ functionDeclarations: CUSTOMER_TOOL_DECLARATIONS }],
        generationConfig: {
          temperature: args.temperature,
          maxOutputTokens: args.maxTokens,
          ...(withThinking ?? {}),
        },
      },
      { timeout: AI_REQUEST_TIMEOUT_MS },
    )

  let model = buildModel(thinking)
  let thinkingDropped = false

  /** One generation, retrying without the thinking parameter the first
   *  time a model turns out not to accept it. Every round goes through
   *  here, so the retry cannot be needed twice. */
  const generate = async (contents: Content[]) => {
    try {
      return await model.generateContent({ contents })
    } catch (err) {
      if (thinkingDropped || !thinking || !isThinkingRejection(err)) throw err
      console.warn('[customer-agent] model rejected the thinking level, retrying without it:', args.model)
      thinkingDropped = true
      model = buildModel(undefined)
      return model.generateContent({ contents })
    }
  }

  const contents: Content[] = [
    ...args.conversationHistory.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    { role: 'user', parts: [{ text: args.userMessage }] },
  ]

  const toolsUsed: string[] = []
  const toolOutputs: string[] = []
  let inputTokens = 0
  let outputTokens = 0

  const addUsage = (usage: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined) => {
    inputTokens += usage?.promptTokenCount ?? 0
    outputTokens += usage?.candidatesTokenCount ?? 0
  }

  let result = await generate(contents)
  addUsage(result.response.usageMetadata)

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const calls = result.response.functionCalls()
    if (!calls || calls.length === 0) break

    // Verbatim, not rebuilt from `calls` — see this file's header for
    // why (thought signatures).
    const modelTurn = result.response.candidates?.[0]?.content
    if (!modelTurn) break
    contents.push(modelTurn)

    // Concurrently, because the model asked for them concurrently.
    //
    // When Gemini returns two function calls in one turn it has decided
    // it needs both before it can answer; running them one after the
    // other made the customer wait for the sum of two database round
    // trips to satisfy a model that was going to wait for both anyway.
    // Order is preserved — Promise.all resolves positionally — so the
    // responses still line up with the calls that asked for them, which
    // the protocol requires.
    const outputs = await Promise.all(
      calls.map((call) =>
        runCustomerTool(
          call.name,
          (call.args ?? {}) as Record<string, unknown>,
          args.toolContext,
        ),
      ),
    )

    const responseParts = calls.map((call, i) => {
      toolsUsed.push(call.name)
      const output = outputs[i]
      toolOutputs.push(JSON.stringify(output))
      return {
        functionResponse: {
          name: call.name,
          // The SDK requires an object; primitives and arrays are
          // wrapped so a tool returning a list doesn't fail the turn.
          response: (output && typeof output === 'object' && !Array.isArray(output)
            ? output
            : { result: output }) as object,
        },
      }
    })

    // 'user', not 'function' — see this file's header.
    contents.push({ role: 'user', parts: responseParts })
    result = await generate(contents)
    addUsage(result.response.usageMetadata)
  }

  const finishReason = result.response.candidates?.[0]?.finishReason

  return {
    reply: result.response.text() ?? '',
    usedProvider: 'gemini',
    usedFallback: false,
    usedModel: args.model,
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    truncated: finishReason === 'MAX_TOKENS',
    toolsUsed,
    toolOutputs,
  }
}
