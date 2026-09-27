import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { contentMatchesType, isAllowedMime, saveAccountFile } from '@/lib/files/account-files'

/**
 * A file from the agent's own PC or phone, for an email.
 *
 * Saved into the account's File Manager like any other upload, but held
 * to the email's own rules first: one of the allowed types, no larger
 * than a single Microsoft Graph attachment (3 MB), and — unlike the
 * general upload, which believes the browser — the bytes must really be
 * the type the name claims, so a renamed .exe cannot go out as a PDF.
 */

const MAX_BYTES = 3 * 1024 * 1024 - 1
const LIMIT = { limit: 30, windowMs: 10 * 60_000 }

/** Some browsers send no type for perfectly ordinary files. */
const BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
}

export async function POST(req: Request) {
  let ctx: Awaited<ReturnType<typeof requireRole>>
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const limited = checkRateLimit(`email-attach:${ctx.userId}`, LIMIT)
  if (!limited.success) return rateLimitResponse(limited)

  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ error: 'That file is over 3 MB — email attachments can be 3 MB each.' }, { status: 413 })
  }

  try {
    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file was sent.' }, { status: 400 })
    if (file.size === 0) return NextResponse.json({ error: 'That file is empty.' }, { status: 400 })
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `${file.name} is over 3 MB — email attachments can be 3 MB each.` }, { status: 413 })
    }

    const ext = (file.name.split('.').pop() ?? '').toLowerCase()
    const mime = file.type && isAllowedMime(file.type) ? file.type : BY_EXTENSION[ext] ?? file.type
    if (!mime || !isAllowedMime(mime)) {
      return NextResponse.json(
        { error: `${file.name}: this type of file cannot be attached. PDF, images, Word, Excel, PowerPoint, text and MP4 can.` },
        { status: 415 },
      )
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    if (!contentMatchesType(mime, bytes)) {
      return NextResponse.json(
        { error: `${file.name} is not really a ${ext.toUpperCase() || 'file of that type'} — it was not attached.` },
        { status: 415 },
      )
    }

    const saved = await saveAccountFile({ accountId: ctx.accountId, name: file.name, mime, bytes })
    return NextResponse.json({
      file: { id: saved.id, name: saved.original_name, size: saved.size, url: saved.url, mime: saved.mime_type },
    })
  } catch (err) {
    console.error('[email-attach] upload failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'The file could not be saved. Try again.' }, { status: 500 })
  }
}
