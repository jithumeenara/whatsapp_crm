/**
 * Email channel adapter — SendGrid.
 *
 * Outbound uses SendGrid's v3 Mail Send API. Inbound (2-way) uses SendGrid's
 * Inbound Parse Webhook, which has no signature by default — see
 * EmailConfig.inbound_secret, a per-account token embedded in the webhook
 * URL path itself as the substitute (built alongside the /api/email/webhook
 * route in Stage 3).
 */
import { prisma } from "@/lib/db"
import { encrypt, decrypt } from "@/lib/whatsapp/encryption"

const SENDGRID_SEND_URL = "https://api.sendgrid.com/v3/mail/send"
const SENDGRID_ACCOUNT_URL = "https://api.sendgrid.com/v3/user/account"

export interface EmailConfigResolved {
  apiKey: string
  fromEmail: string
  fromName: string | null
}

export async function loadEmailConfig(accountId: string): Promise<EmailConfigResolved | null> {
  const config = await prisma.emailConfig.findUnique({ where: { account_id: accountId } })
  if (!config) return null
  return {
    apiKey: decrypt(config.api_key),
    fromEmail: config.from_email,
    fromName: config.from_name,
  }
}

export async function saveEmailConfig(args: {
  accountId: string
  userId: string
  apiKey: string
  fromEmail: string
  fromName?: string | null
  inboundParseHost?: string | null
}) {
  const data = {
    api_key: encrypt(args.apiKey),
    from_email: args.fromEmail,
    from_name: args.fromName ?? null,
    inbound_parse_host: args.inboundParseHost ?? null,
  }
  return prisma.emailConfig.upsert({
    where: { account_id: args.accountId },
    create: { account_id: args.accountId, user_id: args.userId, ...data },
    update: data,
  })
}

export async function testEmailConnection(apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(SENDGRID_ACCOUNT_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { errors?: { message: string }[] }
      return { ok: false, message: data.errors?.[0]?.message ?? `SendGrid rejected the API key (HTTP ${res.status})` }
    }
    const data = await res.json() as { type?: string }
    return { ok: true, message: `Connected — ${data.type ?? "SendGrid"} account` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Unknown error contacting SendGrid" }
  }
}

export async function sendEmail(args: {
  accountId: string
  to: string
  subject: string
  text: string
  html?: string
}): Promise<{ messageId: string }> {
  const config = await loadEmailConfig(args.accountId)
  if (!config) throw new Error("Email (SendGrid) not configured for this account")

  const res = await fetch(SENDGRID_SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: args.to }] }],
      from: { email: config.fromEmail, name: config.fromName ?? undefined },
      subject: args.subject,
      content: [
        { type: "text/plain", value: args.text },
        ...(args.html ? [{ type: "text/html", value: args.html }] : []),
      ],
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { errors?: { message: string }[] }
    throw new Error(data.errors?.[0]?.message ?? `SendGrid send failed: HTTP ${res.status}`)
  }
  // SendGrid returns the message id in the X-Message-Id response header, not the (empty) body.
  const messageId = res.headers.get("x-message-id") ?? ""
  return { messageId }
}
