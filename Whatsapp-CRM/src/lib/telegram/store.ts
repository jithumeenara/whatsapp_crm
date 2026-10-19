/**
 * The account's Telegram bot, with its token decrypted for a call.
 * The decrypted token never leaves the server process.
 */

import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'

export const TELEGRAM_CHANNEL = 'telegram'

export interface LiveBot {
  id: string
  accountId: string
  userId: string
  username: string
  token: string
  webhookSecret: string
}

function live(row: { id: string; account_id: string; user_id: string; username: string; token_enc: string; webhook_secret: string }): LiveBot {
  return { id: row.id, accountId: row.account_id, userId: row.user_id, username: row.username, token: decrypt(row.token_enc), webhookSecret: row.webhook_secret }
}

export async function botForAccount(accountId: string): Promise<LiveBot | null> {
  const row = await prisma.telegramBot.findUnique({ where: { account_id: accountId } })
  if (!row || row.status === 'disconnected') return null
  return live(row)
}

export async function botById(id: string): Promise<LiveBot | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const row = await prisma.telegramBot.findUnique({ where: { id } })
  if (!row || row.status === 'disconnected') return null
  return live(row)
}

/**
 * The signing secret for start links, per account and stable: a link on a
 * printed brochure or QR code keeps working after the bot is reconnected.
 * Derived from the server's ENCRYPTION_KEY, so it is never stored and
 * differs for every account.
 */
export function startLinkSecret(accountId: string): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY is not set')
  return crypto.createHmac('sha256', key).update(`tg-start-links:${accountId}`).digest('hex')
}
