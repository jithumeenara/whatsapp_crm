/**
 * The admin data assistant: a question about this account's own CRM data
 * → an answer computed by the read-only tools in tools.ts.
 *
 * Used by Settings → AI → Test (Admin) and by Admin Chat on WhatsApp and
 * Telegram. The model never writes a query; it can only pick from the
 * tools it is given, and every tool is scoped by the accountId passed in
 * here — never by anything the model said.
 */

import { GoogleGenerativeAI, FinishReason, FunctionCallingMode, type Content, type FunctionDeclaration } from '@google/generative-ai'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getProviderKeys } from '@/lib/ai/providers/registry'
import { AI_REQUEST_TIMEOUT_MS } from '@/lib/ai/providers/types'
import { TOOL_DECLARATIONS, runTool } from '@/lib/ai/insights/tools'
import { recordAiUsage, type UsageFeature } from '@/lib/ai/usage'
import { tokensFromGemini, type GeminiUsageMetadata } from '@/lib/ai/pricing'
import { loadCompanyProfile, formatCompanyBlock } from '@/lib/ai/company-profile'
import { businessTimezone } from '@/lib/ai/human-date'
import { localNow } from '@/lib/admin-chat/rules'

/** How many tool round trips one question may take. Real questions
 *  resolve in one or two; the cap stops a confused model from looping. */
const MAX_TOOL_ROUNDS = 4

const BASE_SYSTEM_PROMPT = `You are the internal data assistant for this WhatsApp CRM account. You are talking to an owner or admin of the business, not to a customer.

Answer questions about their CRM data by calling the provided tools. When a question names a phone or WhatsApp number, call find_by_phone once — it searches every table, sheet, contact and enquiry for that number. Never invent a number: if a tool didn't return it, say you don't have it. If a question needs data no tool provides, say so plainly and suggest the closest thing you can actually answer.

Formatting: when a result has more than two rows, present it as a Markdown table with clear column headers. Put the single most important number in a short sentence before or after the table. Keep answers brief — this is an operations dashboard, not an essay.`

/** Tools that return named people (contacts, enquiry rows, table rows). */
export const PERSONAL_DATA_TOOLS = ['find_by_phone', 'recent_enquiries', 'read_data_table'] as const

export class AdminAnswerError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'AdminAnswerError'
  }
}

export interface AdminAnswer {
  reply: string
  toolsUsed: string[]
  truncated: boolean
}

export async function answerAdminQuestion(args: {
  accountId: string
  message: string
  history?: Array<{ role: 'user' | 'model'; text: string }>
  /** Only these tools may be called (enforced here, not just offered). */
  allowedTools?: readonly string[]
  /** Added after the account's own instructions (e.g. chat formatting). */
  extraInstruction?: string
  feature?: UsageFeature
  /** More tools for this turn only (Admin Chat's propose_* actions). */
  extraTools?: { declarations: FunctionDeclaration[]; names: string[]; run: (name: string, args: Record<string, unknown>) => Promise<unknown> }
}): Promise<AdminAnswer> {
  const { accountId, message } = args
  const config = await prisma.aiConfig.findUnique({ where: { account_id: accountId } })
  const geminiEntry = config ? getProviderKeys(config).gemini : undefined
  if (!geminiEntry?.api_key) {
    throw new AdminAnswerError('Admin Test needs a saved Google Gemini key — it uses Gemini function calling to read your data.', 400)
  }

  // Today in the business's own zone, worked out per question — a date
  // fixed when the server started was days stale on a long-running server.
  const zone = await businessTimezone(accountId)
  const today = localNow(zone).date

  // Three parts: the fixed behaviour above, what this business is, and
  // whatever the account added in Settings (admin_system_prompt, kept
  // separate from the customer-facing prompt).
  const companyProfile = await loadCompanyProfile(accountId).catch(() => null)
  const systemInstruction = [
    BASE_SYSTEM_PROMPT,
    `Today's date is ${today} (${zone}). When the user says "this month", "last week" and similar, translate it into the days_back argument the tools accept.`,
    formatCompanyBlock(companyProfile, 'admin') || undefined,
    config?.admin_system_prompt?.trim() || undefined,
    args.extraInstruction,
  ]
    .filter(Boolean)
    .join('\n\n')

  const allowed = args.allowedTools ? new Set(args.allowedTools) : null
  const declarations = [
    ...(allowed ? TOOL_DECLARATIONS.filter((d) => allowed.has(d.name)) : TOOL_DECLARATIONS),
    ...(args.extraTools?.declarations ?? []),
  ]
  const extraNames = new Set(args.extraTools?.names ?? [])

  const genAI = new GoogleGenerativeAI(decrypt(geminiEntry.api_key))
  const model = genAI.getGenerativeModel(
    {
      model: geminiEntry.model,
      systemInstruction,
      tools: [{ functionDeclarations: declarations }],
      // Gemini 3's default temperature (1.0): the figures come from the
      // tools, and Google warns lower values can loop on multi-step work.
      generationConfig: { maxOutputTokens: 2048 },
    },
    { timeout: AI_REQUEST_TIMEOUT_MS },
  )

  const history = (args.history ?? [])
    .filter((m) => m.text?.trim())
    .map((m) => ({ role: m.role, parts: [{ text: m.text }] }))

  const startedAt = Date.now()
  let inputTokens = 0
  let outputTokens = 0
  const addUsage = (meta?: GeminiUsageMetadata) => {
    const t = tokensFromGemini(meta)
    inputTokens += t.inputTokens
    outputTokens += t.outputTokens
  }
  const feature = args.feature ?? 'chat_admin'

  try {
    // Contents are built explicitly: ChatSession wraps tool results in a
    // 'function' role this model rejects; results go back under 'user'.
    const contents: Content[] = [...history, { role: 'user', parts: [{ text: message }] }]

    let result = await model.generateContent({ contents })
    addUsage(result.response.usageMetadata)
    const toolsUsed: string[] = []

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const calls = result.response.functionCalls()
      if (!calls || calls.length === 0) break
      // The model's own turn goes back verbatim: Gemini 3 needs the
      // thoughtSignature it attached to each function call.
      const modelTurn = result.response.candidates?.[0]?.content
      if (!modelTurn) break
      contents.push(modelTurn)

      const responseParts = []
      for (const call of calls) {
        toolsUsed.push(call.name)
        const callArgs = (call.args ?? {}) as Record<string, unknown>
        const output =
          extraNames.has(call.name) && args.extraTools
            ? await args.extraTools.run(call.name, callArgs)
            : allowed && !allowed.has(call.name)
              ? { error: `The tool "${call.name}" is not available in this chat.` }
              : await runTool(call.name, callArgs, { accountId })
        responseParts.push({
          functionResponse: {
            name: call.name,
            response: (output && typeof output === 'object' && !Array.isArray(output) ? output : { result: output }) as object,
          },
        })
      }
      contents.push({ role: 'user', parts: responseParts })
      result = await model.generateContent({ contents })
      addUsage(result.response.usageMetadata)
    }

    // Out of lookups and still asking for more: answer from what was read.
    if (result.response.functionCalls()?.length) {
      const lastTurn = result.response.candidates?.[0]?.content
      if (lastTurn) contents.push(lastTurn)
      contents.push({
        role: 'user',
        parts: [{ text: 'No more lookups are possible for this question. Answer now from the results above; say plainly what you could not find.' }],
      })
      result = await model.generateContent({ contents, toolConfig: { functionCallingConfig: { mode: FunctionCallingMode.NONE } } })
      addUsage(result.response.usageMetadata)
    }

    const text = result.response.text()
    const finishReason = result.response.candidates?.[0]?.finishReason
    if (!text.trim()) {
      throw new AdminAnswerError(
        toolsUsed.length >= MAX_TOOL_ROUNDS
          ? 'That question needed more lookups than one turn allows — try asking for one thing at a time.'
          : 'No answer came back. Try rephrasing the question.',
        400,
      )
    }

    void recordAiUsage({
      accountId,
      model: geminiEntry.model,
      feature,
      tokens: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      latencyMs: Date.now() - startedAt,
    })
    return { reply: text, toolsUsed: [...new Set(toolsUsed)], truncated: finishReason === FinishReason.MAX_TOKENS }
  } catch (err) {
    if (err instanceof AdminAnswerError) throw err
    const messageText = err instanceof Error ? err.message : String(err)
    void recordAiUsage({
      accountId,
      model: geminiEntry.model,
      feature,
      tokens: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      status: 'error',
      error: messageText,
      latencyMs: Date.now() - startedAt,
    })
    const retryable = /rate|quota|RESOURCE_EXHAUSTED|timeout|aborted|503|overloaded/i.test(messageText)
    throw new AdminAnswerError(retryable ? `Gemini is busy right now — try again shortly. (${messageText})` : messageText, retryable ? 429 : 400)
  }
}
