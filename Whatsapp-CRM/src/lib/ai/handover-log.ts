/**
 * One row per handover to a person (migration 163, ai_handovers), for
 * Reports → AI & Automation: how many, why, how many outside working
 * hours, and which questions the assistant could not answer.
 *
 * Best effort by design: the handover itself (status, note, alert) has
 * already happened when this runs, and a failure here — including a
 * server that has not run migration 163 yet — is logged and swallowed.
 */

import { prisma } from '@/lib/db'
import { teamHoursNow } from './team-hours'

export const HANDOVER_REASONS = [
  'low_confidence', 'unsupported_details', 'assistant_requested', 'escalation_topic',
  'turn_limit', 'asked_for_person', 'registration', 'flow_step', 'other',
] as const
export type HandoverReason = (typeof HANDOVER_REASONS)[number]

export interface HandoverInput {
  accountId: string
  conversationId: string
  source: 'ai' | 'flow'
  reason: string
  /** The customer's last message, when the assistant could not answer it. */
  question?: string | null
}

const MAX_QUESTION = 500

const FLOW_REASONS: Record<string, HandoverReason> = {
  handoff_node: 'flow_step',
  ai_reply_safety_guard: 'escalation_topic',
  ai_reply_action_token: 'assistant_requested',
  ai_reply_generation_failed: 'low_confidence',
  customer_asked_for_a_person: 'asked_for_person',
}

/** A chatbot flow's end reason → the report's reason. Pure. */
export function flowReason(endReason: string): string {
  return FLOW_REASONS[endReason] ?? endReason
}

/** The row to write. Pure. */
export function handoverRecord(i: HandoverInput, teamOpen: boolean) {
  const reason: HandoverReason = (HANDOVER_REASONS as readonly string[]).includes(i.reason) ? (i.reason as HandoverReason) : 'other'
  const q = i.question?.trim()
  return {
    account_id: i.accountId,
    conversation_id: i.conversationId,
    source: i.source,
    reason,
    outside_hours: !teamOpen,
    question: q ? q.slice(0, MAX_QUESTION) : null,
  }
}

export async function logHandover(i: HandoverInput): Promise<void> {
  try {
    const team = await teamHoursNow(i.accountId).catch(() => ({ open: true }))
    await prisma.aiHandover.create({ data: handoverRecord(i, team.open) })
  } catch (err) {
    console.error('[handover-log] not recorded (non-fatal):', err instanceof Error ? err.message : err)
  }
}
