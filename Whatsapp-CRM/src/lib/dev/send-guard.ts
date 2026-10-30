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
 *   Instagram (Instagram Login)      graph.instagram.com/…/me/messages
 *   Gmail                            gmail.googleapis.com/…/messages/send
 *   Outlook / Microsoft 365          graph.microsoft.com/…/sendMail, /reply, /forward, /send
 *   SendGrid                         api.sendgrid.com/v3/mail/send
 *   MSG91 SMS                        api.msg91.com/…/sendsms
 *   Telegram                         api.telegram.org/bot…/send*, copyMessage, forwardMessage
 *   WhatsApp marketing / calls       graph.facebook.com/…/marketing_messages, /calls
 *   Meta Conversions, audiences, ads graph.facebook.com/…/events, /users, act_…/campaigns|adsets|ads|…
 *   Twilio SMS / RCS / calls         api.twilio.com/…/Messages.json, /Calls.json
 *   Google RCS                       rcsbusinessmessaging.googleapis.com/…/agentMessages
 *   Firebase Cloud Messaging         fcm.googleapis.com/…/messages:send, /fcm/send
 *
 * SDKs that do not use fetch (the Twilio SDK uses axios; web-push uses
 * node's https) ask `sdkSendBlocked` before sending instead.
 *
 * Switched on by APP_ENV=development (or dev / local / test / preview /
 * staging), by NODE_ENV=test and by a Vitest run — read from the server's
 * own environment only, never from a request. Production servers are
 * never touched by this file: a server whose environment says nothing
 * keeps sending as it always has, because guessing wrong there would
 * silence every customer.
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

/**
 * Every environment that must not reach a real customer: a laptop, a test
 * run, a preview or staging server (which often points at a copy of
 * production data). Server environment only.
 */
export function isSendProtected(env: Record<string, string | undefined>): boolean {
  const appEnv = (env.APP_ENV ?? '').trim().toLowerCase()
  if (['development', 'dev', 'local', 'test', 'preview', 'staging'].includes(appEnv)) return true
  if ((env.NODE_ENV ?? '').trim().toLowerCase() === 'test') return true
  return Boolean(env.VITEST)
}

const metaMessageReply = () =>
  Response.json({
    messaging_product: 'whatsapp',
    contacts: [{ input: 'dev', wa_id: 'dev' }],
    messages: [{ id: `wamid.DEV_BLOCKED_${Date.now()}` }],
    message_id: `m_DEV_BLOCKED_${Date.now()}`,
    recipient_id: 'dev',
  })

const RULES: Array<{ name: string; match: RegExp; reply: () => Response }> = [
  {
    name: 'Meta message',
    // Instagram-Login tokens send DMs through graph.instagram.com, not
    // graph.facebook.com (whatsapp/send, instagram webhook, flows).
    match: /^https:\/\/graph\.(facebook|instagram)\.com\/[^?]*\/messages(\?|$)/,
    reply: metaMessageReply,
  },
  {
    name: 'Meta marketing message',
    match: /^https:\/\/graph\.facebook\.com\/[^?]*\/marketing_messages(\?|$)/,
    reply: metaMessageReply,
  },
  {
    name: 'WhatsApp call',
    match: /^https:\/\/graph\.facebook\.com\/[^?]*\/calls(\?|$)/,
    reply: () => Response.json({ messaging_product: 'whatsapp', success: true, calls: [{ id: `wacid.DEV_BLOCKED_${Date.now()}` }] }),
  },
  {
    name: 'Meta Conversions API event',
    match: /^https:\/\/graph\.facebook\.com\/v[\d.]+\/\d+\/events(\?|$)/,
    reply: () => Response.json({ events_received: 1, messages: [], fbtrace_id: 'DEV_BLOCKED' }),
  },
  {
    name: 'Meta custom audience upload',
    match: /^https:\/\/graph\.facebook\.com\/v[\d.]+\/\d+\/users(\?|$)/,
    reply: () => Response.json({ audience_id: 'DEV_BLOCKED', session_id: 'DEV_BLOCKED', num_received: 0, num_invalid_entries: 0 }),
  },
  {
    name: 'Meta ads change',
    match: /^https:\/\/graph\.facebook\.com\/v[\d.]+\/act_\d+\/(campaigns|adsets|ads|adcreatives|customaudiences)(\?|$)/,
    reply: () => Response.json({ id: `DEV_BLOCKED_${Date.now()}` }),
  },
  {
    name: 'Twilio send',
    match: /^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/[^/]+\/(Messages|Calls)\.json/,
    reply: () => Response.json({ sid: `SMDEV_BLOCKED${Date.now()}`, status: 'queued' }, { status: 201 }),
  },
  {
    name: 'Google RCS send',
    match: /^https:\/\/rcsbusinessmessaging\.googleapis\.com\/v\d+\/phones\/[^/]+\/agentMessages/,
    reply: () => Response.json({ name: `phones/dev/agentMessages/DEV_BLOCKED_${Date.now()}` }),
  },
  {
    name: 'Push notification (FCM)',
    match: /^https:\/\/fcm\.googleapis\.com\/(v1\/projects\/[^/]+\/messages:send|fcm\/send)/,
    reply: () => Response.json({ name: `projects/dev/messages/DEV_BLOCKED_${Date.now()}` }),
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
  if (method.toUpperCase() !== 'POST') return null
  const rule = RULES.find((r) => r.match.test(url))
  if (!rule) return null
  if (!sendingStopped(body, env)) return null
  return { name: rule.name, reply: rule.reply }
}

/** True when a send to these recipients must not leave this server. */
function sendingStopped(body: unknown, env: Record<string, string | undefined>, recipients?: string[]): boolean {
  if (!isSendProtected(env) || env.DEV_ALLOW_SENDING === '1') return false
  const allowed = (env.DEV_ALLOWED_RECIPIENTS ?? '')
    .split(',')
    .map((r) => (r.includes('@') ? r.trim().toLowerCase() : r.replace(/\D/g, '')))
    .filter(Boolean)
  const to = recipients ?? recipientsOf(body)
  if (allowed.length > 0 && to.length > 0 && to.every((r) => allowed.some((a) => r === a || (a.length >= 8 && r.endsWith(a.slice(-10)))))) {
    return false
  }
  return true
}

/**
 * For a send that does not go through fetch (Twilio SDK → axios, web-push
 * → https): true means "do not send; pretend it went". Logs the stop.
 */
export function sdkSendBlocked(
  name: string,
  recipients: string[],
  env: Record<string, string | undefined> = process.env,
): boolean {
  const norm = recipients.map((r) => (r.includes('@') ? r.trim().toLowerCase() : r.replace(/\D/g, ''))).filter(Boolean)
  if (!sendingStopped(undefined, env, norm)) return false
  console.warn(`[DEV] ${name} NOT sent (${(env.APP_ENV || env.NODE_ENV || 'test').toLowerCase()} environment)`)
  return true
}

let installed = false

/** Called once, first thing, by server.ts. A no-op in production. */
export function installDevSendGuard(): void {
  if (installed || !isSendProtected(process.env)) return
  installed = true
  const real: FetchFn = globalThis.fetch.bind(globalThis)
  globalThis.fetch = (async (input: Parameters<FetchFn>[0], init?: Parameters<FetchFn>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
    const hit = blockedSend(url, method, init?.body, process.env)
    if (hit) {
      console.warn(`[DEV] ${hit.name} NOT sent (${process.env.APP_ENV || process.env.NODE_ENV || 'protected'} environment): ${url.replace(/access_token=[^&]+/, 'access_token=…')}`)
      return hit.reply()
    }
    return real(input, init)
  }) as FetchFn
  console.warn('[DEV] Outgoing messages are blocked on this non-production server. DEV_ALLOW_SENDING=1 or DEV_ALLOWED_RECIPIENTS=<your number> to send.')
}
