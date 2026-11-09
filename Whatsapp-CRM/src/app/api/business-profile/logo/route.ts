import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { contentMatchesType, readAccountFile, saveAccountFile } from '@/lib/files/account-files'
import { imageProblem } from '@/lib/files/image-size'

/**
 * The logo printed at the top of report PDFs.
 *
 * PNG or JPEG only: the PDF writer takes nothing else, and SVG can carry
 * script. The real type is read from the bytes, never from what the sender
 * says it is; the size and the pixel count are capped so a crafted image
 * cannot exhaust the server when the PDF is built; the file is stored under
 * a random name in the business's own folder and read back only from there.
 */

const TYPES = new Set(['image/png', 'image/jpeg'])
const MAX_BYTES = 2 * 1024 * 1024
const UPLOAD_LIMIT = { limit: 10, windowMs: 60_000 }

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

export async function POST(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const limited = checkRateLimit(`business-logo:${ctx.userId}`, UPLOAD_LIMIT)
    if (!limited.success) return rateLimitResponse(limited)

    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!file || typeof file === 'string') return bad('Choose a logo file to upload.')

    if (!TYPES.has(file.type)) return bad('The logo must be a PNG or JPEG image.')
    if (file.size > MAX_BYTES) return bad('The logo must be 2 MB or smaller.', 413)

    const bytes = Buffer.from(await file.arrayBuffer())
    if (bytes.length > MAX_BYTES) return bad('The logo must be 2 MB or smaller.', 413)
    // What the file really is, from its first bytes.
    if (!contentMatchesType(file.type, bytes)) return bad('That file is not a real PNG or JPEG image.')
    // The whole structure, not just the first bytes: a PNG with a fine header
    // and corrupt data would crash the PDF writer later (see image-size.ts).
    const problem = imageProblem(file.type, bytes)
    if (problem) return bad(problem)

    const saved = await saveAccountFile({ accountId: ctx.accountId, name: 'business-logo', mime: file.type, bytes })
    await prisma.accountReportProfile.upsert({
      where: { account_id: ctx.accountId },
      update: { logo_file_id: saved.id, updated_at: new Date() },
      create: { account_id: ctx.accountId, logo_file_id: saved.id },
    })
    await auditConfigChange(auditCtx(req, ctx), 'config.other_changed', {
      area: 'business_profile',
      fields: ['logo'],
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function GET() {
  try {
    const ctx = await requireRole('viewer')
    const profile = await prisma.accountReportProfile.findUnique({
      where: { account_id: ctx.accountId },
      select: { logo_file_id: true },
    })
    if (!profile?.logo_file_id) return new Response(null, { status: 404 })

    // Only from this business's own folder; null when the id is not theirs.
    const file = await readAccountFile(ctx.accountId, profile.logo_file_id, MAX_BYTES).catch(() => null)
    if (!file || !TYPES.has(file.mime) || !contentMatchesType(file.mime, file.bytes)) {
      return new Response(null, { status: 404 })
    }
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        'Content-Type': file.mime,
        'Content-Length': String(file.bytes.length),
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(req?: Request) {
  try {
    const ctx = await requireRole('admin')
    await prisma.accountReportProfile.updateMany({
      where: { account_id: ctx.accountId },
      data: { logo_file_id: null, updated_at: new Date() },
    })
    await auditConfigChange(auditCtx(req ?? new Request('http://local/'), ctx), 'config.other_changed', {
      area: 'business_profile',
      fields: ['logo'],
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
