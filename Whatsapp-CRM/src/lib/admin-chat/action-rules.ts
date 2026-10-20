/**
 * Admin Chat actions — the rules, with no database (action-rules.test.ts).
 */

import crypto from 'crypto'
import { zonedDayRange } from './brief-rules'

export const ACTION_KINDS = ['add_follow_up', 'add_tag', 'assign_chat', 'create_lead', 'send_template', 'prepare_broadcast'] as const
export type ActionKind = (typeof ACTION_KINDS)[number]

/** How long "YES <code>" is accepted after a proposal. */
export const CONFIRM_MINUTES = 5
/** How long a web approval waits. */
export const WEB_APPROVAL_MINUTES = 30
export const UNDO_MINUTES = 10
export const BROADCAST_SECOND_APPROVER_OVER = 50

export const DAILY_ACTIONS_PER_MEMBER = 50
export const DAILY_TEMPLATE_SENDS_PER_ACCOUNT = 20
export const DAILY_BROADCAST_RECIPIENTS_PER_ACCOUNT = 500

export type ActionReply = { kind: 'yes'; code: string } | { kind: 'no' } | { kind: 'undo' }

export function parseActionReply(text: string): ActionReply | null {
  const t = text.trim().toLowerCase()
  const yes = t.match(/^yes\s*(\d{4})$/)
  if (yes) return { kind: 'yes', code: yes[1] }
  if (t === 'no') return { kind: 'no' }
  if (t === 'undo') return { kind: 'undo' }
  return null
}

/** 'chat': YES code is enough. 'web_self': the same admin confirms on the
 *  web too. 'web_other': a different owner/admin must approve on the web. */
export function approvalRule(kind: ActionKind, recipients: number | null): 'chat' | 'web_self' | 'web_other' {
  if (kind === 'prepare_broadcast') return (recipients ?? 0) > BROADCAST_SECOND_APPROVER_OVER ? 'web_other' : 'web_self'
  if (kind === 'send_template') return 'web_self'
  return 'chat'
}

export function isUndoable(kind: ActionKind): boolean {
  return kind === 'add_tag' || kind === 'assign_chat' || kind === 'add_follow_up'
}

export function newConfirmCode(): string {
  return String(crypto.randomInt(0, 10_000)).padStart(4, '0')
}

export function hashConfirmCode(actionId: string, code: string): string {
  return crypto.createHash('sha256').update(`admin-chat-action:${actionId}:${code}`).digest('hex')
}

/**
 * "2026-10-21 10:30" (or "2026-10-21T10:30", or a date alone = 10:00) as
 * the business's own local time → the real moment. Null for anything else.
 */
export function localDateTime(text: string, timeZone: string): Date | null {
  const m = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/)
  if (!m) return null
  const [, y, mo, d, h, mi] = m
  const month = Number(mo)
  const day = Number(d)
  const hour = h === undefined ? 10 : Number(h)
  const minute = mi === undefined ? 0 : Number(mi)
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null
  const date = `${y}-${mo}-${d}`
  const check = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== date) return null
  return new Date(zonedDayRange(date, timeZone).start.getTime() + (hour * 60 + minute) * 60_000)
}
