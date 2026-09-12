import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { fetchPageText } from '@/lib/ai/web-extract'
import { serializeDataTable } from '@/lib/ai/data-store-source'

/**
 * The account's knowledge base, as real rows (ai_knowledge_items).
 *
 * Reading is open to any account member — a knowledge entry is business
 * reference material, the same sensitivity as a message template, and
 * agents need to see what the bot is answering from. Writing requires
 * 'admin', matching the AI Config screen's own gate: a bad knowledge
 * entry changes what every customer gets told.
 */

const WRITE_ROLE = 'admin' as const
const READ_ROLE = 'viewer' as const

const KINDS = ['qa', 'document', 'website', 'text', 'database'] as const
type Kind = (typeof KINDS)[number]

/** Who an entry may be said to — see AiKnowledgeItem.audience. */
const AUDIENCES = ['customer', 'internal', 'both'] as const

async function resolveConfigId(accountId: string): Promise<string | null> {
  const config = await prisma.aiConfig.findUnique({
    where: { account_id: accountId },
    select: { id: true },
  })
  return config?.id ?? null
}

export async function GET(req: Request) {
  let accountId: string
  try {
    accountId = (await requireRole(READ_ROLE)).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const url = new URL(req.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  const kind = url.searchParams.get('kind') ?? ''
  const status = url.searchParams.get('status') ?? ''
  const audience = url.searchParams.get('audience') ?? ''
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1)
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? '10') || 10))

  const where: Prisma.AiKnowledgeItemWhereInput = { account_id: accountId }
  if (kind && (KINDS as readonly string[]).includes(kind)) where.kind = kind
  if (status) where.status = status
  if (audience && (AUDIENCES as readonly string[]).includes(audience)) where.audience = audience
  if (q) {
    // Searches what a person would actually recognize the entry by —
    // its name, and the text of a Q&A pair. Not `content`: a full-text
    // match inside a 200KB synced page would return rows whose name
    // gives no hint why they matched.
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { question: { contains: q, mode: 'insensitive' } },
      { answer: { contains: q, mode: 'insensitive' } },
    ]
  }

  const [items, total, counts] = await Promise.all([
    prisma.aiKnowledgeItem.findMany({
      where,
      orderBy: { updated_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, kind: true, name: true, source: true, audience: true, description: true,
        question: true, answer: true,
        source_url: true, source_ref: true, status: true, last_error: true,
        last_synced_at: true, created_at: true, updated_at: true,
        // Length only, never the body — a synced page can be hundreds of
        // KB and the table only needs to show how much text there is.
        content: false,
      },
    }),
    prisma.aiKnowledgeItem.count({ where }),
    prisma.aiKnowledgeItem.groupBy({
      by: ['status'],
      where: { account_id: accountId },
      _count: { _all: true },
    }),
  ])

  return NextResponse.json({
    items,
    total,
    page,
    limit,
    status_counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
  })
}

interface CreateBody {
  kind?: Kind
  name?: string
  question?: string
  answer?: string
  content?: string
  source_url?: string
  /** DataTable id, for kind 'database'. */
  source_ref?: string
  /** 'customer' (default) | 'internal' | 'both'. */
  audience?: string
  /** What the entry is for, prepended to its text in the prompt. */
  description?: string
}

export async function POST(req: Request) {
  let ctx: { accountId: string; userId: string }
  try {
    const r = await requireRole(WRITE_ROLE)
    ctx = { accountId: r.accountId, userId: r.userId }
  } catch (err) {
    return toErrorResponse(err)
  }

  const configId = await resolveConfigId(ctx.accountId)
  if (!configId) {
    return NextResponse.json(
      { error: 'Connect an AI provider first — the knowledge base belongs to your AI configuration.' },
      { status: 400 },
    )
  }

  const body = (await req.json().catch(() => null)) as CreateBody | null
  const kind = body?.kind
  if (!kind || !(KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: `kind must be one of: ${KINDS.join(', ')}` }, { status: 400 })
  }

  try {
    // Each kind resolves to the same three stored things — a display
    // name, the text that actually gets embedded, and where it came
    // from — just gathered differently.
    let name = body?.name?.trim() ?? ''
    let content = body?.content?.trim() ?? ''
    let source = 'manual'
    let sourceUrl: string | null = null
    let sourceRef: string | null = null
    let lastSyncedAt: Date | null = null
    // Unrecognized values fall back to 'customer' rather than being
    // rejected — the restrictive end of the range is the safe one to
    // land on if a client sends something unexpected.
    const resolvedAudience = (AUDIENCES as readonly string[]).includes(body?.audience ?? '')
      ? (body!.audience as string)
      : 'customer'
    const resolvedDescription = body?.description?.trim()?.slice(0, 2000) || null

    if (kind === 'qa') {
      const question = body?.question?.trim()
      const answer = body?.answer?.trim()
      if (!question || !answer) {
        return NextResponse.json({ error: 'A Q&A entry needs both a question and an answer.' }, { status: 400 })
      }
      const item = await prisma.aiKnowledgeItem.create({
        data: {
          ai_config_id: configId,
          account_id: ctx.accountId,
          kind,
          name: name || (question.length > 80 ? `${question.slice(0, 77)}...` : question),
          source: 'manual',
          question,
          answer,
          audience: resolvedAudience,
          description: resolvedDescription,
          status: 'pending',
        },
      })
      return NextResponse.json({ item }, { status: 201 })
    }

    if (kind === 'website') {
      const rawUrl = body?.source_url?.trim()
      if (!rawUrl) return NextResponse.json({ error: 'A website entry needs a URL.' }, { status: 400 })
      const page = await fetchPageText(rawUrl)
      content = page.text
      name = name || page.title || new URL(rawUrl).hostname
      source = 'web_sync'
      sourceUrl = rawUrl
      lastSyncedAt = new Date()
    } else if (kind === 'database') {
      const tableId = body?.source_ref?.trim()
      if (!tableId) return NextResponse.json({ error: 'Pick a table to connect.' }, { status: 400 })
      const serialized = await serializeDataTable(ctx.accountId, tableId)
      content = serialized.text
      name = name || serialized.tableName
      source = 'data_store'
      sourceRef = tableId
      lastSyncedAt = new Date()
    } else {
      // 'text' and 'document' — content is supplied directly (typed in,
      // or extracted from an upload before this call).
      if (!content) return NextResponse.json({ error: 'This entry has no text content.' }, { status: 400 })
      name = name || 'Untitled'
      source = kind === 'document' ? 'upload' : 'manual'
    }

    const item = await prisma.aiKnowledgeItem.create({
      data: {
        ai_config_id: configId,
        account_id: ctx.accountId,
        kind,
        name: name.slice(0, 200),
        source,
        content,
        source_url: sourceUrl,
        source_ref: sourceRef,
        last_synced_at: lastSyncedAt,
        audience: resolvedAudience,
        description: resolvedDescription,
        status: 'pending',
      },
    })
    return NextResponse.json({ item }, { status: 201 })
  } catch (err) {
    // Fetch/extract failures are the user's problem to fix (bad URL,
    // JS-only page, empty table), so the real message goes back rather
    // than a generic 500.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not add that entry.' },
      { status: 400 },
    )
  }
}
