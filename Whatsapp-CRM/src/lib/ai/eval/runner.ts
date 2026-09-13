/**
 * Replays the evaluation suite and scores it.
 *
 * The point is to make "did that prompt change help or hurt?" a question
 * with an answer. Before this, accuracy could only be discussed
 * anecdotally: somebody notices a bad reply, somebody edits the prompt,
 * and nobody finds out what else moved.
 *
 * Two decisions worth stating:
 *
 * **Grading is done by a model, not by string matching.** "₹45,000",
 * "45000 rupees" and "forty-five thousand" are the same answer, and a
 * substring check would fail two of them. The grader is given the
 * expected answer and the actual reply and asked only whether the reply
 * conveys it — a narrow question models are reliable at, unlike "is this
 * a good reply", which they are not.
 *
 * **Cases run sequentially.** Firing thirty concurrent requests at a
 * free-tier Gemini key produces a rate-limit wall and a run full of
 * false failures, which is worse than a slow run. The suite is small
 * enough that a minute or two is an acceptable cost for a number you can
 * trust.
 */

import { prisma } from '@/lib/db'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { runCustomerTurn, type CustomerAiConfig } from '../customer-pipeline'
import { getProviderKeys } from '../providers/registry'
import { decrypt } from '@/lib/whatsapp/encryption'
import { recordAiUsage } from '../usage'

/**
 * The model that grades answers, resolved rather than hardcoded.
 *
 * The first version pinned 'gemini-2.5-flash' and it was retired
 * underneath the suite — "no longer available to new users" — turning
 * every graded case into "Could not grade". Grading is the worst place
 * to hold a dated assumption: the failure presents as a broken test
 * suite rather than as a dead dependency.
 *
 * The account's own chat model is tried first because it is provably
 * working — it is generating the very replies being graded. The fallback
 * is an alias that tracks the current release instead of naming a
 * version that can expire.
 */
const GRADER_FALLBACK_MODEL = 'gemini-flash-latest'
const GRADER_TIMEOUT_MS = 20_000

function resolveGraderModel(aiConfig: { provider_keys: unknown }): string {
  const configured = getProviderKeys(aiConfig).gemini?.model?.trim()
  return configured || GRADER_FALLBACK_MODEL
}

/** Guards against one stuck case holding a run open indefinitely. */
const MAX_CASES_PER_RUN = 200

export type EvalProgress = { done: number; total: number }

export async function runEvalSuite(args: {
  accountId: string
  aiConfigId: string
  label?: string
  onProgress?: (p: EvalProgress) => void
}): Promise<{ runId: string; passed: number; failed: number; total: number }> {
  const aiConfig = await prisma.aiConfig.findFirst({
    where: { id: args.aiConfigId, account_id: args.accountId },
  })
  if (!aiConfig) throw new Error('AI is not configured for this account.')

  const cases = await prisma.aiEvalCase.findMany({
    where: { ai_config_id: args.aiConfigId, account_id: args.accountId, enabled: true },
    orderBy: { created_at: 'asc' },
    take: MAX_CASES_PER_RUN,
  })
  if (cases.length === 0) throw new Error('No test cases yet. Add some, or load the starter set.')

  const run = await prisma.aiEvalRun.create({
    data: {
      account_id: args.accountId,
      ai_config_id: args.aiConfigId,
      status: 'running',
      total: cases.length,
      label: args.label ?? null,
      // Recorded so a later comparison can say what actually differed
      // between two runs, rather than only that the score moved.
      settings_snapshot: {
        model: getProviderKeys(aiConfig)[aiConfig.active_provider]?.model ?? null,
        provider: aiConfig.active_provider,
        temperature: aiConfig.temperature,
        max_tokens: aiConfig.max_tokens,
        confidence_threshold: aiConfig.confidence_threshold,
        low_confidence_handoff_enabled: aiConfig.low_confidence_handoff_enabled,
        composite_confidence_enabled: aiConfig.composite_confidence_enabled,
        response_validation_enabled: aiConfig.response_validation_enabled,
        retrieval_mode: aiConfig.retrieval_mode,
        max_context_results: aiConfig.max_context_results,
        system_prompt_chars: aiConfig.system_prompt?.length ?? 0,
      },
    },
  })

  const geminiEntry = getProviderKeys(aiConfig).gemini
  const graderKey = geminiEntry?.api_key ? decrypt(geminiEntry.api_key) : null
  const graderModel = resolveGraderModel(aiConfig)

  let passed = 0
  let failed = 0

  try {
    for (const [index, testCase] of cases.entries()) {
      const outcome = await runOneCase({
        aiConfig: aiConfig as unknown as CustomerAiConfig,
        accountId: args.accountId,
        testCase,
        graderKey,
        graderModel,
      })

      if (outcome.passed) passed++
      else failed++

      await prisma.aiEvalResult.create({
        data: {
          run_id: run.id,
          case_id: testCase.id,
          passed: outcome.passed,
          reply: outcome.reply,
          handed_off: outcome.handedOff,
          confidence: outcome.confidence,
          verdict: outcome.verdict,
          latency_ms: outcome.latencyMs,
        },
      })

      args.onProgress?.({ done: index + 1, total: cases.length })
    }

    await prisma.aiEvalRun.update({
      where: { id: run.id },
      data: { status: 'completed', passed, failed, finished_at: new Date() },
    })
  } catch (err) {
    await prisma.aiEvalRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        passed,
        failed,
        error: err instanceof Error ? err.message : String(err),
        finished_at: new Date(),
      },
    })
    throw err
  }

  return { runId: run.id, passed, failed, total: cases.length }
}

type CaseOutcome = {
  passed: boolean
  reply: string | null
  handedOff: boolean
  confidence: number
  verdict: string
  latencyMs: number
}

async function runOneCase(args: {
  aiConfig: CustomerAiConfig
  accountId: string
  testCase: { id: string; question: string; expected: string | null; expect_handoff: boolean }
  graderKey: string | null
  graderModel: string
}): Promise<CaseOutcome> {
  const startedAt = Date.now()

  let turn: Awaited<ReturnType<typeof runCustomerTurn>>
  try {
    turn = await runCustomerTurn({
      aiConfig: args.aiConfig,
      accountId: args.accountId,
      // No contact: an evaluation case is a question, not a conversation
      // with a specific person, so the per-customer lookup tools are
      // deliberately unavailable. A case that needs them is really a
      // test of that customer's data, which would change between runs
      // and make the score meaningless.
      contactId: null,
      customerMessage: args.testCase.question,
    })
  } catch (err) {
    return {
      passed: false,
      reply: null,
      handedOff: false,
      confidence: 0,
      verdict: `Generation failed: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: Date.now() - startedAt,
    }
  }

  const handedOff = turn.decision.action === 'handoff'
  const latencyMs = Date.now() - startedAt

  // ── Cases that should hand off ───────────────────────────────
  // Checked first and without the grader: whether the system escalated
  // is a fact, not a judgement.
  if (args.testCase.expect_handoff) {
    return {
      passed: handedOff,
      reply: turn.reply,
      handedOff,
      confidence: turn.effectiveConfidence,
      verdict: handedOff
        ? `Correctly handed off — ${describeHandoff(turn)}`
        : 'Should have handed off, but answered instead. Add this topic to your escalation list if it is a business rule rather than a safety one.',
      latencyMs,
    }
  }

  // ── Cases that should be answered ────────────────────────────
  if (handedOff) {
    return {
      passed: false,
      reply: turn.reply,
      handedOff: true,
      confidence: turn.effectiveConfidence,
      verdict: `Handed off instead of answering — ${describeHandoff(turn)}`,
      latencyMs,
    }
  }

  const reply = turn.reply ?? ''

  // No expected answer recorded: the case only asserts "answers without
  // handing off or inventing anything", which it just did.
  if (!args.testCase.expected?.trim()) {
    return {
      passed: true,
      reply,
      handedOff: false,
      confidence: turn.effectiveConfidence,
      verdict: 'Answered, with nothing unverifiable in it.',
      latencyMs,
    }
  }

  if (!args.graderKey) {
    return {
      passed: false,
      reply,
      handedOff: false,
      confidence: turn.effectiveConfidence,
      verdict: 'Cannot grade this case: no Gemini key is configured to grade with.',
      latencyMs,
    }
  }

  const graded = await gradeAnswer({
    apiKey: args.graderKey,
    model: args.graderModel,
    question: args.testCase.question,
    expected: args.testCase.expected,
    actual: reply,
    accountId: args.accountId,
  })

  return {
    passed: graded.correct,
    reply,
    handedOff: false,
    confidence: turn.effectiveConfidence,
    verdict: graded.reason,
    latencyMs,
  }
}

/**
 * Asks a model the one narrow question it is reliable at: does this
 * reply convey this expected answer?
 *
 * Not "is this a good reply" — models grade that generously and
 * inconsistently, and a suite built on it drifts without anyone
 * noticing.
 */
async function gradeAnswer(args: {
  apiKey: string
  model: string
  question: string
  expected: string
  actual: string
  accountId: string
}): Promise<{ correct: boolean; reason: string }> {
  const genAI = new GoogleGenerativeAI(args.apiKey)
  const model = genAI.getGenerativeModel(
    {
      model: args.model,
      systemInstruction: [
        'You grade customer-service replies. You are strict about facts and relaxed about wording.',
        '',
        'PASS if the reply conveys the expected answer, even when the phrasing, language or currency format differs. "₹45,000", "45000 rupees" and "forty-five thousand" are the same answer.',
        'PASS if the reply gives the expected answer plus extra helpful detail.',
        '',
        'FAIL if the reply contradicts the expected answer.',
        'FAIL if it states a different figure, date or name.',
        'FAIL if it avoids answering, or promises someone will follow up instead of answering.',
        'FAIL if it omits the key fact the expected answer contains.',
        '',
        'Reply with exactly one line: PASS <short reason> or FAIL <short reason>. No other text.',
      ].join('\n'),
      generationConfig: { temperature: 0, maxOutputTokens: 200 },
    },
    { timeout: GRADER_TIMEOUT_MS },
  )

  try {
    const result = await model.generateContent(
      [
        `QUESTION: ${args.question}`,
        `EXPECTED ANSWER: ${args.expected}`,
        `ACTUAL REPLY: ${args.actual}`,
      ].join('\n\n'),
    )
    const text = (result.response.text() ?? '').trim()

    void recordAiUsage({
      accountId: args.accountId,
      provider: 'gemini',
      model: args.model,
      feature: 'eval_grading',
      tokens: {
        inputTokens: result.response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: result.response.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: result.response.usageMetadata?.totalTokenCount ?? 0,
      },
      latencyMs: 0,
    })

    const correct = /^pass\b/i.test(text)
    const reason = text.replace(/^(pass|fail)\b[:\s-]*/i, '').trim()
    return { correct, reason: reason || (correct ? 'Matches the expected answer.' : 'Does not match.') }
  } catch (err) {
    // A grader failure is not a case failure, but it cannot be counted
    // as a pass either — that would quietly inflate the score.
    return {
      correct: false,
      reason: `Could not grade: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/**
 * Says why the turn stopped, in terms of the thing that actually caused
 * it.
 *
 * The first version reported retrieval confidence for every handoff,
 * whatever the reason. "Can I pay the fee in instalments?" therefore
 * read as "Retrieval confidence 0.57, no penalties applied" when the
 * real cause was the account's own prompt instructing the model to fetch
 * a human for payment changes — a diagnostic pointing at the wrong
 * subsystem, which costs more time than no diagnostic at all.
 */
function describeHandoff(turn: Awaited<ReturnType<typeof runCustomerTurn>>): string {
  if (turn.decision.action !== 'handoff') return 'it answered.'

  switch (turn.decision.reason) {
    case 'model_requested':
      return 'your own prompt tells it to fetch a person for this (booking, registration or payment changes), and it did.'
    case 'safety':
      return `the built-in safety guard caught it: ${turn.decision.safety?.reason ?? 'a protected request'}`
    case 'unsupported_details':
      return `the answer contained something unverifiable. ${turn.validation?.summary ?? ''}`.trim()
    case 'generation_failed':
      return `the model refused to answer, so a person takes over. Provider said: ${(turn.decision.error ?? '').slice(0, 160)}`
    case 'low_confidence':
    default:
      return turn.confidence.explain
  }
}
