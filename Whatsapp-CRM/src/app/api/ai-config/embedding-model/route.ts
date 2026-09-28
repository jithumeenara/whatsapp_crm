import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { embeddingModelFor, isEmbeddingModel, setEmbeddingModel, toKnowledgeItems } from '@/lib/ai/embeddings'
import { loadKnowledge } from '@/lib/ai/knowledge-store'
import { chunkDocument } from '@/lib/ai/knowledge'
import { refreshNow } from '@/lib/ai/knowledge-refresh'

/**
 * Which model the assistant searches knowledge by meaning with, and how
 * much of the knowledge that model has read so far.
 *
 * Admin only. A switch re-reads the whole knowledge base with the new
 * model (the two cannot be compared), which costs Gemini quota — so it
 * starts at once in the background, and is limited to a few an hour.
 */

export const dynamic = 'force-dynamic'

const SWITCH_LIMIT = { limit: 3, windowMs: 60 * 60_000 }

async function state(accountId: string) {
  const config = await prisma.aiConfig.findUnique({ where: { account_id: accountId }, select: { id: true } })
  if (!config) return null
  const model = await embeddingModelFor(config.id)
  const { qaPairs, documents } = await loadKnowledge(config.id, 'all')
  const total = toKnowledgeItems(qaPairs, documents.flatMap((d) => chunkDocument(d))).length
  let ready = 0
  try {
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>(
      Prisma.sql`SELECT count(*) AS n FROM ai_knowledge_embeddings WHERE ai_config_id = ${config.id}::uuid AND embedding_model = ${model}`,
    )
    ready = Math.min(total, Number(rows[0]?.n ?? 0))
  } catch {
    // No embeddings table (search by meaning not set up on this server).
  }
  return { config_id: config.id, model, ready, total }
}

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const s = await state(ctx.accountId)
    if (!s) return NextResponse.json({ error: 'Set up AI first.' }, { status: 400 })
    return NextResponse.json({ model: s.model, ready: s.ready, total: s.total })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await req.json().catch(() => null)) as { model?: unknown } | null
    if (!isEmbeddingModel(body?.model)) {
      return NextResponse.json({ error: 'Choose one of the listed models.' }, { status: 400 })
    }
    const before = await state(ctx.accountId)
    if (!before) return NextResponse.json({ error: 'Set up AI first.' }, { status: 400 })
    if (before.model === body.model) return NextResponse.json({ model: before.model, ready: before.ready, total: before.total })

    const limited = checkRateLimit(`embedding-model:${ctx.accountId}`, SWITCH_LIMIT)
    if (!limited.success) return rateLimitResponse(limited)

    await setEmbeddingModel(before.config_id, body.model)
    // Re-read everything with the new model now, not in a minute.
    void refreshNow(ctx.accountId, [])

    const after = await state(ctx.accountId)
    return NextResponse.json({ model: after?.model ?? body.model, ready: after?.ready ?? 0, total: after?.total ?? 0 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
