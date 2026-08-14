/**
 * SMS channel adapter — MSG91.
 *
 * NOTE: the exact request/response shape below follows MSG91's commonly
 * documented v2 JSON Send SMS API. MSG91's API surface has shifted over the
 * years (v2 → v5 flow-based sends) and India's DLT regulations require the
 * message content to match a pre-registered template for reliable carrier
 * delivery — verify both the endpoint shape and DLT template requirements
 * against MSG91's current docs during Stage 3 before relying on this in
 * production. `SmsConfig.dlt_template_id` is already in the schema for when
 * that verification lands.
 */
import { prisma } from "@/lib/db"
import { encrypt, decrypt } from "@/lib/whatsapp/encryption"

const MSG91_SEND_URL = "https://api.msg91.com/api/v2/sendsms"
const MSG91_BALANCE_URL = "https://api.msg91.com/api/v5/balance"

export interface SmsConfigResolved {
  authKey: string
  senderId: string | null
  route: string | null
}

export async function loadSmsConfig(accountId: string): Promise<SmsConfigResolved | null> {
  const config = await prisma.smsConfig.findUnique({ where: { account_id: accountId } })
  if (!config) return null
  return {
    authKey: decrypt(config.auth_key),
    senderId: config.sender_id,
    route: config.route,
  }
}

/** Encrypts and upserts the account's MSG91 credentials. */
export async function saveSmsConfig(args: {
  accountId: string
  userId: string
  authKey: string
  senderId?: string | null
  route?: string | null
  dltEntityId?: string | null
  dltTemplateId?: string | null
}) {
  const data = {
    auth_key: encrypt(args.authKey),
    sender_id: args.senderId ?? null,
    route: args.route ?? "4",
    dlt_entity_id: args.dltEntityId ?? null,
    dlt_template_id: args.dltTemplateId ?? null,
  }
  return prisma.smsConfig.upsert({
    where: { account_id: args.accountId },
    create: { account_id: args.accountId, user_id: args.userId, ...data },
    update: data,
  })
}

/** Lightweight "is this key valid" probe — MSG91's balance-check endpoint. */
export async function testSmsConnection(authKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${MSG91_BALANCE_URL}?authkey=${encodeURIComponent(authKey)}&type=4`, {
      method: "GET",
    })
    if (!res.ok) return { ok: false, message: `MSG91 rejected the auth key (HTTP ${res.status})` }
    const text = await res.text()
    // MSG91's balance endpoint returns a bare number/string on success, or an
    // error message string on failure — no structured JSON envelope.
    if (/error|invalid/i.test(text)) return { ok: false, message: text }
    return { ok: true, message: `Connected — balance: ${text.trim()}` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Unknown error contacting MSG91" }
  }
}

export async function sendSmsText(args: {
  accountId: string
  to: string
  text: string
}): Promise<{ messageId: string }> {
  const config = await loadSmsConfig(args.accountId)
  if (!config) throw new Error("SMS (MSG91) not configured for this account")

  const res = await fetch(MSG91_SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", authkey: config.authKey },
    body: JSON.stringify({
      sender: config.senderId ?? undefined,
      route: config.route ?? "4",
      country: "91",
      sms: [{ message: args.text, to: [args.to] }],
    }),
  })
  const data = await res.json().catch(() => ({})) as { type?: string; message?: string; request_id?: string }
  if (!res.ok || data.type === "error") {
    throw new Error(data.message ?? `MSG91 send failed: HTTP ${res.status}`)
  }
  return { messageId: data.request_id ?? "" }
}
