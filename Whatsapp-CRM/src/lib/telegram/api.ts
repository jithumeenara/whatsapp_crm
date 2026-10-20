/**
 * Telegram Bot API over plain fetch — no SDK; a handful of methods.
 *
 * The bot token is in every URL (https://api.telegram.org/bot<token>/…),
 * so a URL from here is never logged, returned to a browser or stored:
 * errors carry Telegram's description only. Files are fetched for the
 * Inbox through /api/telegram/media/<message>, never by their Telegram URL.
 */

import dns from 'node:dns'

const API = 'https://api.telegram.org'

// A VPS often has an IPv6 address that cannot reach the internet: on the
// ACSTI server `curl -6 api.telegram.org` failed at once while IPv4 answered
// in 0.3 s, and every send that happened to try IPv6 first failed with
// "fetch failed". IPv4 first, IPv6 still tried after it.
dns.setDefaultResultOrder('ipv4first')

export class TelegramApiError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter: number | null = null) {
    super(message)
    this.name = 'TelegramApiError'
  }
}

/** Telegram's own words, made plain for the person who will read them. */
export function friendlyTelegramError(status: number, description: string): string {
  if (status === 401 || status === 404) return 'The bot token is not valid. Copy it again from @BotFather (/mybots → your bot → API Token).'
  if (status === 403) return 'This person has blocked the bot, or never pressed Start — Telegram does not let a bot message them first.'
  if (status === 429) return 'Telegram is busy (too many messages at once). It will be retried shortly.'
  if (/chat not found/i.test(description)) return 'Telegram does not know this chat — the person needs to press Start on the bot first.'
  return description ? `Telegram: ${description}` : `Telegram returned ${status}.`
}

type Body = Record<string, unknown> | FormData

/** Failures where the connection never opened, so nothing reached Telegram
 *  and trying again cannot send a message twice. A reset or a timeout
 *  after connecting is not here: that message may already be delivered. */
const NEVER_CONNECTED = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT'])

/** Node's fetch says only "fetch failed"; the reason is in err.cause. */
function networkCode(err: unknown): string {
  const cause = (err as { cause?: { code?: unknown; errors?: Array<{ code?: unknown }> } } | null)?.cause
  if (typeof cause?.code === 'string') return cause.code
  const inner = cause?.errors?.find((e) => typeof e?.code === 'string')?.code
  if (typeof inner === 'string') return inner
  return err instanceof Error && err.name === 'TimeoutError' ? 'TIMEOUT' : ''
}

export async function tgCall<T>(token: string, method: string, body: Body = {}): Promise<T> {
  let res: Response | null = null
  for (let attempt = 1; !res; attempt++) {
    try {
      res = await fetch(`${API}/bot${token}/${method}`, {
        method: 'POST',
        ...(body instanceof FormData ? { body } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20_000),
      })
    } catch (err) {
      const code = networkCode(err)
      if (attempt === 1 && NEVER_CONNECTED.has(code)) continue
      console.error(`[telegram] ${method} could not reach Telegram (${code || 'no code'}):`, err instanceof Error ? err.message : err)
      throw new TelegramApiError(`Could not reach Telegram${code ? ` (${code})` : ''} — the server could not connect to api.telegram.org. Try again in a minute.`, 0)
    }
  }
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } }
  if (res.ok && data.ok) return data.result as T
  const status = data.error_code ?? res.status
  throw new TelegramApiError(friendlyTelegramError(status, data.description ?? ''), status, data.parameters?.retry_after ?? null)
}

export interface BotInfo {
  id: number
  username: string
  first_name: string
  can_connect_to_business?: boolean
}

export function getMe(token: string): Promise<BotInfo> {
  return tgCall<BotInfo>(token, 'getMe')
}

/** Only the updates the CRM acts on — everything else Telegram keeps to itself. */
export const ALLOWED_UPDATES = ['message', 'callback_query', 'business_connection', 'business_message']

export function setWebhook(token: string, url: string, secret: string): Promise<true> {
  return tgCall<true>(token, 'setWebhook', { url, secret_token: secret, allowed_updates: ALLOWED_UPDATES, drop_pending_updates: false, max_connections: 20 })
}

export function deleteWebhook(token: string): Promise<true> {
  return tgCall<true>(token, 'deleteWebhook', { drop_pending_updates: false })
}

export interface SentMessage {
  message_id: number
}

export function answerCallbackQuery(token: string, id: string): Promise<true> {
  return tgCall<true>(token, 'answerCallbackQuery', { callback_query_id: id })
}

/** A file's download path (Telegram serves files up to 20 MB to bots). */
export async function fileDownloadUrl(token: string, fileId: string): Promise<{ url: string; size: number | null }> {
  const f = await tgCall<{ file_path?: string; file_size?: number }>(token, 'getFile', { file_id: fileId })
  if (!f.file_path) throw new TelegramApiError('Telegram did not return the file (it may be larger than 20 MB).', 400)
  return { url: `${API}/file/bot${token}/${f.file_path}`, size: f.file_size ?? null }
}
