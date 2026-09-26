import { NextRequest, NextResponse } from "next/server"
import { clientIpKey } from "@/lib/net/client-ip"
import { prisma } from "@/lib/db"
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit"
import { processInbound } from "@/lib/email/ingest"

/**
 * Inbound email webhook — SendGrid Inbound Parse.
 *
 * Inbound Parse has no signature header by default (unlike SendGrid's
 * separate Event Webhook, which uses Ed25519 and isn't built here — see
 * EmailConfig.webhook_public_key, a stretch item). The per-account secret in
 * the URL path is the substitute: both authenticates the request and
 * resolves which account it belongs to.
 */

async function resolveAccountBySecret(secret: string) {
  return prisma.emailConfig.findFirst({
    where: { inbound_secret: secret },
    select: { account_id: true, user_id: true },
  })
}

function getClientIp(request: NextRequest): string {
  return clientIpKey(request.headers)
}

/** Extracts a bare email address from SendGrid's `"Name" <email@x.com>` From format. */
function extractEmailAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/)
  return (match ? match[1] : raw).trim().toLowerCase()
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ secret: string }> }) {
  // Per-IP limit before anything else — this endpoint's auth is a
  // URL-embedded secret rather than a cryptographic signature (see the
  // module comment), so this also slows secret-guessing brute force,
  // belt-and-braces alongside the secret's own entropy.
  const limit = checkRateLimit(`email-webhook:${getClientIp(request)}`, RATE_LIMITS.inboundWebhookSecret)
  if (!limit.success) return rateLimitResponse(limit)

  const { secret } = await params
  const config = await resolveAccountBySecret(secret)
  if (!config) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let form: FormData
  try {
    form = await request.formData()
  } catch (err) {
    console.error("[email webhook] failed to parse form data:", err)
    return NextResponse.json({ status: "received" })
  }

  const fromRaw = String(form.get("from") ?? "")
  const subject = String(form.get("subject") ?? "")
  const text = String(form.get("text") ?? "").trim()
  const html = String(form.get("html") ?? "") || null

  const fromEmail = extractEmailAddress(fromRaw)
  if (!fromEmail || !text) {
    console.warn("[email webhook] missing from/text in Inbound Parse payload")
    return NextResponse.json({ status: "received" })
  }

  processInbound(config.account_id, config.user_id, { fromEmail, subject, text, html }).catch((err) =>
    console.error("[email webhook] processing failed:", err)
  )

  return NextResponse.json({ status: "received" })
}
