/**
 * Messenger utility templates: the only way to message a customer on
 * Messenger after the 24-hour window (Meta retired the old update tags on
 * 27 Apr 2026). Created at Meta from the CRM and approved by Meta; sent with
 * messaging_type UTILITY.
 *
 * Utility means a transactional update the customer expects (an order, a
 * booking, a reminder) — not a promotion; Meta rejects marketing wording.
 * Every field is checked here before it reaches Meta: name and language
 * patterns, body length, placeholders numbered 1..n in order, parameter
 * values as plain text of a sane length.
 */

import { prisma } from '@/lib/db'
import { GRAPH_API_VERSION } from './versions'
import { explainMetaError } from './social-messaging'

export const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/
export const TEMPLATE_LANG = /^[a-z]{2}(_[A-Z]{2})?$/
export const BODY_MAX = 1024
export const PARAM_MAX = 500

export async function ensureMessengerTemplatesTable(): Promise<void> {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS messenger_templates (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id   UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name         TEXT        NOT NULL,
      language     TEXT        NOT NULL DEFAULT 'en_US',
      body         TEXT        NOT NULL,
      param_count  INTEGER     NOT NULL DEFAULT 0,
      status       TEXT        NOT NULL DEFAULT 'pending',
      meta_id      TEXT,
      reject_reason TEXT,
      created_by   UUID        REFERENCES users(id) ON DELETE RESTRICT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT messenger_templates_one_name UNIQUE (account_id, name, language)
    )`.catch((e: unknown) => console.warn('[messenger templates] table not created:', e instanceof Error ? e.message : e))
}

/** Pure: check a new template; returns the placeholder count or a reason. */
export function checkTemplate(input: { name: unknown; language: unknown; body: unknown }): { ok: true; name: string; language: string; body: string; params: number } | { ok: false; error: string } {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const language = typeof input.language === 'string' && input.language ? input.language.trim() : 'en_US'
  const body = typeof input.body === 'string' ? input.body.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : ''
  if (!TEMPLATE_NAME.test(name)) return { ok: false, error: 'The name may use small letters, digits and underscores only (for example order_update).' }
  if (!TEMPLATE_LANG.test(language)) return { ok: false, error: 'Choose a language code such as en_US or ml_IN.' }
  if (!body) return { ok: false, error: 'Write the message text.' }
  if ([...body].length > BODY_MAX) return { ok: false, error: `The message can be at most ${BODY_MAX} characters.` }
  const found = [...body.matchAll(/\{\{(\d{1,2})\}\}/g)].map((m) => Number(m[1]))
  const distinct = [...new Set(found)].sort((a, b) => a - b)
  if (distinct.some((n, i) => n !== i + 1)) return { ok: false, error: 'Number the blanks {{1}}, {{2}}, {{3}}… in order, with no gaps.' }
  if (/\{\{(?!\d{1,2}\}\})/.test(body)) return { ok: false, error: 'Blanks must look like {{1}}.' }
  if (/^\s*\{\{\d+\}\}|\{\{\d+\}\}\s*$/.test(body)) return { ok: false, error: 'The message cannot start or end with a blank.' }
  return { ok: true, name, language, body, params: distinct.length }
}

/** Pure: the values for a send — exactly n plain-text strings. */
export function checkParams(raw: unknown, n: number): { ok: true; values: string[] } | { ok: false; error: string } {
  const list = Array.isArray(raw) ? raw : []
  if (list.length !== n) return { ok: false, error: `Fill all ${n} blank${n === 1 ? '' : 's'}.` }
  const values: string[] = []
  for (const v of list) {
    if (typeof v !== 'string') return { ok: false, error: 'Each blank must be text.' }
    const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
    if (!t) return { ok: false, error: 'Fill every blank.' }
    if ([...t].length > PARAM_MAX) return { ok: false, error: `Each blank can be at most ${PARAM_MAX} characters.` }
    values.push(t)
  }
  return { ok: true, values }
}

/** The text the customer will read (for the Inbox record). */
export function renderTemplate(body: string, values: string[]): string {
  return body.replace(/\{\{(\d{1,2})\}\}/g, (_m, n: string) => values[Number(n) - 1] ?? '')
}

type MetaErr = { message?: string; code?: number; error_subcode?: number }

async function metaPost(url: string, token: string, body: unknown): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const res = await fetch(`${url}?access_token=${encodeURIComponent(token)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).catch(() => null)
  if (!res) return { ok: false, error: 'Could not reach Meta.' }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: MetaErr }
  if (!res.ok || data.error) {
    console.error('[messenger templates] Meta error:', res.status, data.error?.code, data.error?.error_subcode, data.error?.message)
    return { ok: false, error: explainMetaError(data.error, res.status) }
  }
  return { ok: true, data }
}

/** Create the template at Meta for the Page. */
export async function createAtMeta(pageId: string, token: string, t: { name: string; language: string; body: string; params: number }): Promise<{ ok: true; metaId: string | null; status: string } | { ok: false; error: string }> {
  const example = Array.from({ length: t.params }, (_, i) => `example ${i + 1}`)
  const r = await metaPost(`https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/message_templates`, token, {
    name: t.name,
    language: t.language,
    category: 'UTILITY',
    components: [{ type: 'BODY', text: t.body, ...(t.params ? { example: { body_text: [example] } } : {}) }],
  })
  if (!r.ok) return r
  const metaId = typeof r.data.id === 'string' && /^\d{1,40}$/.test(r.data.id) ? r.data.id : null
  const status = typeof r.data.status === 'string' ? r.data.status.toLowerCase().slice(0, 20) : 'pending'
  return { ok: true, metaId, status }
}

/** Send an approved template to one person (outside the 24 hours is allowed). */
export async function sendUtilityTemplate(input: {
  pageId: string; token: string; recipientId: string; name: string; language: string; values: string[]
}): Promise<{ ok: true; messageId: string | null } | { ok: false; error: string }> {
  const r = await metaPost(`https://graph.facebook.com/${GRAPH_API_VERSION}/${input.pageId}/messages`, input.token, {
    recipient: { id: input.recipientId },
    messaging_type: 'UTILITY',
    message: {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'utility',
          name: input.name,
          language: input.language,
          ...(input.values.length ? { components: [{ type: 'body', parameters: input.values.map((text) => ({ type: 'text', text })) }] } : {}),
        },
      },
    },
  })
  if (!r.ok) return r
  return { ok: true, messageId: typeof r.data.message_id === 'string' ? r.data.message_id.slice(0, 300) : null }
}
