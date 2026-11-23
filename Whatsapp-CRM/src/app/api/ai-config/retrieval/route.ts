import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'
import { retrievalSettingsFor, setRetrievalSettings } from '@/lib/ai/retrieval-settings'
import { getProviderKeys } from '@/lib/ai/providers/registry'

/**
 * GET / PUT /api/ai-config/retrieval   { rerank: boolean }
 *
 * Knowledge-search settings (lib/ai/retrieval-settings.ts). Admin only,
 * like the rest of AI Config. Says whether reranking can run at all — it
 * needs a Gemini key and search by meaning — so the switch is never on
 * and doing nothing.
 */

export const dynamic = 'force-dynamic'

async function view(accountId: string) {
  const [settings, ai] = await Promise.all([
    retrievalSettingsFor(accountId),
    prisma.aiConfig.findUnique({ where: { account_id: accountId }, select: { provider_keys: true, retrieval_mode: true } }),
  ])
  return {
    ...settings,
    ready: Boolean(ai && getProviderKeys(ai).gemini?.api_key && ai.retrieval_mode !== 'keyword'),
  }
}

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    return NextResponse.json(await view(ctx.accountId))
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await req.json().catch(() => null)) as { rerank?: unknown } | null
    if (typeof body?.rerank !== 'boolean') {
      return NextResponse.json({ error: 'rerank must be true or false.' }, { status: 400 })
    }
    const exists = await prisma.aiConfig.findUnique({ where: { account_id: ctx.accountId }, select: { id: true } })
    if (!exists) return NextResponse.json({ error: 'Set up the AI assistant first.' }, { status: 400 })
    await setRetrievalSettings(ctx.accountId, { rerank: body.rerank })
    await auditConfigChange(auditCtx(req, ctx), 'config.ai_changed', { area: 'ai_retrieval', fields: ['rerank'], meta: { rerank: body.rerank } })
    return NextResponse.json(await view(ctx.accountId))
  } catch (err) {
    return toErrorResponse(err)
  }
}
