/**
 * Single source of truth for "which connected WhatsApp number applies
 * here" (Finding #14 — multiple numbers per tenant). Every send path
 * used to do `whatsAppConfig.findUnique({ where: { account_id } })`,
 * which silently assumed exactly one number per account. Now that an
 * account can have several `WhatsAppConfig` rows, every one of those
 * call sites resolves through this instead, so the priority order lives
 * in exactly one place.
 *
 * Priority: an explicit `whatsappConfigId` (the caller already knows
 * exactly which number, e.g. a broadcast's own choice) → the bound
 * number of a given `conversationId` (a reply should come from the
 * number that received the thread, not a global default) → the
 * account's `is_default` row (an ad-hoc admin action with no
 * conversation context, e.g. a test message).
 */
import { prisma } from '@/lib/db'
import type { WhatsAppConfig } from '@prisma/client'

export class NoWhatsAppConfigError extends Error {
  constructor(accountId: string) {
    super(`No WhatsApp number connected for account ${accountId}.`)
    this.name = 'NoWhatsAppConfigError'
  }
}

export async function resolveWhatsAppConfig(args: {
  accountId: string
  conversationId?: string | null
  whatsappConfigId?: string | null
}): Promise<WhatsAppConfig> {
  const { accountId, conversationId, whatsappConfigId } = args

  if (whatsappConfigId) {
    const config = await prisma.whatsAppConfig.findFirst({
      where: { id: whatsappConfigId, account_id: accountId },
    })
    if (config) return config
    // Fall through to the other strategies rather than hard-failing —
    // a stale/deleted whatsappConfigId shouldn't break the send when a
    // perfectly good default number is available.
  }

  if (conversationId) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { whatsapp_config_id: true },
    })
    if (conversation?.whatsapp_config_id) {
      const config = await prisma.whatsAppConfig.findFirst({
        where: { id: conversation.whatsapp_config_id, account_id: accountId },
      })
      if (config) return config
    }
  }

  const defaultConfig = await prisma.whatsAppConfig.findFirst({
    where: { account_id: accountId, is_default: true },
  })
  if (defaultConfig) return defaultConfig

  // Legacy safety net — an account whose sole number somehow never got
  // is_default set (shouldn't happen after migration 055's backfill,
  // but a fresh Manual Connect that predates a later bug fix could).
  const anyConfig = await prisma.whatsAppConfig.findFirst({ where: { account_id: accountId } })
  if (anyConfig) return anyConfig

  throw new NoWhatsAppConfigError(accountId)
}
