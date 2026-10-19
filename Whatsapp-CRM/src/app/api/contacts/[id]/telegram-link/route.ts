import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { botForAccount, startLinkSecret } from '@/lib/telegram/store'
import { signStartPayload, startLink } from '@/lib/telegram/links'

/**
 * GET /api/contacts/[id]/telegram-link — a t.me link made for this
 * contact. When they open it and press Start, their Telegram chat joins
 * this contact (same history, same lead) instead of starting a new one.
 * Signed, so a link cannot be edited to join someone else's record.
 */

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    const contact = await prisma.contact.findFirst({ where: { id, account_id: ctx.accountId }, select: { id: true, telegram_id: true } })
    if (!contact) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 })
    const bot = await botForAccount(ctx.accountId)
    if (!bot) return NextResponse.json({ error: 'Telegram is not connected. Connect it in Settings → Channels → Telegram.' }, { status: 409 })
    return NextResponse.json({
      link: startLink(bot.username, signStartPayload(contact.id, startLinkSecret(ctx.accountId))),
      already_on_telegram: Boolean(contact.telegram_id),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
