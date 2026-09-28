import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { hasMinRole } from '@/lib/auth/roles'
import { geminiCredentials } from '@/lib/ai/providers/registry'
import { serializeDataTable } from '@/lib/ai/data-store-source'
import { invalidateKnowledge } from '@/lib/ai/knowledge-store'
import { trainKnowledgeConfig } from '@/lib/ai/train-pending'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { isSensitiveField } from '@/lib/data-store/record-alert'
import { ensureDataStoreColumns } from '@/lib/data-store/schema'
import { peopleTableIds } from '@/lib/data-store/people-tables'

/**
 * This table and the assistant: is it something the AI answers from,
 * is that up to date, and — for an admin — connect it or train it now.
 *
 * Training is what needs AI; everything else about the Data Store works
 * without it. Connecting and training are admin-only, like the Training
 * tab: what goes in here is what customers get told.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Enough for somebody pressing the button after each edit, not enough
 *  to spend the account's Gemini quota in a loop. */
const TRAIN_LIMIT = { limit: 6, windowMs: 10 * 60_000 }

async function loadState(accountId: string, tableId: string) {
  const table = await prisma.dataTable.findFirst({
    where: { id: tableId, account_id: accountId },
    select: {
      id: true,
      name: true,
      ai_can_register: true,
      fields: { select: { field_key: true, label: true, field_type: true } },
    },
  })
  if (!table) return null

  const config = await prisma.aiConfig.findUnique({
    where: { account_id: accountId },
    select: { id: true, provider_keys: true, knowledge_base_enabled: true, ai_auto_reply_enabled: true },
  })
  const knowledge = config
    ? await prisma.aiKnowledgeItem.findFirst({
        where: { ai_config_id: config.id, account_id: accountId, kind: 'database', source_ref: tableId },
        orderBy: { created_at: 'asc' },
        select: { id: true, status: true, audience: true, last_synced_at: true, last_error: true, updated_at: true },
      })
    : null

  // Personal data, by the table's own shape: customers registered into
  // it, or a column that holds a phone, an email or an identity number.
  // Connecting such a table for customers to be told would let anybody
  // ask the assistant about anybody else.
  // The same test the assistant applies when it reads knowledge
  // (people-tables.ts), plus the columns themselves.
  const people = await peopleTableIds(accountId, [tableId])
  const personal =
    people.has(tableId) ||
    table.fields.some((f) => f.field_type === 'phone' || f.field_type === 'email' || isSensitiveField(f))

  return { table, config, knowledge, personal }
}

function view(state: NonNullable<Awaited<ReturnType<typeof loadState>>>, canManage: boolean) {
  const { config, knowledge, table, personal } = state
  return {
    ai: {
      configured: !!config,
      knowledge_enabled: config?.knowledge_base_enabled ?? false,
      semantic: config ? !!geminiCredentials(config).apiKey : false,
      auto_reply: config?.ai_auto_reply_enabled ?? false,
    },
    knowledge: knowledge
      ? {
          id: knowledge.id,
          status: knowledge.status,
          audience: knowledge.audience,
          last_synced_at: knowledge.last_synced_at?.toISOString() ?? null,
          last_error: knowledge.last_error,
        }
      : null,
    can_register: table.ai_can_register,
    personal_data: personal,
    can_manage: canManage,
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('viewer')
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })
    await ensureDataStoreColumns().catch(() => {})
    const state = await loadState(ctx.accountId, id)
    if (!state) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })
    return NextResponse.json(view(state, hasMinRole(ctx.role, 'admin')))
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let ctx: Awaited<ReturnType<typeof requireRole>>
  try {
    ctx = await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })

  const body = (await req.json().catch(() => null)) as { action?: string; audience?: string } | null
  const action = body?.action
  if (action !== 'connect' && action !== 'train') {
    return NextResponse.json({ error: 'action must be "connect" or "train".' }, { status: 400 })
  }

  const limited = checkRateLimit(`data-store-train:${ctx.accountId}`, TRAIN_LIMIT)
  if (!limited.success) return rateLimitResponse(limited)

  try {
    let state = await loadState(ctx.accountId, id)
    if (!state) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })
    if (!state.config) {
      return NextResponse.json(
        { error: 'Set up AI first (Settings → AI Config). The Data Store works without it; only training needs it.' },
        { status: 400 },
      )
    }
    const configId = state.config.id

    if (action === 'connect' && !state.knowledge) {
      // Staff-only unless asked otherwise, and staff-only regardless of
      // what was asked when the table holds personal data.
      const wanted = body?.audience === 'customer' ? 'customer' : 'internal'
      const audience = state.personal ? 'internal' : wanted
      const serialized = await serializeDataTable(ctx.accountId, id, null)
      await prisma.aiKnowledgeItem.create({
        data: {
          ai_config_id: configId,
          account_id: ctx.accountId,
          kind: 'database',
          name: serialized.tableName.slice(0, 200),
          source: 'data_store',
          source_ref: id,
          content: serialized.text,
          last_synced_at: new Date(),
          audience,
          status: 'pending',
        },
      })
      invalidateKnowledge(configId)
    } else if (state.knowledge) {
      // Re-read the rows now rather than waiting for the hourly sweep —
      // "I just added a row, train it" is the whole point of the button.
      const item = await prisma.aiKnowledgeItem.findUnique({
        where: { id: state.knowledge.id },
        select: { id: true, content: true, description: true },
      })
      if (item) {
        const fresh = (await serializeDataTable(ctx.accountId, id, item.description)).text
        if (fresh !== item.content) {
          await prisma.aiKnowledgeItem.update({
            where: { id: item.id },
            data: { content: fresh, last_synced_at: new Date(), status: 'pending', last_error: null },
          })
          invalidateKnowledge(configId)
        } else {
          await prisma.aiKnowledgeItem.update({
            where: { id: item.id },
            data: { last_synced_at: new Date() },
          })
        }
      }
    } else {
      return NextResponse.json({ error: 'Connect this table to the AI first.' }, { status: 400 })
    }

    const result = await trainKnowledgeConfig(configId)
    invalidateKnowledge(configId)

    state = await loadState(ctx.accountId, id)
    if (!state) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })

    let message: string
    if (result.skipped === 'knowledge_off') {
      message = 'Saved. The knowledge base is switched off in AI Config, so the assistant is not using it yet.'
    } else if (result.skipped === 'no_gemini_key') {
      message = 'Updated. The assistant finds these rows by keyword; add a Google Gemini key in AI Config for search by meaning.'
    } else if (result.failed > 0) {
      message = `Updated, but ${result.failed} part(s) did not train${result.firstError ? `: ${result.firstError}` : ''}.`
    } else {
      message = 'Trained. The assistant now answers from the latest rows.'
    }
    return NextResponse.json({ ...view(state, true), message })
  } catch (err) {
    // An empty table, or one with no readable fields, is the account's to
    // fix — the reason goes back as written.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not train this table.' },
      { status: 400 },
    )
  }
}
