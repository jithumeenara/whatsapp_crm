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
 *
 * Side effects that are not a message are stopped too (blockedOutbound),
 * because they end in one just the same — a tenant webhook usually feeds
 * Zapier or Make, which messages the customer:
 *   - every request, GET included, that a caller marks as an outbound
 *     action (`safeFetch(url, init, { purpose: 'outbound-action' })`):
 *     tenant webhooks, the automation "send webhook" step, a flow or
 *     chatbot "HTTP request" step, the call-forward hand-off. A catch hook
 *     or an SMS gateway's send URL fires on a GET too. Imports and
 *     integrations do not pass the flag and keep working;
 *   - every write (not GET / HEAD, or a GET with ?method=post|delete) to a
 *     Meta Graph host — profile, ice breakers, subscriptions, comments,
 *     publishing — except the OAuth / token endpoints in META_CONNECT,
 *     which connecting an account in development needs;
 *   - every write to another known provider (PROVIDERS below): Telegram
 *     (any method but getMe / getFile / getWebhookInfo / getChat, whatever
 *     the verb), TextBee, Microsoft Graph, *.googleapis.com (but the OAuth
 *     token endpoints, Calendar freeBusy and the AI model hosts), Razorpay,
 *     PhonePe (but its token endpoint), Twilio, SendGrid, MSG91.
 * DEV_ALLOWED_HOSTS (comma separated host names, exact match) lets those
 * kinds through to the hosts listed — your own webhook.site endpoint.
 * It never unlocks a customer message; DEV_ALLOWED_RECIPIENTS does that.
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

// ── Side effects that are not a message ─────────────────────────────

/** What a safeFetch caller says its request is for. */
export type OutboundPurpose = 'outbound-action'

/** Hosts a Meta write goes to. Exact names, not suffixes. */
const META_WRITE_HOSTS = new Set([
  'graph.facebook.com',
  'graph.instagram.com',
  'graph-video.facebook.com',
  'rupload.facebook.com',
  'api.instagram.com',
])

/**
 * Meta endpoints that connect an account rather than change one: code →
 * token exchange, long-lived / refreshed tokens, token inspection. Path
 * after the optional version segment.
 */
const META_CONNECT = /^\/(?:v[\d.]+\/)?(?:oauth\/access_token|oauth\/client_code|debug_token|access_token|refresh_access_token)\/?$/

const READS = new Set(['GET', 'HEAD'])

/** Host names from DEV_ALLOWED_HOSTS, lower case, no trailing dot. */
function allowedHosts(env: Record<string, string | undefined>): Set<string> {
  return new Set(
    (env.DEV_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((x) => x.trim().toLowerCase().replace(/\.$/, ''))
      .filter(Boolean),
  )
}

/**
 * Every outbound side effect a protected server must not perform: the
 * message rules of {@link blockedSend}, then outbound actions and Meta
 * writes. Null means "let it go". Server environment only — nothing here
 * is read from a request. In production it returns null before looking
 * at anything else.
 */
export function blockedOutbound(
  url: string,
  method: string,
  body: unknown,
  env: Record<string, string | undefined>,
  opts: { purpose?: OutboundPurpose } = {},
): { name: string; host: string; reply: () => Response } | null {
  if (!isSendProtected(env) || env.DEV_ALLOW_SENDING === '1') return null
  const verb = (method || 'GET').toUpperCase()
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '')

  // A message: its own rules decide, recipient allow-list included.
  if (verb === 'POST' && RULES.some((r) => r.match.test(url))) {
    const hit = blockedSend(url, verb, body, env)
    return hit ? { ...hit, host } : null
  }

  if (allowedHosts(env).has(host)) return null

  // A tenant-configured outbound action is stopped whatever its verb: a
  // Zapier / Make catch hook or an SMS gateway's send URL fires on a GET.
  if (opts.purpose === 'outbound-action') {
    return {
      name: 'outbound action',
      host,
      reply: () => Response.json({ ok: true, success: true, dev_blocked: true }),
    }
  }

  if (META_WRITE_HOSTS.has(host) && parsed.protocol === 'https:') {
    const override = (parsed.searchParams.get('method') ?? '').toUpperCase()
    const writes = !READS.has(verb) || (override !== '' && !READS.has(override))
    if (writes && !META_CONNECT.test(parsed.pathname)) {
      return {
        name: 'Meta write',
        host,
        reply: () => Response.json({ success: true, id: `DEV_BLOCKED_${Date.now()}` }),
      }
    }
  }

  if (parsed.protocol === 'https:') {
    const provider = PROVIDERS.find((p) => p.host(host))
    if (provider && !provider.open(parsed.pathname, verb, host)) {
      return { name: provider.name, host, reply: () => provider.reply(parsed.pathname) }
    }
  }
  return null
}

// ── Other providers' writes ─────────────────────────────────────────
//
// Preview / staging servers run the background jobs against a copy of
// production data, so a provider write from one changes a real customer's
// account: Telegram setWebhook re-points the production bot to staging,
// TextBee / Microsoft Graph subscriptions re-point inbound SMS and mail,
// Google Sheets / Calendar / Drive writes edit customers' files, Razorpay /
// PhonePe create real payment links. On a known provider host everything
// that is not a read is stopped unless listed in its `open` rule — a
// structural default, so a new write endpoint is covered without a rule.
//
// AI model providers (Gemini, Cloud TTS, Vertex, OpenAI, Anthropic, any
// OpenAI-compatible base URL) are deliberately left open: a model call
// changes nothing a customer can see, and the AI features must work in
// development. Their answers still only reach a customer through a send,
// which the message rules stop.

const isRead = (verb: string) => READS.has(verb)
const DEV_ID = () => `DEV_BLOCKED_${Date.now()}`

/** Telegram methods that change nothing (any verb: Telegram accepts GET for every method). */
const TELEGRAM_READS = new Set(['getme', 'getfile', 'getwebhookinfo', 'getchat'])

/** Google endpoints that are not under the "non-GET is a write" default. */
const GOOGLE_AI_HOST = /^(?:generativelanguage|texttospeech|(?:[a-z0-9-]+-)?aiplatform)\.googleapis\.com$/
const GOOGLE_OPEN: Record<string, RegExp> = {
  'oauth2.googleapis.com': /^\/(?:token|tokeninfo)\/?$/,
  'www.googleapis.com': /^\/(?:oauth2\/v\d\/(?:token|tokeninfo)|calendar\/v3\/freeBusy)\/?$/,
  'openidconnect.googleapis.com': /^\/v\d\/userinfo\/?$/,
}

const PROVIDERS: Array<{
  name: string
  host: (h: string) => boolean
  open: (path: string, verb: string, host: string) => boolean
  reply: (path: string) => Response
}> = [
  {
    name: 'Telegram write',
    host: (h) => h === 'api.telegram.org',
    open: (path, verb) => {
      const m = /^\/bot[^/]+\/([^/]+)\/?$/.exec(path)
      if (m) return TELEGRAM_READS.has(m[1].toLowerCase())
      return isRead(verb) && /^\/file\/bot[^/]+\/./.test(path)
    },
    reply: (path) =>
      Response.json({
        ok: true,
        result: /\/(send|copy|forward)[^/]*\/?$/i.test(path) ? { message_id: Math.floor(Date.now() / 1000) } : true,
      }),
  },
  {
    name: 'TextBee write',
    host: (h) => h === 'api.textbee.dev',
    open: (_p, verb) => isRead(verb),
    reply: () => Response.json({ data: { _id: DEV_ID(), success: true } }),
  },
  {
    name: 'Microsoft Graph write',
    host: (h) => h === 'graph.microsoft.com',
    open: (_p, verb) => isRead(verb),
    reply: () => Response.json({ id: DEV_ID(), expirationDateTime: new Date(Date.now() + 3 * 86_400_000).toISOString() }),
  },
  {
    name: 'Google write',
    host: (h) => h.endsWith('.googleapis.com') && !GOOGLE_AI_HOST.test(h),
    open: (path, verb, host) => isRead(verb) || Boolean(GOOGLE_OPEN[host]?.test(path)),
    reply: () => Response.json({ id: DEV_ID(), spreadsheetId: DEV_ID(), replies: [] }),
  },
  {
    name: 'Razorpay write',
    host: (h) => h === 'api.razorpay.com',
    open: (_p, verb) => isRead(verb),
    reply: () => Response.json({ id: DEV_ID(), entity: 'dev_blocked', status: 'created', short_url: 'https://rzp.io/dev-blocked' }),
  },
  {
    name: 'PhonePe write',
    host: (h) => h === 'api.phonepe.com' || h === 'api-preprod.phonepe.com',
    open: (path, verb) => isRead(verb) || /\/oauth\/token\/?$/.test(path),
    reply: () => Response.json({ orderId: DEV_ID(), state: 'ACTIVE', expireAt: Date.now() + 86_400_000, paylinkUrl: 'https://phon.pe/dev-blocked' }),
  },
  {
    name: 'SMS / email provider write',
    host: (h) => h === 'api.twilio.com' || h === 'api.sendgrid.com' || h === 'api.msg91.com',
    open: (_p, verb) => isRead(verb),
    reply: () => Response.json({ sid: DEV_ID(), id: DEV_ID(), type: 'success', status: 'queued' }),
  },
]


/** The one log line for a stopped side effect: host only, never the path, body or a token. */
export function logBlocked(hit: { name: string; host: string }, env: Record<string, string | undefined> = process.env): void {
  console.warn(`[DEV] blocked ${hit.name} to ${hit.host} (${(env.APP_ENV || env.NODE_ENV || 'protected').trim().toLowerCase()} environment)`)
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
    const other = blockedOutbound(url, method, init?.body, process.env)
    if (other) {
      logBlocked(other)
      return other.reply()
    }
    return real(input, init)
  }) as FetchFn
  console.warn('[DEV] Outgoing messages are blocked on this non-production server. DEV_ALLOW_SENDING=1 or DEV_ALLOWED_RECIPIENTS=<your number> to send.')
}
