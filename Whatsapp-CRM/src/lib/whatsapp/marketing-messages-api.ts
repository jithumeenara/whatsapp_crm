/**
 * Meta's Marketing Messages API eligibility check (Finding #10) — a
 * separate, self-serve WABA-level field, distinct from the Cloud API
 * messaging surface everything else in this app talks to. Confirmed via
 * live docs: check eligibility via `marketing_messages_onboarding_status`
 * on the WABA; only the literal "ELIGIBLE" unlocks routing through
 * /marketing_messages — everything else (including a missing/errored
 * check) transparently falls back to the normal /messages endpoint.
 */

import { throwMetaError } from './meta-api'

const GRAPH_API_VERSION = 'v21.0'
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

export async function checkMarketingMessagesEligibility(args: {
  wabaId: string
  accessToken: string
}): Promise<{ status: string | null }> {
  const { wabaId, accessToken } = args
  const url = `${GRAPH_API_BASE}/${wabaId}?fields=marketing_messages_onboarding_status`
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
  // Reuse meta-api.ts's shared error formatter instead of hand-rolling one —
  // it appends the "(code X.Y)" suffix classifyMetaError() depends on to
  // detect rate-limit/auth-expired errors. A bare `throw new Error(message)`
  // here (the original bug) meant every Marketing Messages error silently
  // fell through to 'unknown', losing that classification entirely.
  if (!response.ok) await throwMetaError(response, `Eligibility check failed: ${response.status}`)
  const data = await response.json()
  return { status: data.marketing_messages_onboarding_status ?? null }
}
