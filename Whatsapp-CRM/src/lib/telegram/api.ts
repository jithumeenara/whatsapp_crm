/**
 * Telegram Bot API over plain fetch — no SDK; a handful of methods.
 *
 * The bot token is in every URL (https://api.telegram.org/bot<token>/…),
 * so a URL from here is never logged, returned to a browser or stored:
 * errors carry Telegram's description only. Files are fetched for the
 * Inbox through /api/telegram/media/<message>, never by their Telegram URL.
 */

const API = 'https://api.telegram.org'

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

export async function tgCall<T>(token: string, method: string, body: Body = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      ...(body instanceof FormData ? { body } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    throw new TelegramApiError(`Could not reach Telegram: ${err instanceof Error ? err.message : String(err)}`, 0)
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
