import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { runEvalSuite } from '@/lib/ai/eval/runner'
import { STARTER_CASES } from '@/lib/ai/eval/starter-cases'
import { cleanPhrases, ensureEvalColumns } from '@/lib/ai/eval/schema'
import { realQuestions } from '@/lib/ai/eval/real-questions'
import { qualityReport } from '@/lib/ai/eval/quality-report'

/**
 * The evaluation suite: test cases, runs, and results.
 *
 * Admin-floor throughout. A run replays every enabled case against the
 * live configuration and costs real tokens, so it is not something an
 * agent triggers by accident.
 */

export const dynamic = 'force-dynamic'

/** GET — the cases, the last few runs, and one run's results. */
export async function GET(req: Request) {
  let accountId: string
  try {
    accountId = (await requireRole('admin')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const aiConfig = await prisma.aiConfig.findUnique({
    where: { account_id: accountId },
    select: { id: true },
  })
  if (!aiConfig) return NextResponse.json({ cases: [], runs: [], results: [] })

  const url = new URL(req.url)

  // How it did on real conversations over the last week.
  if (url.searchParams.get('view') === 'quality') {
    return NextResponse.json(await qualityReport(accountId))
  }

  await ensureEvalColumns()
  const runId = url.searchParams.get('run_id')

  const [cases, runs] = await Promise.all([
    prisma.aiEvalCase.findMany({
      where: { ai_config_id: aiConfig.id },
      orderBy: { created_at: 'asc' },
    }),
    prisma.aiEvalRun.findMany({
      where: { ai_config_id: aiConfig.id },
      orderBy: { started_at: 'desc' },
      take: 10,
    }),
  ])

  // Defaults to the most recent run, which is what the screen opens on.
  const targetRunId = runId ?? runs[0]?.id ?? null
  const results = targetRunId
    ? await prisma.aiEvalResult.findMany({
        where: { run_id: targetRunId },
        orderBy: { created_at: 'asc' },
      })
    : []

  return NextResponse.json({ cases, runs, results, run_id: targetRunId })
}

type PostBody =
  | { action: 'run'; label?: string }
  | { action: 'seed' }
  | { action: 'create_case'; question: string; expected?: string | null; expect_handoff?: boolean; category?: string | null; notes?: string | null; must_include?: unknown; must_not_include?: unknown }
  | { action: 'update_case'; id: string; question?: string; expected?: string | null; expect_handoff?: boolean; category?: string | null; notes?: string | null; enabled?: boolean; must_include?: unknown; must_not_include?: unknown }
  | { action: 'delete_case'; id: string }
  | { action: 'suggest_from_chats' }
  | { action: 'add_questions'; questions: unknown }

export async function POST(req: Request) {
  let accountId: string
  try {
    accountId = (await requireRole('admin')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const aiConfig = await prisma.aiConfig.findUnique({
    where: { account_id: accountId },
    select: { id: true },
  })
  if (!aiConfig) {
    return NextResponse.json({ error: 'Set up the AI assistant before running tests.' }, { status: 400 })
  }

  const body = (await req.json().catch(() => null)) as PostBody | null
  if (!body?.action) return NextResponse.json({ error: 'Missing action.' }, { status: 400 })
  await ensureEvalColumns()

  switch (body.action) {
    case 'seed': {
      const existing = await prisma.aiEvalCase.count({ where: { ai_config_id: aiConfig.id } })
      if (existing > 0) {
        return NextResponse.json(
          { error: 'You already have test cases. Delete them first if you want to start over.' },
          { status: 400 },
        )
      }
      await prisma.aiEvalCase.createMany({
        data: STARTER_CASES.map((c) => ({
          account_id: accountId,
          ai_config_id: aiConfig.id,
          question: c.question,
          expected: c.expected,
          expect_handoff: c.expect_handoff,
          category: c.category,
          notes: c.notes ?? null,
        })),
      })
      return NextResponse.json({ ok: true, added: STARTER_CASES.length })
    }

    case 'create_case': {
      const question = body.question?.trim()
      if (!question) return NextResponse.json({ error: 'A test case needs a question.' }, { status: 400 })
      const created = await prisma.aiEvalCase.create({
        data: {
          account_id: accountId,
          ai_config_id: aiConfig.id,
          question,
          expected: body.expected?.trim() || null,
          expect_handoff: body.expect_handoff ?? false,
          category: body.category?.trim() || null,
          notes: body.notes?.trim() || null,
          must_include: cleanPhrases(body.must_include) ?? undefined,
          must_not_include: cleanPhrases(body.must_not_include) ?? undefined,
        },
      })
      return NextResponse.json({ ok: true, case: created })
    }

    case 'update_case': {
      // Scoped by ai_config_id as well as id, so an id from another
      // account cannot be updated even if one were guessed.
      const updated = await prisma.aiEvalCase.updateMany({
        where: { id: body.id, ai_config_id: aiConfig.id },
        data: {
          ...(body.question !== undefined ? { question: body.question.trim() } : {}),
          ...(body.expected !== undefined ? { expected: body.expected?.trim() || null } : {}),
          ...(body.expect_handoff !== undefined ? { expect_handoff: body.expect_handoff } : {}),
          ...(body.category !== undefined ? { category: body.category?.trim() || null } : {}),
          ...(body.notes !== undefined ? { notes: body.notes?.trim() || null } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(body.must_include !== undefined ? { must_include: cleanPhrases(body.must_include) ?? Prisma.DbNull } : {}),
          ...(body.must_not_include !== undefined
            ? { must_not_include: cleanPhrases(body.must_not_include) ?? Prisma.DbNull }
            : {}),
        },
      })
      if (updated.count === 0) return NextResponse.json({ error: 'Test case not found.' }, { status: 404 })
      return NextResponse.json({ ok: true })
    }

    case 'delete_case': {
      const deleted = await prisma.aiEvalCase.deleteMany({
        where: { id: body.id, ai_config_id: aiConfig.id },
      })
      if (deleted.count === 0) return NextResponse.json({ error: 'Test case not found.' }, { status: 404 })
      return NextResponse.json({ ok: true })
    }

    // Questions customers really asked in the last month, not already
    // tests — offered, never added without the admin choosing them.
    case 'suggest_from_chats': {
      const existing = await prisma.aiEvalCase.findMany({
        where: { ai_config_id: aiConfig.id },
        select: { question: true },
      })
      const questions = await realQuestions(accountId, existing.map((c) => c.question))
      return NextResponse.json({ ok: true, questions })
    }

    case 'add_questions': {
      const questions = Array.isArray(body.questions)
        ? body.questions
            .filter((q): q is string => typeof q === 'string')
            .map((q) => q.trim().slice(0, 500))
            .filter(Boolean)
            .slice(0, 50)
        : []
      if (questions.length === 0) return NextResponse.json({ error: 'Choose at least one question.' }, { status: 400 })
      await prisma.aiEvalCase.createMany({
        data: questions.map((question) => ({
          account_id: accountId,
          ai_config_id: aiConfig.id,
          question,
          category: 'from chats',
          notes: 'Asked by a customer. Write what a correct answer must say.',
        })),
      })
      return NextResponse.json({ ok: true, added: questions.length })
    }

    case 'run': {
      try {
        const result = await runEvalSuite({
          accountId,
          aiConfigId: aiConfig.id,
          label: body.label,
        })
        return NextResponse.json({ ok: true, ...result })
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : 'The test run failed.' },
          { status: 400 },
        )
      }
    }

    default:
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }
}
