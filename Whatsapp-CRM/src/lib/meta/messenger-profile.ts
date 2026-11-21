/**
 * The chat "front door" Meta shows before a customer types: ice breakers
 * (starter questions), a persistent menu, and on Messenger also a greeting
 * and a Get Started button. Shared by the Instagram and Messenger settings
 * routes.
 *
 * Everything from the browser is rebuilt field by field here — lengths,
 * counts, https-only links — so the request to Meta and the row we store
 * never carry anything the owner did not type into those boxes.
 */

import type { SocialChannel } from './social-messaging'

export interface IceBreaker { question: string; payload: string }
export type MenuItem =
  | { title: string; payload: string }
  | { title: string; type: 'web_url'; url: string }

export interface ChatProfile {
  ice_breakers: IceBreaker[]
  persistent_menu: MenuItem[]
  /** Messenger only: the text above the Get Started button. */
  greeting: string
  /** Messenger only: show a Get Started button (sends the GET_STARTED reply). */
  get_started: boolean
}

export const PROFILE_LIMITS = {
  iceBreakers: 4,
  menuItems: 3,
  question: 80,
  title: 30,
  payload: 200,
  url: 500,
  greeting: 160,
} as const

export const GET_STARTED_PAYLOAD = 'GET_STARTED'

type Clean = { ok: true; value: ChatProfile } | { ok: false; error: string }

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
// Control characters never belong in a button.
const CONTROL = /[\u0000-\u001f\u007f]/

function safeHttpsUrl(raw: string): string | null {
  if (!raw || raw.length > PROFILE_LIMITS.url) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return null
    return u.toString()
  } catch {
    return null
  }
}

/** Rebuild the owner's input, or say in plain words what is wrong. */
export function cleanProfile(body: unknown, channel: SocialChannel): Clean {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const rawIce = b.ice_breakers ?? []
  const rawMenu = b.persistent_menu ?? []
  if (!Array.isArray(rawIce) || !Array.isArray(rawMenu)) return { ok: false, error: 'Ice breakers and menu must be lists.' }
  if (rawIce.length > PROFILE_LIMITS.iceBreakers) return { ok: false, error: `At most ${PROFILE_LIMITS.iceBreakers} ice breakers.` }
  if (rawMenu.length > PROFILE_LIMITS.menuItems) return { ok: false, error: `At most ${PROFILE_LIMITS.menuItems} menu items.` }

  const ice: IceBreaker[] = []
  for (const item of rawIce) {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const question = str(r.question), payload = str(r.payload)
    if (!question || !payload) return { ok: false, error: 'Every ice breaker needs a question and a reply code.' }
    if (question.length > PROFILE_LIMITS.question) return { ok: false, error: `An ice breaker question can be at most ${PROFILE_LIMITS.question} characters.` }
    if (payload.length > PROFILE_LIMITS.payload) return { ok: false, error: `A reply code can be at most ${PROFILE_LIMITS.payload} characters.` }
    if (CONTROL.test(question) || CONTROL.test(payload)) return { ok: false, error: 'Remove the hidden characters from the ice breakers.' }
    ice.push({ question, payload })
  }

  const menu: MenuItem[] = []
  for (const item of rawMenu) {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const title = str(r.title)
    if (!title) return { ok: false, error: 'Every menu item needs a title.' }
    if (title.length > PROFILE_LIMITS.title) return { ok: false, error: `A menu title can be at most ${PROFILE_LIMITS.title} characters.` }
    if (CONTROL.test(title)) return { ok: false, error: 'Remove the hidden characters from the menu.' }
    if (r.type === 'web_url') {
      const url = safeHttpsUrl(str(r.url))
      if (!url) return { ok: false, error: 'Every menu link must be a full https:// address.' }
      menu.push({ title, type: 'web_url', url })
    } else {
      const payload = str(r.payload)
      if (!payload) return { ok: false, error: 'Every menu item needs a reply code or a link.' }
      if (payload.length > PROFILE_LIMITS.payload || CONTROL.test(payload)) return { ok: false, error: `A reply code can be at most ${PROFILE_LIMITS.payload} plain characters.` }
      menu.push({ title, payload })
    }
  }

  let greeting = ''
  let getStarted = false
  if (channel === 'facebook') {
    greeting = str(b.greeting)
    if (greeting.length > PROFILE_LIMITS.greeting) return { ok: false, error: `The greeting can be at most ${PROFILE_LIMITS.greeting} characters.` }
    if (CONTROL.test(greeting.replace(/\n/g, ''))) return { ok: false, error: 'Remove the hidden characters from the greeting.' }
    // Meta shows a Messenger menu only when Get Started is set.
    getStarted = b.get_started === true || menu.length > 0
  }
  return { ok: true, value: { ice_breakers: ice, persistent_menu: menu, greeting, get_started: getStarted } }
}

/** The messenger_profile request body for Meta. */
export function profileRequestBody(p: ChatProfile, channel: SocialChannel): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (p.ice_breakers.length > 0) {
    body.ice_breakers = [{ locale: 'default', call_to_actions: p.ice_breakers.map((i) => ({ question: i.question, payload: i.payload })) }]
  }
  const menu = p.persistent_menu.map((m) => ('type' in m
    ? { type: 'web_url', title: m.title, url: m.url }
    : { type: 'postback', title: m.title, payload: m.payload }))
  if (menu.length > 0) {
    body.persistent_menu = [{ locale: 'default', composer_input_disabled: false, call_to_actions: menu }]
  }
  if (channel === 'facebook') {
    if (p.get_started) body.get_started = { payload: GET_STARTED_PAYLOAD }
    if (p.greeting) body.greeting = [{ locale: 'default', text: p.greeting }]
  }
  return body
}

/** Which profile fields to clear at Meta: the ones the owner left empty. */
export function fieldsToClear(p: ChatProfile, channel: SocialChannel): string[] {
  const out: string[] = []
  if (p.ice_breakers.length === 0) out.push('ice_breakers')
  if (p.persistent_menu.length === 0) out.push('persistent_menu')
  if (channel === 'facebook') {
    if (!p.greeting) out.push('greeting')
    if (!p.get_started) out.push('get_started')
  }
  return out
}

/** A stored profile read back safely (old rows may hold anything). */
export function storedProfile(raw: { ice_breakers?: unknown; persistent_menu?: unknown; greeting?: unknown; get_started?: unknown } | null | undefined, channel: SocialChannel): ChatProfile {
  const r = cleanProfile(raw ?? {}, channel)
  return r.ok ? r.value : { ice_breakers: [], persistent_menu: [], greeting: '', get_started: false }
}
