/**
 * RCS channel adapter — Twilio.
 *
 * Uses Twilio's Programmable Messaging API — when the configured sender is
 * in an RCS-enabled Messaging Service's sender pool, Twilio sends RCS first
 * and automatically falls back to SMS/MMS if the recipient's device doesn't
 * support it. Real carrier/agent approval is a separate, external ~4-6 week
 * process on Twilio's side — this adapter works the same whether that's
 * pending or complete (Twilio just falls back to SMS until it's approved).
 *
 * Rich content (cards/carousels, mapped from the chatbot builder's
 * send_buttons/send_list nodes) requires pre-created Twilio Content API
 * templates referenced by content_sid — NOT implemented here yet. See the
 * implementation plan's Stage 3 note: spike against Twilio's sandbox before
 * committing to that mapping. sendRcsText below covers the MVP plain-text
 * case, which is what send_text/ai_reply/chatbot text nodes need.
 */
import twilio from "twilio"
import { prisma } from "@/lib/db"
import { encrypt, decrypt } from "@/lib/whatsapp/encryption"

export interface RcsConfigResolved {
  accountSid: string
  authToken: string
  messagingServiceSid: string | null
  fromNumber: string | null
}

export async function loadRcsConfig(accountId: string): Promise<RcsConfigResolved | null> {
  const config = await prisma.rcsConfig.findUnique({ where: { account_id: accountId } })
  if (!config) return null
  return {
    accountSid: config.account_sid,
    authToken: decrypt(config.auth_token),
    messagingServiceSid: config.messaging_service_sid,
    fromNumber: config.from_number,
  }
}

export async function saveRcsConfig(args: {
  accountId: string
  userId: string
  accountSid: string
  authToken: string
  messagingServiceSid?: string | null
  fromNumber?: string | null
}) {
  const data = {
    account_sid: args.accountSid,
    auth_token: encrypt(args.authToken),
    messaging_service_sid: args.messagingServiceSid ?? null,
    from_number: args.fromNumber ?? null,
  }
  return prisma.rcsConfig.upsert({
    where: { account_id: args.accountId },
    create: { account_id: args.accountId, user_id: args.userId, ...data },
    update: data,
  })
}

export async function testRcsConnection(
  accountSid: string,
  authToken: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const client = twilio(accountSid, authToken)
    const account = await client.api.v2010.accounts(accountSid).fetch()
    return { ok: true, message: `Connected — account status: ${account.status}` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Unknown error contacting Twilio" }
  }
}

export async function sendRcsText(args: {
  accountId: string
  to: string
  text: string
}): Promise<{ messageId: string }> {
  const config = await loadRcsConfig(args.accountId)
  if (!config) throw new Error("RCS (Twilio) not configured for this account")
  if (!config.messagingServiceSid && !config.fromNumber) {
    throw new Error("RCS config is missing both messaging_service_sid and from_number")
  }

  const client = twilio(config.accountSid, config.authToken)
  const message = await client.messages.create({
    to: args.to,
    body: args.text,
    ...(config.messagingServiceSid
      ? { messagingServiceSid: config.messagingServiceSid }
      : { from: config.fromNumber! }),
  })
  return { messageId: message.sid }
}

/**
 * Twilio's request-signature verification, for the inbound RCS webhook.
 * Built now so /api/rcs/webhook (Stage 3) doesn't have to hand-roll it.
 */
export function verifyTwilioSignature(args: {
  authToken: string
  signature: string | null
  url: string
  params: Record<string, string>
}): boolean {
  if (!args.signature) return false
  return twilio.validateRequest(args.authToken, args.signature, args.url, args.params)
}
