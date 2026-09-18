import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { extractFileText, SUPPORTED_UPLOAD_HINT } from '@/lib/ai/file-extract'
import { invalidateKnowledge } from '@/lib/ai/knowledge-store'

/**
 * Upload a document straight into the knowledge base: the file's text is
 * extracted here and stored as the entry's content. The file itself is
 * deliberately not kept — what the bot answers from is the text, and
 * keeping a second copy of every prospectus and policy PDF would grow
 * storage for something nothing reads back.
 */

/** Files above this are refused rather than silently truncated. Real
 *  business documents (a prospectus, a policy, a price list) sit far
 *  below it; anything larger is usually a scan, which has no extractable
 *  text anyway. */
const MAX_BYTES = 10 * 1024 * 1024

export async function POST(req: Request) {
  let ctx: { accountId: string }
  try {
    ctx = { accountId: (await requireRole('admin')).accountId }
  } catch (err) {
    return toErrorResponse(err)
  }

  const config = await prisma.aiConfig.findUnique({
    where: { account_id: ctx.accountId },
    select: { id: true },
  })
  if (!config) {
    return NextResponse.json({ error: 'Connect an AI provider first.' }, { status: 400 })
  }

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file was uploaded.' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'That file is empty.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is larger than ${Math.round(MAX_BYTES / 1024 / 1024)}MB.` },
      { status: 400 },
    )
  }

  let text: string
  try {
    text = await extractFileText(file)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : `Could not read that file. ${SUPPORTED_UPLOAD_HINT}` },
      { status: 400 },
    )
  }

  if (!text.trim()) {
    return NextResponse.json(
      {
        error:
          'No text could be read from that file. If it is a scanned PDF, the pages are images — the text has to be typed or pasted in instead.',
      },
      { status: 400 },
    )
  }

  const name = (form?.get('name') as string | null)?.trim() || file.name
  const requested = (form?.get('audience') as string | null)?.trim()
  // Same restrictive fallback as the JSON create path: anything
  // unrecognized lands on 'customer'.
  const audience = ['customer', 'internal', 'both'].includes(requested ?? '') ? requested! : 'customer'

  // Same dates the JSON path takes. An uploaded fee list has a closing
  // date as often as a typed one does.
  const parseDate = (value: FormDataEntryValue | null): Date | null => {
    const raw = typeof value === 'string' ? value.trim() : ''
    if (!raw) return null
    const parsed = new Date(raw)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  const effectiveFrom = parseDate(form?.get('effective_from') ?? null)
  const effectiveUntil = parseDate(form?.get('effective_until') ?? null)

  invalidateKnowledge(config.id)
  const item = await prisma.aiKnowledgeItem.create({
    data: {
      ai_config_id: config.id,
      account_id: ctx.accountId,
      kind: 'document',
      name: name.slice(0, 200),
      source: 'upload',
      content: text,
      description: (form?.get('description') as string | null)?.trim()?.slice(0, 2000) || null,
      audience,
      effective_from: effectiveFrom,
      effective_until: effectiveUntil,
      status: 'pending',
    },
  })

  return NextResponse.json({ item, characters: text.length }, { status: 201 })
}
