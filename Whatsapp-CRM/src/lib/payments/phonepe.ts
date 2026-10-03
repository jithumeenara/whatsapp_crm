/**
 * PhonePe Payment Gateway — payment links, sent into a WhatsApp chat.
 *
 * ── Why links, and not WhatsApp's own in-chat payments ───────────────
 *
 * Meta's in-chat payments (the order_details message) accept four
 * gateways in India — BillDesk, Razorpay, PayU, Zaakpay — and PhonePe is
 * not one of them. A PhonePe payment link is an ordinary https URL, so it
 * travels in an ordinary WhatsApp message (a "Pay" button), needs no
 * approval from Meta, and the customer pays on PhonePe's own page with
 * UPI, a card or net banking.
 *
 * ── What is trusted, and what is not ─────────────────────────────────
 *
 * A payment is marked paid only on PhonePe's answer to a status call made
 * from this server with this tenant's own token — never on a webhook
 * alone. PhonePe's webhook carries SHA256(username:password) as its
 * Authorization header: the same value on every call, not a signature
 * over the body, so whoever learns it once could forge any event. Here a
 * webhook only says "go and look", and the look decides. The amount PhonePe
 * reports is checked against the amount this app asked for.
 *
 * Every endpoint, field and limit below is from PhonePe's developer
 * documentation (developer.phonepe.com/payment-gateway): Authorization,
 * Create Payment Link, Payment Link Status, Webhook Handling, and the UAT
 * checklist's token-renewal rule.
 */

import crypto from 'node:crypto'

export type PhonePeEnvironment = 'sandbox' | 'production'

export interface PhonePeCredentials {
  clientId: string
  clientSecret: string
  clientVersion: string
  environment: PhonePeEnvironment
  /** The username and password typed into PhonePe's dashboard when the
   *  webhook was created ("SHA" authentication). */
  webhookUsername: string
  webhookPassword: string
}

const HOSTS: Record<PhonePeEnvironment, { token: string; paylinks: string }> = {
  sandbox: {
    token: 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token',
    paylinks: 'https://api-preprod.phonepe.com/apis/pg-sandbox/paylinks/v1',
  },
  production: {
    token: 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token',
    paylinks: 'https://api.phonepe.com/apis/pg/paylinks/v1',
  },
}

/** A slow PhonePe must not hold an agent's click, or a webhook, open. */
const REQUEST_TIMEOUT_MS = 10_000

/** PhonePe's UAT checklist: renew 3–5 minutes before expiry. */
const RENEW_BEFORE_EXPIRY_S = 5 * 60

/** PhonePe's limit on a payment link's lifetime is 45 days. */
export const MAX_LINK_LIFETIME_MS = 45 * 24 * 60 * 60_000

/** merchantOrderId: at most 63 characters; letters, digits, _ and - only. */
const MERCHANT_ORDER_ID = /^[A-Za-z0-9_-]{1,63}$/

export class PhonePeError extends Error {
  readonly status: number
  readonly code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'PhonePeError'
    this.status = status
    this.code = code
  }
}

// ── Access token ─────────────────────────────────────────────────────

interface CachedToken {
  accessToken: string
  /** Epoch seconds. */
  expiresAt: number
}

/** Keyed by environment, client and a hash of the secret, so a changed
 *  secret is never answered with the old secret's token. Only the hash is
 *  kept; the secret itself is not. */
const tokenCache = new Map<string, CachedToken>()

function cacheKey(c: PhonePeCredentials): string {
  const secretHash = crypto.createHash('sha256').update(c.clientSecret).digest('hex').slice(0, 16)
  return `${c.environment}:${c.clientId}:${c.clientVersion}:${secretHash}`
}

/** Test seam: the cache is process-wide. */
export function clearPhonePeTokenCache(): void {
  tokenCache.clear()
}

export async function getPhonePeAccessToken(c: PhonePeCredentials, now: number = Date.now()): Promise<string> {
  const key = cacheKey(c)
  const cached = tokenCache.get(key)
  if (cached && cached.expiresAt - RENEW_BEFORE_EXPIRY_S > now / 1000) return cached.accessToken

  const response = await fetch(HOSTS[c.environment].token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_version: c.clientVersion,
      client_secret: c.clientSecret,
      grant_type: 'client_credentials',
    }).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const data = (await response.json().catch(() => null)) as {
    access_token?: string
    expires_at?: number
    code?: string
    message?: string
  } | null

  if (!response.ok || !data?.access_token) {
    tokenCache.delete(key)
    // PhonePe's own words, never the credentials that were sent.
    throw new PhonePeError(
      `PhonePe did not accept these credentials${data?.message ? `: ${data.message}` : ` (${response.status})`}`,
      response.status || 502,
      data?.code,
    )
  }

  // No expires_at would mean a token of unknown life: use it for this call
  // and ask again next time, rather than guessing how long it lasts.
  if (typeof data.expires_at === 'number') {
    tokenCache.set(key, { accessToken: data.access_token, expiresAt: data.expires_at })
  }
  return data.access_token
}

// ── Create a payment link ────────────────────────────────────────────

export interface CreatePhonePeLinkArgs {
  credentials: PhonePeCredentials
  merchantOrderId: string
  /** Rupees, as the agent typed them. */
  amount: number
  description: string
  /** Digits, as stored on the contact — with or without the 91. */
  customerPhone: string
  customerName?: string
  /** Epoch milliseconds; at most 45 days ahead. */
  expireAt: number
}

export interface PhonePeLink {
  orderId: string
  state: string
  expireAt: number
  paylinkUrl: string
}

/** PhonePe accepts "+9197xxxxxx89" or "97xxxxxx89". */
export function phonePePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return digits
  return `+${digits}`
}

export function toPaise(rupees: number): number {
  return Math.round(rupees * 100)
}

export async function createPhonePePaymentLink(args: CreatePhonePeLinkArgs): Promise<PhonePeLink> {
  const { credentials, merchantOrderId, amount, description, customerPhone, customerName, expireAt } = args

  if (!MERCHANT_ORDER_ID.test(merchantOrderId)) {
    throw new PhonePeError('merchantOrderId must be 1–63 letters, digits, _ or -.', 400)
  }
  const paise = toPaise(amount)
  if (!Number.isFinite(paise) || paise < 100) {
    throw new PhonePeError('The amount must be at least ₹1.', 400)
  }
  if (!(expireAt > Date.now()) || expireAt - Date.now() > MAX_LINK_LIFETIME_MS) {
    throw new PhonePeError('A PhonePe link must expire within 45 days.', 400)
  }

  const token = await getPhonePeAccessToken(credentials)
  const response = await fetch(`${HOSTS[credentials.environment].paylinks}/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `O-Bearer ${token}` },
    body: JSON.stringify({
      merchantOrderId,
      description: description.slice(0, 150),
      amount: paise,
      paymentFlow: {
        type: 'PAYLINK',
        customerDetails: {
          ...(customerName ? { name: customerName.slice(0, 100) } : {}),
          phoneNumber: phonePePhone(customerPhone),
        },
        // The link goes out in the WhatsApp chat; PhonePe's own SMS would
        // be a second, unexplained copy from a sender the customer does
        // not know.
        notificationChannels: { SMS: false, EMAIL: false },
        expireAt,
      },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const data = (await response.json().catch(() => null)) as {
    orderId?: string
    state?: string
    expireAt?: number
    paylinkUrl?: string
    code?: string
    message?: string
  } | null

  if (!response.ok || !data?.orderId || !data.paylinkUrl) {
    throw new PhonePeError(
      `PhonePe could not create the link${data?.message ? `: ${data.message}` : ` (${response.status})`}`,
      response.status || 502,
      data?.code,
    )
  }
  // What goes to a customer must be a secure link and nothing else.
  if (!/^https:\/\//i.test(data.paylinkUrl)) {
    throw new PhonePeError('PhonePe returned a payment link that is not https.', 502)
  }
  return {
    orderId: data.orderId,
    state: data.state ?? 'ACTIVE',
    expireAt: data.expireAt ?? expireAt,
    paylinkUrl: data.paylinkUrl,
  }
}

// ── Status: the only thing that marks a payment paid ─────────────────

export interface PhonePeLinkStatus {
  /** ACTIVE | COMPLETED | FAILED | EXPIRED | CANCELLED, as PhonePe says it. */
  state: string
  /** Paise. */
  amount: number | null
  transactionId: string | null
  paymentMode: string | null
  raw: unknown
}

export async function getPhonePeLinkStatus(c: PhonePeCredentials, merchantOrderId: string): Promise<PhonePeLinkStatus> {
  if (!MERCHANT_ORDER_ID.test(merchantOrderId)) {
    throw new PhonePeError('merchantOrderId must be 1–63 letters, digits, _ or -.', 400)
  }
  const token = await getPhonePeAccessToken(c)
  const response = await fetch(
    `${HOSTS[c.environment].paylinks}/${encodeURIComponent(merchantOrderId)}/status?details=false`,
    {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `O-Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  )
  // Read loosely, as PhonePe's UAT checklist asks: fields may be added.
  const data = (await response.json().catch(() => null)) as {
    state?: string
    amount?: number
    paymentDetails?: { transactionId?: string; paymentMode?: string; state?: string }[]
    code?: string
    message?: string
  } | null

  if (!response.ok || typeof data?.state !== 'string') {
    throw new PhonePeError(
      `PhonePe status check failed${data?.message ? `: ${data.message}` : ` (${response.status})`}`,
      response.status || 502,
      data?.code,
    )
  }
  const completed = data.paymentDetails?.find((p) => p.state === 'COMPLETED') ?? data.paymentDetails?.[0]
  return {
    state: data.state,
    amount: typeof data.amount === 'number' ? data.amount : null,
    transactionId: completed?.transactionId ?? null,
    paymentMode: completed?.paymentMode ?? null,
    raw: data,
  }
}

/** This app's payment status for what PhonePe reports. A link still open
 *  for payment is 'pending'; anything that can no longer be paid and was
 *  not, 'failed'. */
export function paymentStatusFor(phonePeState: string): 'pending' | 'completed' | 'failed' {
  switch (phonePeState) {
    case 'COMPLETED':
      return 'completed'
    case 'FAILED':
    case 'EXPIRED':
    case 'CANCELLED':
      return 'failed'
    default:
      return 'pending'
  }
}

// ── Webhook ──────────────────────────────────────────────────────────

/** PhonePe's "SHA" webhook authentication: the Authorization header is
 *  SHA256(username:password). Compared in constant time. A pass means
 *  "worth a status check", never "paid". */
export function verifyPhonePeWebhookAuth(
  authorizationHeader: string | null,
  username: string,
  password: string,
): boolean {
  if (!authorizationHeader || !username || !password) return false
  const expected = crypto.createHash('sha256').update(`${username}:${password}`).digest('hex')
  const received = authorizationHeader.trim().toLowerCase()
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** The stored (decrypted) credentials JSON → typed credentials, or null
 *  when something required is missing. */
export function parsePhonePeCredentials(json: string): PhonePeCredentials | null {
  try {
    const v = JSON.parse(json) as Record<string, unknown>
    const str = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : '')
    const environment = str('environment') === 'production' ? 'production' : 'sandbox'
    const c: PhonePeCredentials = {
      clientId: str('client_id'),
      clientSecret: str('client_secret'),
      clientVersion: str('client_version'),
      environment,
      webhookUsername: str('webhook_username'),
      webhookPassword: str('webhook_password'),
    }
    return c.clientId && c.clientSecret && c.clientVersion ? c : null
  } catch {
    return null
  }
}
