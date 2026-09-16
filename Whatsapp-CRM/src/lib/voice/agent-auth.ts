import { timingSafeEqual } from 'node:crypto'

/**
 * Proving a request came from our own voice server.
 *
 * The voice agent runs on a separate machine and holds no session, so
 * these routes sit outside the usual login check — which makes this
 * function the only thing standing between the open internet and an
 * account's assistant prompt and call transcripts. Shared by every
 * /api/voice/* route so there is exactly one implementation to get
 * right, rather than one per route drifting apart.
 *
 * Compared in constant time. A plain === leaks, through how long it takes
 * to fail, roughly how much of a guess was correct — which is enough to
 * recover a secret one character at a time.
 */

export type VoiceAuthFailure =
  | { ok: false; reason: 'not_configured' }
  | { ok: false; reason: 'unauthorized' }

export type VoiceAuthResult = { ok: true } | VoiceAuthFailure

export function checkVoiceAgentAuth(request: Request): VoiceAuthResult {
  const expected = process.env.VOICE_AGENT_SECRET
  // No secret configured means the feature is off, not that everything is
  // permitted. Refusing here is what stops a deployment that forgot the
  // variable from serving prompts to anyone who asks.
  if (!expected) return { ok: false, reason: 'not_configured' }

  const supplied = request.headers.get('x-voice-secret') ?? ''
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'unauthorized' }
  }
  return { ok: true }
}

/** The response to send for each way the check can fail. */
export const VOICE_AUTH_RESPONSES: Record<
  VoiceAuthFailure['reason'],
  { body: { error: string }; status: number }
> = {
  not_configured: { body: { error: 'voice agent not configured' }, status: 503 },
  unauthorized: { body: { error: 'Unauthorized' }, status: 401 },
}
