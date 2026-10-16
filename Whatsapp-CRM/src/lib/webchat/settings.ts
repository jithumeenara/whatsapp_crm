/**
 * Settings → Website chat: what an admin may change about a widget, and
 * how each value is checked. Shared by the create and update routes so
 * both refuse the same things.
 */

import { normalizeDomainList } from './domains'
import { isHexColor } from './widget-config'
import { isSafeHttpsUrl } from './public-message'

export interface WidgetPatch {
  name?: string
  title?: string
  welcome_message?: string
  primary_color?: string
  position?: 'left' | 'right'
  logo_url?: string | null
  allowed_domains?: string[]
  allow_handoff?: boolean
  enabled?: boolean
  daily_ai_limit?: number
}

export type PatchResult = { ok: true; patch: WidgetPatch } | { ok: false; error: string }

function text(value: unknown, field: string, max: number, required: boolean): string | null | Error {
  if (value === undefined) return null
  if (typeof value !== 'string') return new Error(`${field} must be text.`)
  const trimmed = value.trim()
  if (required && !trimmed) return new Error(`${field} cannot be empty.`)
  if (trimmed.length > max) return new Error(`${field} is too long (${max} characters at most).`)
  return trimmed
}

export function parseWidgetPatch(body: Record<string, unknown>): PatchResult {
  const patch: WidgetPatch = {}

  const fields: [keyof WidgetPatch, string, number][] = [
    ['name', 'Name', 80],
    ['title', 'Window title', 60],
    ['welcome_message', 'Welcome message', 500],
  ]
  for (const [key, label, max] of fields) {
    const value = text(body[key], label, max, true)
    if (value instanceof Error) return { ok: false, error: value.message }
    if (value !== null) (patch as Record<string, unknown>)[key] = value
  }

  if (body.primary_color !== undefined) {
    if (!isHexColor(body.primary_color)) return { ok: false, error: 'Colour must look like #4f46e5.' }
    patch.primary_color = body.primary_color.toLowerCase()
  }
  if (body.position !== undefined) {
    if (body.position !== 'left' && body.position !== 'right') return { ok: false, error: 'Position is left or right.' }
    patch.position = body.position
  }
  if (body.logo_url !== undefined) {
    if (body.logo_url === null || body.logo_url === '') patch.logo_url = null
    else if (!isSafeHttpsUrl(body.logo_url)) return { ok: false, error: 'The logo must be an https:// image link.' }
    else patch.logo_url = body.logo_url
  }
  if (body.allowed_domains !== undefined) {
    const { domains, invalid } = normalizeDomainList(body.allowed_domains)
    if (invalid.length) return { ok: false, error: `Not a website address: ${invalid.slice(0, 3).join(', ')}` }
    patch.allowed_domains = domains
  }
  for (const key of ['allow_handoff', 'enabled'] as const) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== 'boolean') return { ok: false, error: `${key} must be true or false.` }
      patch[key] = body[key] as boolean
    }
  }
  if (body.daily_ai_limit !== undefined) {
    const n = Number(body.daily_ai_limit)
    if (!Number.isInteger(n) || n < 0 || n > 100_000) return { ok: false, error: 'Daily assistant limit is a whole number from 0 to 100000.' }
    patch.daily_ai_limit = n
  }
  return { ok: true, patch }
}

/** The install snippet, for an origin and a key. */
// Always https for a real host: the snippet goes on public websites, which
// are https, and a browser blocks an http script there as mixed content.
// The admin page can be reached over http (or behind a proxy that says so),
// and that used to leak into the code people pasted.
export function installSnippet(origin: string, publicKey: string): string {
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
  const src = local ? origin : origin.replace(/^http:\/\//i, 'https://')
  return `<script src="${src}/webchat/widget.js" data-widget="${publicKey}" defer></script>`
}
