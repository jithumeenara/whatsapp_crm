import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { cleanNumbers } from '@/lib/whatsapp/staff-alert'

const DEFAULT_CONFIRM_MSG =
  "Hi {{name}}! Is that your real name? Please reply *Yes* to confirm or *No* to enter a different name."
const DEFAULT_ASK_NAME_MSG =
  "No problem! Please type your correct full name and I'll save it for you."

export async function GET() {
  try {
    const ctx = await requireRole('viewer')

    const config = await prisma.contactCaptureConfig.findUnique({
      where: { account_id: ctx.accountId },
    })

    return NextResponse.json({
      enabled: config?.enabled ?? false,
      confirm_message: config?.confirm_message ?? DEFAULT_CONFIRM_MSG,
      ask_name_message: config?.ask_name_message ?? DEFAULT_ASK_NAME_MSG,
      new_contact_alert_enabled: config?.new_contact_alert_enabled ?? false,
      new_contact_alert_numbers: config?.new_contact_alert_numbers ?? [],
      new_contact_alert_template: config?.new_contact_alert_template ?? null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(req: Request) {
  try {
    const ctx = await requireRole('admin')

    const body = await req.json() as {
      enabled?: boolean
      confirm_message?: string
      ask_name_message?: string
      new_contact_alert_enabled?: boolean
      new_contact_alert_numbers?: unknown
      new_contact_alert_template?: string | null
    }

    // Digits only, deduplicated. These become WhatsApp recipients;
    // anything else fails at Meta with an error nobody is watching for.
    const alertNumbers =
      body.new_contact_alert_numbers !== undefined
        ? cleanNumbers(body.new_contact_alert_numbers)
        : undefined
    const alertTemplate =
      body.new_contact_alert_template !== undefined
        ? body.new_contact_alert_template?.trim() || null
        : undefined

    const confirmMsg =
      typeof body.confirm_message === 'string' && body.confirm_message.trim()
        ? body.confirm_message.trim()
        : undefined

    const askNameMsg =
      typeof body.ask_name_message === 'string' && body.ask_name_message.trim()
        ? body.ask_name_message.trim()
        : undefined

    const config = await prisma.contactCaptureConfig.upsert({
      where: { account_id: ctx.accountId },
      update: {
        ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
        ...(confirmMsg ? { confirm_message: confirmMsg } : {}),
        ...(askNameMsg ? { ask_name_message: askNameMsg } : {}),
        ...(typeof body.new_contact_alert_enabled === 'boolean'
          ? { new_contact_alert_enabled: body.new_contact_alert_enabled }
          : {}),
        ...(alertNumbers !== undefined ? { new_contact_alert_numbers: alertNumbers } : {}),
        ...(alertTemplate !== undefined ? { new_contact_alert_template: alertTemplate } : {}),
      },
      create: {
        account_id: ctx.accountId,
        enabled: body.enabled ?? false,
        confirm_message: confirmMsg ?? DEFAULT_CONFIRM_MSG,
        ask_name_message: askNameMsg ?? DEFAULT_ASK_NAME_MSG,
        new_contact_alert_enabled: body.new_contact_alert_enabled ?? false,
        new_contact_alert_numbers: alertNumbers ?? [],
        new_contact_alert_template: alertTemplate ?? null,
      },
    })

    return NextResponse.json({
      enabled: config.enabled,
      confirm_message: config.confirm_message,
      ask_name_message: config.ask_name_message,
      new_contact_alert_enabled: config.new_contact_alert_enabled,
      new_contact_alert_numbers: config.new_contact_alert_numbers,
      new_contact_alert_template: config.new_contact_alert_template,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
