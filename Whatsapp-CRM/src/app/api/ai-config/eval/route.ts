import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { runEvalSuite } from '@/lib/ai/eval/runner'
import { STARTER_CASES } from '@/lib/ai/eval/starter-cases'

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
  | { action: 'create_case'; question: string; expected?: string | null; expect_handoff?: boolean; category?: string | null; notes?: string | null }
  | { action: 'update_case'; id: string; question?: string; expected?: string | null; expect_handoff?: boolean; category?: string | null; notes?: string | null; enabled?: boolean }
  | { action: 'delete_case'; id: string }

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
