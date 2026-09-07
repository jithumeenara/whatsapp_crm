/**
 * Meta's Marketing Messages API eligibility check (Finding #10) — a
 * separate, self-serve WABA-level field, distinct from the Cloud API
 * messaging surface everything else in this app talks to. Confirmed via
 * live docs: check eligibility via `marketing_messages_onboarding_status`
 * on the WABA; only the literal "ELIGIBLE" unlocks routing through
 * /marketing_messages — everything else (including a missing/errored
 * check) transparently falls back to the normal /messages endpoint.
 */

const GRAPH_API_VERSION = 'v21.0'
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

export async function checkMarketingMessagesEligibility(args: {
  wabaId: string
  accessToken: string
}): Promise<{ status: string | null }> {
  const { wabaId, accessToken } = args
  const url = `${GRAPH_API_BASE}/${wabaId}?fields=marketing_messages_onboarding_status`
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
  if (!response.ok) {
    let message = `Eligibility check failed: ${response.status}`
    try {
      const data = await response.json()
      if (data?.error?.message) message = data.error.message
    } catch {
      // not JSON — keep the fallback
    }
    throw new Error(message)
  }
  const data = await response.json()
  return { status: data.marketing_messages_onboarding_status ?? null }
}
