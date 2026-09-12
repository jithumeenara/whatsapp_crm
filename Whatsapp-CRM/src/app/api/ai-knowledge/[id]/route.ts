import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { fetchPageText } from '@/lib/ai/web-extract'
import { serializeDataTable } from '@/lib/ai/data-store-source'

/** One knowledge entry: read its full content, edit it, re-sync it from
 *  its source, or delete it. */

async function loadOwned(accountId: string, id: string) {
  return prisma.aiKnowledgeItem.findFirst({ where: { id, account_id: accountId } })
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let accountId: string
  try {
    accountId = (await requireRole('viewer')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }
  const { id } = await params
  const item = await loadOwned(accountId, id)
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ item })
}

interface PatchBody {
  name?: string
  question?: string
  answer?: string
  content?: string
  /** 'trained' | 'pending' | 'disabled' — the UI only sends 'disabled'
   *  and 'pending' (re-enable); 'trained' is set by the sync run, never
   *  by hand, so it can't claim a state nothing verified. */
  status?: string
  /** Re-fetch a website entry, or re-read a connected Data Store table. */
  resync?: boolean
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let accountId: string
  try {
    accountId = (await requireRole('admin')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const { id } = await params
  const existing = await loadOwned(accountId, id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = (await req.json().catch(() => null)) as PatchBody | null
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const data: Record<string, unknown> = {}

  if (body.resync) {
    try {
      if (existing.kind === 'website' && existing.source_url) {
        const page = await fetchPageText(existing.source_url)
        data.content = page.text
        data.last_synced_at = new Date()
        // Content changed, so whatever was embedded for it is stale —
        // back to 'pending' until a sync run re-embeds it.
        data.status = 'pending'
        data.last_error = null
      } else if (existing.kind === 'database' && existing.source_ref) {
        const serialized = await serializeDataTable(accountId, existing.source_ref)
        data.content = serialized.text
        data.last_synced_at = new Date()
        data.status = 'pending'
        data.last_error = null
      } else {
        return NextResponse.json({ error: 'This entry has no source to re-sync from.' }, { status: 400 })
      }
    } catch (err) {
      // A failed re-sync keeps the previously fetched content — a site
      // being down today shouldn't blank out knowledge that worked
      // yesterday. The failure is recorded on the row instead.
      const message = err instanceof Error ? err.message : 'Re-sync failed.'
      await prisma.aiKnowledgeItem.update({
        where: { id },
        data: { status: 'failed', last_error: message, last_synced_at: new Date() },
      })
      return NextResponse.json({ error: message }, { status: 400 })
    }
  }

  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 200)
  if (typeof body.question === 'string') data.question = body.question.trim()
  if (typeof body.answer === 'string') data.answer = body.answer.trim()
  if (typeof body.content === 'string') data.content = body.content
  if (body.status === 'disabled' || body.status === 'pending') data.status = body.status

  // Any edit to the embedded text invalidates the existing embedding.
  if (!body.resync && ('question' in data || 'answer' in data || 'content' in data)) {
    data.status = data.status === 'disabled' ? 'disabled' : 'pending'
  }

  const item = await prisma.aiKnowledgeItem.update({ where: { id }, data })
  return NextResponse.json({ item })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let accountId: string
  try {
    accountId = (await requireRole('admin')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }
  const { id } = await params
  const existing = await loadOwned(accountId, id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.aiKnowledgeItem.delete({ where: { id } })
  // The orphaned embedding row is cleaned up by the next sync run, which
  // deletes every hash no longer present in the knowledge base — no need
  // to compute this one entry's hashes here just to delete them.
  return NextResponse.json({ success: true })
}
