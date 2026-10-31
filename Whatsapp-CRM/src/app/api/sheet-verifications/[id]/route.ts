import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { assertPageAccess, requireRole, toErrorResponse } from '@/lib/auth/account'
import { cleanVerificationInput } from '@/lib/verify/sheet-verify'
import { ownsWhatsAppNumber } from '@/lib/verify/verify-brand'

/**
 * One "check details" list.
 *
 * GET     its settings
 * PATCH   change them (admin)
 * DELETE  remove it (admin): its links stop working; the sheet is untouched
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SETTINGS = {
  id: true, name: true, spreadsheet_id: true, spreadsheet_name: true, tab_title: true,
  name_column: true, phone_column: true, email_column: true, show_columns: true, edit_columns: true,
  filter_column: true, filter_value: true, deadline: true, language: true, intro: true,
  template_name: true, template_params: true, sms_text: true, email_subject: true, email_text: true,
  help_whatsapp_config_id: true, help_whatsapp_text: true, help_call_phone: true,
  status: true, sending_until: true, created_at: true,
} as const

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('supervisor')
    assertPageAccess(ctx, '/data')
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    const v = await prisma.sheetVerification.findFirst({ where: { id, account_id: ctx.accountId }, select: SETTINGS })
    if (!v) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    return NextResponse.json({ verification: v })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    assertPageAccess(ctx, '/data')
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    const parsed = cleanVerificationInput(await req.json().catch(() => null))
    if (!parsed.ok) return NextResponse.json({ error: parsed.problem }, { status: 400 })
    if (!(await ownsWhatsAppNumber(ctx.accountId, parsed.data.help_whatsapp_config_id))) {
      return NextResponse.json({ error: 'Choose one of your connected WhatsApp numbers.' }, { status: 400 })
    }
    const done = await prisma.sheetVerification.updateMany({ where: { id, account_id: ctx.accountId }, data: parsed.data })
    if (!done.count) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    const v = await prisma.sheetVerification.findFirst({ where: { id, account_id: ctx.accountId }, select: SETTINGS })
    return NextResponse.json({ verification: v })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    assertPageAccess(ctx, '/data')
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    const done = await prisma.sheetVerification.deleteMany({ where: { id, account_id: ctx.accountId } })
    if (!done.count) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
