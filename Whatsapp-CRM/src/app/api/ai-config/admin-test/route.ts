import { NextResponse } from 'next/server'
import { GoogleGenerativeAI, FinishReason, type Content } from '@google/generative-ai'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getProviderKeys } from '@/lib/ai/providers/registry'
import { AI_REQUEST_TIMEOUT_MS } from '@/lib/ai/providers/types'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { TOOL_DECLARATIONS, runTool } from '@/lib/ai/insights/tools'
import { recordAiUsage } from '@/lib/ai/usage'
import { loadCompanyProfile, formatCompanyBlock } from '@/lib/ai/company-profile'

/**
 * Admin Test — ask questions about this account's own CRM data in plain
 * language and get a real answer computed from the database.
 *
 * How it stays safe:
 *  - 'admin' role floor. This reads across contacts, conversations and
 *    enquiries; an agent's own inbox access is not the same permission.
 *  - The model never writes a query. It can only pick from the fixed
 *    tools in lib/ai/insights/tools.ts, each of which is a hand-written,
 *    read-only, account-scoped Prisma call.
 *  - Every tool result is scoped by accountId taken from the session,
 *    never from anything the model said.
 *
 * Gemini-only, like every other AI feature here — this leans on
 * function calling, and the account already has a Gemini key.
 */

export const dynamic = 'force-dynamic'

/** How many tool round trips one question may take. Real questions
 *  resolve in one or two ("count enquiries by source", then maybe
 *  "recent enquiries"); the cap stops a confused model from looping. */
const MAX_TOOL_ROUNDS = 4

const BASE_SYSTEM_PROMPT = `You are the internal data assistant for this WhatsApp CRM account. You are talking to an owner or admin of the business, not to a customer.

Answer questions about their CRM data by calling the provided tools. Never invent a number: if a tool didn't return it, say you don't have it. If a question needs data no tool provides, say so plainly and suggest the closest thing you can actually answer.

Formatting: when a result has more than two rows, present it as a Markdown table with clear column headers. Put the single most important number in a short sentence before or after the table. Keep answers brief — this is an operations dashboard, not an essay.

Today's date is ${new Date().toISOString().slice(0, 10)}. When the user says "this month", "last week" and similar, translate it into the days_back argument the tools accept.`

interface RequestBody {
  message?: string
  history?: Array<{ role: 'user' | 'model'; text: string }>
}

export async function POST(req: Request) {
  let accountId: string
  try {
    accountId = (await requireRole('admin')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = (await req.json().catch(() => null)) as RequestBody | null
  const message = body?.message?.trim()
  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }

  const config = await prisma.aiConfig.findUnique({ where: { account_id: accountId } })
  const geminiEntry = config ? getProviderKeys(config).gemini : undefined
  if (!geminiEntry?.api_key) {
    return NextResponse.json(
      { error: 'Admin Test needs a saved Google Gemini key — it uses Gemini function calling to read your data.' },
      { status: 400 },
    )
  }

  // The admin assistant's instructions are assembled from three parts:
  // the fixed behaviour above, what this business is, and whatever the
  // account added in Settings. admin_system_prompt is deliberately
  // separate from the customer-facing system_prompt — they shape
  // different jobs, and sharing one meant tuning the sales tone also
  // changed how analytics questions were answered.
  const companyProfile = await loadCompanyProfile(accountId).catch(() => null)
  const systemInstruction = [
    BASE_SYSTEM_PROMPT,
    formatCompanyBlock(companyProfile, 'admin') || undefined,
    config?.admin_system_prompt?.trim() || undefined,
  ]
    .filter(Boolean)
    .join('\n\n')

  const genAI = new GoogleGenerativeAI(decrypt(geminiEntry.api_key))
  const model = genAI.getGenerativeModel(
    {
      model: geminiEntry.model,
      systemInstruction,
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      generationConfig: {
        // Analytical answers over real numbers — near-deterministic is
        // what's wanted here, unlike the customer-facing chat tone.
        temperature: 0.2,
        maxOutputTokens: 2048,
      },
    },
    { timeout: AI_REQUEST_TIMEOUT_MS },
  )

  const history = (body?.history ?? [])
    .filter((m) => m.text?.trim())
    .map((m) => ({ role: m.role, parts: [{ text: m.text }] }))

  const startedAt = Date.now()
  // Every round trip in the tool loop bills separately, so they are
  // summed rather than only the final turn being counted.
  let inputTokens = 0
  let outputTokens = 0
  const addUsage = (meta?: { promptTokenCount?: number; candidatesTokenCount?: number }) => {
    inputTokens += meta?.promptTokenCount ?? 0
    outputTokens += meta?.candidatesTokenCount ?? 0
  }

  try {
    // Built explicitly rather than through startChat/sendMessage.
    //
    // ChatSession.sendMessage() wraps function results in a turn with
    // role 'function' (the older v1beta convention), and this model
    // rejects that outright: "Role 'function' is not supported. Please
    // use a valid role: ... USER, MODEL ...". Every Admin question that
    // needed a lookup failed with a 400. Managing `contents` here lets
    // the results go back under 'user', which is what the model asks
    // for, and costs nothing else — the tool loop is identical.
    const contents: Content[] = [
      ...history,
      { role: 'user', parts: [{ text: message }] },
    ]

    let result = await model.generateContent({ contents })
    addUsage(result.response.usageMetadata)
    const toolsUsed: string[] = []

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const calls = result.response.functionCalls()
      if (!calls || calls.length === 0) break

      // Echo the model's own turn back VERBATIM rather than rebuilding
      // it from functionCalls().
      //
      // Gemini 3.x attaches a thoughtSignature to each function-call
      // part and refuses the follow-up without it — "Function call is
      // missing a thought_signature", a 400. A reconstructed
      // { functionCall } part loses that field, so every Admin question
      // needing a lookup failed. Passing the candidate's content
      // through keeps whatever the model attached, including fields a
      // future version adds.
      const modelTurn = result.response.candidates?.[0]?.content
      if (!modelTurn) break
      contents.push(modelTurn)

      const responseParts = []
      for (const call of calls) {
        toolsUsed.push(call.name)
        const output = await runTool(call.name, (call.args ?? {}) as Record<string, unknown>, { accountId })
        responseParts.push({
          functionResponse: {
            name: call.name,
            // The SDK requires an object here; primitives and arrays are
            // wrapped so a tool returning a list doesn't fail the turn.
            response: (output && typeof output === 'object' && !Array.isArray(output)
              ? output
              : { result: output }) as object,
          },
        })
      }

      contents.push({ role: 'user', parts: responseParts })

      result = await model.generateContent({ contents })
      addUsage(result.response.usageMetadata)
    }

    const text = result.response.text()
    const finishReason = result.response.candidates?.[0]?.finishReason

    if (!text.trim()) {
      return NextResponse.json(
        {
          error:
            toolsUsed.length >= MAX_TOOL_ROUNDS
              ? 'That question needed more lookups than one turn allows — try asking for one thing at a time.'
              : 'No answer came back. Try rephrasing the question.',
        },
        { status: 400 },
      )
    }

    void recordAiUsage({
      accountId,
      model: geminiEntry.model,
      feature: 'chat_admin',
      tokens: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      latencyMs: Date.now() - startedAt,
    })

    return NextResponse.json({
      reply: text,
      // Shown in the UI so an admin can see which data was actually read
      // to produce the answer, rather than trusting it blindly.
      tools_used: [...new Set(toolsUsed)],
      truncated: finishReason === FinishReason.MAX_TOKENS,
    })
  } catch (err) {
    const messageText = err instanceof Error ? err.message : String(err)
    void recordAiUsage({
      accountId,
      model: geminiEntry.model,
      feature: 'chat_admin',
      tokens: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      status: 'error',
      error: messageText,
      latencyMs: Date.now() - startedAt,
    })
    const retryable = /rate|quota|RESOURCE_EXHAUSTED|timeout|aborted|503|overloaded/i.test(messageText)
    return NextResponse.json(
      { error: retryable ? `Gemini is busy right now — try again shortly. (${messageText})` : messageText },
      { status: retryable ? 429 : 400 },
    )
  }
}
