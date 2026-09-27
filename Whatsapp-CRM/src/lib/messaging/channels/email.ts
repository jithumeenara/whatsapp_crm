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
import { accessTokenFor, connectedMailbox, findByInternetMessageId, sendGraphEmail } from "@/lib/email/microsoft/graph"
import { escapeHtml, markupToHtml, markupToPlain } from "@/lib/email/markup"

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

/** Plain text as HTML: escaped, line breaks kept. */
function plainToHtml(text: string): string {
  return `<p style="margin:0 0 12px">${escapeHtml(text).replace(/\r?\n/g, "<br>")}</p>`
}

export interface EmailAttachment {
  name: string
  mime: string
  bytes: Buffer
}

export async function sendEmail(args: {
  accountId: string
  /** One address, or several (a forward). */
  to: string | string[]
  subject: string
  text: string
  html?: string
  cc?: string[]
  bcc?: string[]
  attachments?: EmailAttachment[]
  /** reply / reply_all / forward act on the email named by `inReplyTo`
   *  (an Internet Message-ID, or "graph:<id>"); with a Microsoft mailbox
   *  they stay in its thread. "new" (the default without inReplyTo) is a
   *  separate email. */
  kind?: "new" | "reply" | "reply_all" | "forward"
  inReplyTo?: string | null
  /** "rich": `text` is the composer's markup (bold, lists…). */
  format?: "rich" | "plain"
}): Promise<{ messageId: string }> {
  const toList = Array.isArray(args.to) ? args.to : [args.to]
  if (toList.length === 0) throw new Error("No recipient")
  const cc = args.cc ?? []
  const bcc = args.bcc ?? []
  const attachments = args.attachments ?? []
  // Formatting is applied only to what the email composer wrote. A
  // chatbot's or the assistant's text is sent as it is — its WhatsApp-
  // style *asterisks* are not this composer's markup.
  const html = args.html ?? (args.format === "rich" ? markupToHtml(args.text) : plainToHtml(args.text))

  // A mailbox connected with Microsoft sends as itself, and what it sends
  // lands in its Sent Items like any other. SendGrid is the fallback.
  const microsoft = await connectedMailbox(args.accountId)
  if (microsoft) {
    const token = await accessTokenFor(microsoft)
    let kind = args.kind ?? (args.inReplyTo ? "reply" : "new")
    let sourceId: string | null = null
    if (kind !== "new" && args.inReplyTo) {
      sourceId = args.inReplyTo.startsWith("graph:")
        ? args.inReplyTo.slice(6)
        : await findByInternetMessageId(token, args.inReplyTo).catch(() => null)
    }
    // The original is gone from the mailbox: a new email with the same
    // "Re:" subject is the closest thing to a reply left. A forward
    // cannot happen without it.
    if (!sourceId && kind !== "new") {
      if (kind === "forward") throw new Error("The email to forward is no longer in the mailbox")
      kind = "new"
    }
    await sendGraphEmail(token, {
      kind,
      sourceId,
      to: toList,
      cc,
      bcc,
      subject: args.subject,
      html,
      attachments,
    })
    // Graph's send returns no message id.
    return { messageId: "" }
  }

  const config = await loadEmailConfig(args.accountId)
  if (!config) throw new Error("Email is not connected for this account")

  const res = await fetch(SENDGRID_SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      personalizations: [{
        to: toList.map((email) => ({ email })),
        ...(cc.length ? { cc: cc.map((email) => ({ email })) } : {}),
        ...(bcc.length ? { bcc: bcc.map((email) => ({ email })) } : {}),
      }],
      from: { email: config.fromEmail, name: config.fromName ?? undefined },
      subject: args.subject,
      content: [
        { type: "text/plain", value: args.format === "rich" ? markupToPlain(args.text) : args.text },
        { type: "text/html", value: html },
      ],
      ...(attachments.length
        ? {
            attachments: attachments.map((a) => ({
              content: a.bytes.toString("base64"),
              filename: a.name,
              type: a.mime,
              disposition: "attachment",
            })),
          }
        : {}),
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
