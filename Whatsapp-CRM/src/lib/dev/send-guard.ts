/**
 * Nothing leaves a development server.
 *
 * A laptop running this app talks to whatever its database holds — and a
 * developer's database can hold a connected WhatsApp number with a live
 * token, real contacts, a Gmail or Outlook mailbox. One test broadcast,
 * one scheduled message, one AI reply would reach a real customer.
 *
 * So in development every request that would deliver a message is
 * stopped at the one place they all pass through — fetch — and answered
 * with a believable "sent", so the app carries on as if it had. Every
 * channel is covered, including ones added later, without each send
 * function having to remember:
 *
 *   WhatsApp, Messenger, Instagram   graph.facebook.com/…/messages
 *   Gmail                            gmail.googleapis.com/…/messages/send
 *   Outlook / Microsoft 365          graph.microsoft.com/…/sendMail, /reply, /forward, /send
 *   SendGrid                         api.sendgrid.com/v3/mail/send
 *   MSG91 SMS                        api.msg91.com/…/sendsms
 *   Telegram                         api.telegram.org/bot…/send*, copyMessage, forwardMessage
 *
 * Switched on by APP_ENV=development in the laptop's .env.local — and by
 * nothing else. Production servers are never touched by this file: a
 * server whose environment says nothing keeps sending as it always has,
 * because guessing wrong there would silence every customer.
 *
 * Allowed through, even then:
 *   - DEV_ALLOW_SENDING=1, deliberately;
 *   - a recipient listed in DEV_ALLOWED_RECIPIENTS (comma separated
 *     phone digits or emails) — your own number, to test for real.
 */

type FetchFn = typeof fetch

/** Only an explicit APP_ENV=development (or dev / local). */
export function isDevelopment(env: Record<string, string | undefined>): boolean {
  return ['development', 'dev', 'local'].includes((env.APP_ENV ?? '').trim().toLowerCase())
}

const RULES: Array<{ name: string; match: RegExp; reply: () => Response }> = [
  {
    name: 'Meta message',
    match: /^https:\/\/graph\.facebook\.com\/[^?]*\/messages(\?|$)/,
    reply: () =>
      Response.json({
        messaging_product: 'whatsapp',
        contacts: [{ input: 'dev', wa_id: 'dev' }],
        messages: [{ id: `wamid.DEV_BLOCKED_${Date.now()}` }],
        message_id: `m_DEV_BLOCKED_${Date.now()}`,
        recipient_id: 'dev',
      }),
  },
  {
    name: 'Gmail send',
    match: /^https:\/\/gmail\.googleapis\.com\/gmail\/v1\/users\/[^/]+\/messages\/send/,
    reply: () => Response.json({ id: `dev-blocked-${Date.now()}`, threadId: `dev-thread-${Date.now()}` }),
  },
  {
    name: 'Microsoft mail send',
    match: /^https:\/\/graph\.microsoft\.com\/[^?]*\/(sendMail|reply|replyAll|forward|send)(\?|$)/,
    reply: () => new Response(null, { status: 202 }),
  },
  {
    name: 'SendGrid send',
    match: /^https:\/\/api\.sendgrid\.com\/v3\/mail\/send/,
    reply: () => new Response(null, { status: 202 }),
  },
  {
    name: 'SMS send',
    match: /^https:\/\/api\.msg91\.com\/api\/v\d+\/sendsms/,
    reply: () => Response.json({ type: 'success', message: 'dev-blocked' }),
  },
  {
    name: 'SMS send (TextBee)',
    match: /^https:\/\/api\.textbee\.dev\/api\/v\d+\/gateway\/(devices\/[^/]+\/)?send-sms/,
    reply: () => Response.json({ data: { success: true, smsBatchId: `dev-blocked-${Date.now()}` } }),
  },
  {
    name: 'Telegram send',
    match: /^https:\/\/api\.telegram\.org\/bot[^/]+\/(send[A-Za-z]+|copyMessages?|forwardMessages?)(\?|$)/,
    reply: () => Response.json({ ok: true, result: { message_id: Math.floor(Date.now() / 1000) } }),
  },
]

/** Phone digits and emails a request is addressed to, as far as its body says. */
export function recipientsOf(body: unknown): string[] {
  if (typeof body !== 'string' || body.length > 200_000) return []
  const out = new Set<string>()
  for (const m of body.matchAll(/"to"\s*:\s*"([^"]+)"/g)) out.add(m[1])
  for (const m of body.matchAll(/"recipient"\s*:\s*\{\s*"id"\s*:\s*"([^"]+)"/g)) out.add(m[1])
  for (const m of body.matchAll(/"(?:address|email)"\s*:\s*"([^"@\s]+@[^"\s]+)"/g)) out.add(m[1])
  for (const m of body.matchAll(/"mobiles?"\s*:\s*"([^"]+)"/g)) out.add(m[1])
  return [...out].map((r) => (r.includes('@') ? r.trim().toLowerCase() : r.replace(/\D/g, ''))).filter(Boolean)
}

export function blockedSend(
  url: string,
  method: string,
  body: unknown,
  env: Record<string, string | undefined>,
): { name: string; reply: () => Response } | null {
  if (!isDevelopment(env) || env.DEV_ALLOW_SENDING === '1') return null
  if (method.toUpperCase() !== 'POST') return null
  const rule = RULES.find((r) => r.match.test(url))
  if (!rule) return null
  const allowed = (env.DEV_ALLOWED_RECIPIENTS ?? '')
    .split(',')
    .map((r) => (r.includes('@') ? r.trim().toLowerCase() : r.replace(/\D/g, '')))
    .filter(Boolean)
  const to = recipientsOf(body)
  if (allowed.length > 0 && to.length > 0 && to.every((r) => allowed.some((a) => r === a || (a.length >= 8 && r.endsWith(a.slice(-10)))))) {
    return null
  }
  return { name: rule.name, reply: rule.reply }
}

let installed = false

/** Called once, first thing, by server.ts. A no-op in production. */
export function installDevSendGuard(): void {
  if (installed || !isDevelopment(process.env)) return
  installed = true
  const real: FetchFn = globalThis.fetch.bind(globalThis)
  globalThis.fetch = (async (input: Parameters<FetchFn>[0], init?: Parameters<FetchFn>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
    const hit = blockedSend(url, method, init?.body, process.env)
    if (hit) {
      console.warn(`[DEV] ${hit.name} NOT sent (development): ${url.replace(/access_token=[^&]+/, 'access_token=…')}`)
      return hit.reply()
    }
    return real(input, init)
  }) as FetchFn
  console.warn('[DEV] Outgoing messages are blocked on this development server. DEV_ALLOW_SENDING=1 or DEV_ALLOWED_RECIPIENTS=<your number> to send.')
}
