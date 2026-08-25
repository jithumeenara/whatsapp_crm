/**
 * SMS channel adapter — MSG91 or TextBee (textbee.dev), picked per-account
 * via SmsConfig.provider. Both share one encrypted secret slot
 * (SmsConfig.auth_key) and one webhook route (/api/sms/webhook/[secret]) —
 * see that route for how inbound payloads are told apart.
 *
 * MSG91: the exact request/response shape below follows MSG91's commonly
 * documented v2 JSON Send SMS API. MSG91's API surface has shifted over the
 * years (v2 → v5 flow-based sends) and India's DLT regulations require the
 * message content to match a pre-registered template for reliable carrier
 * delivery — verify both the endpoint shape and DLT template requirements
 * against MSG91's current docs before relying on this in production.
 * `SmsConfig.dlt_template_id` is already in the schema for when that
 * verification lands.
 *
 * TextBee: implemented directly from https://textbee.dev/docs (API
 * reference + openapi.json + receiving-sms + webhooks pages) — an
 * Android-phone-as-SMS-gateway service. Auth is a plain `x-api-key`
 * header; base URL is https://api.textbee.dev.
 */
import { prisma } from "@/lib/db"
import { encrypt, decrypt } from "@/lib/whatsapp/encryption"
import crypto from "crypto"

const MSG91_SEND_URL = "https://api.msg91.com/api/v2/sendsms"
const MSG91_BALANCE_URL = "https://api.msg91.com/api/v5/balance"

const TEXTBEE_BASE_URL = "https://api.textbee.dev/api/v1"

export type SmsProvider = "msg91" | "textbee"

export interface SmsConfigResolved {
  provider: SmsProvider
  authKey: string
  senderId: string | null
  route: string | null
  deviceId: string | null
}

export async function loadSmsConfig(accountId: string): Promise<SmsConfigResolved | null> {
  const config = await prisma.smsConfig.findUnique({ where: { account_id: accountId } })
  if (!config) return null
  return {
    provider: (config.provider === "textbee" ? "textbee" : "msg91"),
    authKey: decrypt(config.auth_key),
    senderId: config.sender_id,
    route: config.route,
    deviceId: config.device_id,
  }
}

/** Encrypts and upserts the account's SMS credentials (either provider). */
export async function saveSmsConfig(args: {
  accountId: string
  userId: string
  provider: SmsProvider
  authKey: string
  senderId?: string | null
  route?: string | null
  dltEntityId?: string | null
  dltTemplateId?: string | null
  deviceId?: string | null
}) {
  const data = {
    provider: args.provider,
    auth_key: encrypt(args.authKey),
    sender_id: args.provider === "msg91" ? (args.senderId ?? null) : null,
    route: args.provider === "msg91" ? (args.route ?? "4") : null,
    dlt_entity_id: args.provider === "msg91" ? (args.dltEntityId ?? null) : null,
    dlt_template_id: args.provider === "msg91" ? (args.dltTemplateId ?? null) : null,
    device_id: args.provider === "textbee" ? (args.deviceId ?? null) : null,
  }
  return prisma.smsConfig.upsert({
    where: { account_id: args.accountId },
    create: { account_id: args.accountId, user_id: args.userId, ...data },
    update: data,
  })
}

/** Lightweight "is this key valid" probe — no message is sent. */
export async function testSmsConnection(
  provider: SmsProvider,
  authKey: string,
): Promise<{ ok: boolean; message: string }> {
  if (provider === "textbee") return testTextBeeConnection(authKey)
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

async function testTextBeeConnection(apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${TEXTBEE_BASE_URL}/gateway/devices`, {
      method: "GET",
      headers: { "x-api-key": apiKey },
    })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: "TextBee rejected the API key" }
    }
    if (!res.ok) return { ok: false, message: `TextBee error (HTTP ${res.status})` }
    const json = await res.json().catch(() => ({} as { data?: unknown[] }))
    const devices = Array.isArray(json?.data) ? json.data : []
    if (devices.length === 0) {
      return { ok: true, message: "Connected — but no device registered yet. Install the TextBee Android app and register a device before sending." }
    }
    const enabledCount = devices.filter((d: unknown) => (d as { enabled?: boolean } | undefined)?.enabled).length
    return { ok: true, message: `Connected — ${devices.length} device${devices.length === 1 ? "" : "s"} registered (${enabledCount} enabled).` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Unknown error contacting TextBee" }
  }
}

export async function sendSmsText(args: {
  accountId: string
  to: string
  text: string
}): Promise<{ messageId: string }> {
  const config = await loadSmsConfig(args.accountId)
  if (!config) throw new Error("SMS not configured for this account")
  return sendSmsWithCreds({ provider: config.provider, authKey: config.authKey, senderId: config.senderId, route: config.route, deviceId: config.deviceId, to: args.to, text: args.text })
}

/** Shared by both the real accountId-based send path and the "send a test
 *  message" settings action, which sends against freshly-entered (not yet
 *  necessarily saved) credentials. */
export async function sendSmsWithCreds(args: {
  provider: SmsProvider
  authKey: string
  senderId?: string | null
  route?: string | null
  deviceId?: string | null
  to: string
  text: string
}): Promise<{ messageId: string }> {
  if (args.provider === "textbee") return sendTextBeeSms(args)

  const res = await fetch(MSG91_SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", authkey: args.authKey },
    body: JSON.stringify({
      sender: args.senderId ?? undefined,
      route: args.route ?? "4",
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

async function sendTextBeeSms(args: {
  authKey: string
  deviceId?: string | null
  to: string
  text: string
}): Promise<{ messageId: string }> {
  const res = await fetch(`${TEXTBEE_BASE_URL}/gateway/send-sms`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": args.authKey },
    body: JSON.stringify({
      message: args.text,
      recipients: [args.to],
      ...(args.deviceId ? { deviceId: args.deviceId } : {}),
    }),
  })
  const json = await res.json().catch(() => ({})) as {
    data?: { success?: boolean; smsBatchId?: string }
    message?: string
    error?: string
  }
  if (!res.ok || json?.data?.success === false) {
    throw new Error(json.message ?? json.error ?? `TextBee send failed: HTTP ${res.status}`)
  }
  // TextBee's send-sms response only confirms dispatch to the phone (not
  // per-recipient delivery), keyed by a batch id rather than a single
  // message id — used the same way the MSG91 request_id is used elsewhere
  // (stored for reference, not depended on for status tracking).
  return { messageId: json?.data?.smsBatchId ?? "" }
}

/**
 * Auto-registers (or updates) the inbound-SMS webhook subscription on
 * TextBee's side, so the user never has to paste a URL into their TextBee
 * dashboard by hand — unlike MSG91, TextBee exposes a webhook management
 * API (POST/PATCH /api/v1/webhooks), so this can just be done for them.
 * Never throws — webhook auto-setup is a nice-to-have, not a precondition
 * for saving valid credentials; on failure the caller keeps whatever
 * webhook id it already had (if any) and the settings UI surfaces a
 * fallback "configure it manually" hint.
 */
export async function registerTextBeeWebhook(args: {
  apiKey: string
  deliveryUrl: string
  signingSecret: string
  existingWebhookId?: string | null
}): Promise<{ ok: boolean; webhookId: string | null; message?: string }> {
  const body = {
    name: "WhatsApp CRM — Inbound SMS",
    deliveryUrl: args.deliveryUrl,
    signingSecret: args.signingSecret,
    events: ["MESSAGE_RECEIVED"],
    isActive: true,
  }
  try {
    if (args.existingWebhookId) {
      const res = await fetch(`${TEXTBEE_BASE_URL}/webhooks/${args.existingWebhookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-api-key": args.apiKey },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const json = await res.json().catch(() => ({} as { data?: { _id?: string } }))
        return { ok: true, webhookId: json?.data?._id ?? args.existingWebhookId }
      }
      // Subscription may have been deleted on TextBee's side since — fall
      // through and try creating a fresh one instead of failing outright.
    }
    const res = await fetch(`${TEXTBEE_BASE_URL}/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": args.apiKey },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({} as { data?: { _id?: string }; message?: string }))
    if (!res.ok) {
      return { ok: false, webhookId: args.existingWebhookId ?? null, message: json?.message ?? `HTTP ${res.status}` }
    }
    return { ok: true, webhookId: json?.data?._id ?? null }
  } catch (err) {
    return { ok: false, webhookId: args.existingWebhookId ?? null, message: err instanceof Error ? err.message : "Unknown error" }
  }
}

/** Best-effort cleanup when a TextBee config is reset — never throws. */
export async function deleteTextBeeWebhook(apiKey: string, webhookId: string): Promise<void> {
  try {
    await fetch(`${TEXTBEE_BASE_URL}/webhooks/${webhookId}`, {
      method: "DELETE",
      headers: { "x-api-key": apiKey },
    })
  } catch {
    // Reset already removes our own record of it; a leftover subscription
    // on TextBee's side is harmless (it'll just keep POSTing to a URL that
    // no longer resolves to any account, silently failing on their end).
  }
}

/** HMAC-SHA256 over the raw JSON body, per textbee.dev/docs/webhooks. */
export function verifyTextBeeSignature(rawBody: string, signature: string | null, signingSecret: string): boolean {
  if (!signature) return false
  const expected = crypto.createHmac("sha256", signingSecret).update(rawBody).digest("hex")
  const a = Buffer.from(expected, "utf8")
  const b = Buffer.from(signature, "utf8")
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
