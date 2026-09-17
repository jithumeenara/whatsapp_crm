import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { fetchPageText } from '@/lib/ai/web-extract'
import { fetchSheet, serializeSheet } from '@/lib/ai/google-sheet'
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
  /** 'customer' | 'internal' | 'both' — who this entry may be said to. */
  audience?: string
  effective_from?: string | null
  effective_until?: string | null
  language?: string | null
  department?: string | null
  priority?: number
  /** What the entry is for. This IS part of the indexed text — the
   *  description is folded into the chunk title, which
   *  chunkEmbeddingText() hashes and embeds — so changing it
   *  invalidates the entry's embeddings and sends it back to 'pending'.
   *  That is deliberate: it means semantic search can match on the
   *  purpose too ("our fee structure" finding a table of numbers). */
  description?: string
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
      if (existing.kind === 'sheet' && existing.source_url) {
        // Re-read with whatever purpose the entry carries now, same as
        // the database branch below — editing the purpose and re-syncing
        // should change the header the model reads.
        const sheet = await fetchSheet(existing.source_url)
        data.content = serializeSheet(
          sheet,
          typeof body.description === 'string' ? body.description : existing.description,
        )
        data.last_synced_at = new Date()
        data.status = 'pending'
        data.last_error = null
      } else if (existing.kind === 'website' && existing.source_url) {
        const page = await fetchPageText(existing.source_url)
        data.content = page.text
        data.last_synced_at = new Date()
        // Content changed, so whatever was embedded for it is stale —
        // back to 'pending' until a sync run re-embeds it.
        data.status = 'pending'
        data.last_error = null
      } else if (existing.kind === 'database' && existing.source_ref) {
        // Re-serialize with whatever purpose the entry carries now, so
        // editing the purpose and re-syncing actually updates the header
        // the model reads.
        const serialized = await serializeDataTable(
          accountId,
          existing.source_ref,
          typeof body.description === 'string' ? body.description : existing.description,
        )
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
  const descriptionChanged =
    typeof body.description === 'string' && (body.description.trim() || null) !== existing.description
  if (typeof body.description === 'string') data.description = body.description.trim().slice(0, 2000) || null
  if (body.audience && ['customer', 'internal', 'both'].includes(body.audience)) {
    // Note this does NOT invalidate the embedding: the vector is the
    // same text either way, and the audience is applied when
    // knowledge is loaded, not when it is indexed.
    data.audience = body.audience
  }

  // Lifecycle fields. None of these change the embedded text, so none
  // invalidate the vector — they are all applied when knowledge is
  // loaded rather than when it is indexed, exactly like audience.
  if ('effective_from' in body) data.effective_from = parseDateOrNull(body.effective_from)
  if ('effective_until' in body) data.effective_until = parseDateOrNull(body.effective_until)
  if ('language' in body) data.language = body.language?.trim().slice(0, 60) || null
  if ('department' in body) data.department = body.department?.trim().slice(0, 100) || null
  if (typeof body.priority === 'number' && Number.isFinite(body.priority)) {
    data.priority = Math.max(-100, Math.min(100, Math.round(body.priority)))
  }

  // Any edit to the embedded text invalidates the existing embedding.
  // `description` counts: knowledge-store folds it into the chunk title,
  // and chunkEmbeddingText() embeds the title along with the body — so a
  // changed purpose changes every chunk hash for this entry. Leaving the
  // status alone here would have left it showing "Trained" while its
  // vectors were orphaned and retrieval quietly degraded.
  if (
    !body.resync &&
    ('question' in data || 'answer' in data || 'content' in data || descriptionChanged)
  ) {
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

/** An empty string clears the date; an unparseable one is rejected as
 *  null rather than becoming Invalid Date, which Postgres would refuse
 *  and which would fail the whole save for a typo in one field. */
function parseDateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
