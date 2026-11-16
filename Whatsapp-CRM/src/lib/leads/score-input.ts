/**
 * A lead's score as sent by a person or an API key: a short label (Hot,
 * Warm, Cold or the account's own levels from Settings → Leads). Pure.
 * The same rule as the bulk route: trimmed, 1–40 characters, text only.
 */
export const MAX_SCORE_LENGTH = 40

export function parseScoreInput(raw: unknown): { ok: true; score: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'Choose a score.' }
  const score = raw.trim()
  if (!score) return { ok: false, error: 'Choose a score.' }
  if (score.length > MAX_SCORE_LENGTH) return { ok: false, error: `Keep the score under ${MAX_SCORE_LENGTH} characters.` }
  return { ok: true, score }
}
