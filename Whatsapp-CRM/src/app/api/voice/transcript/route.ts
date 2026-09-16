import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { checkVoiceAgentAuth, VOICE_AUTH_RESPONSES } from '@/lib/voice/agent-auth'

/**
 * What was actually said on the call.
 *
 * The assistant holds the whole conversation on a separate machine and,
 * until now, threw it away when the call ended. So a caller who had spent
 * four minutes explaining themselves and was then passed to a person
 * started again from nothing, and nobody could answer "what did the bot
 * tell them?" the next day.
 *
 * The voice server posts the transcript here when the call disconnects.
 * Matched on Meta's own call id, which both sides already have, so no
 * correlation token has to be invented or kept in step.
 *
 * Reachable without a session because the voice server is not a browser;
 * the shared secret is what secures it.
 */

export const dynamic = 'force-dynamic'

/**
 * Long enough for a conversation nobody would want truncated — roughly
 * an hour of speech — and short enough that a broken client, or somebody
 * who has the secret and means harm, cannot quietly fill the disk one
 * request at a time.
 */
const MAX_TRANSCRIPT_CHARS = 100_000

export async function POST(request: Request) {
  const auth = checkVoiceAgentAuth(request)
  if (!auth.ok) {
    const { body, status } = VOICE_AUTH_RESPONSES[auth.reason]
    return NextResponse.json(body, { status })
  }

  const payload = (await request.json().catch(() => null)) as {
    call_id?: string
    transcript?: string
    end_reason?: string
  } | null

  const callId = payload?.call_id?.trim()
  if (!callId) {
    return NextResponse.json({ error: 'call_id is required' }, { status: 400 })
  }

  const transcript = (payload?.transcript ?? '').trim()
  if (!transcript) {
    // A call where nobody said anything is a real outcome, not an error.
    // Recording an empty transcript over a real one would lose data, so
    // this stops here rather than writing.
    return NextResponse.json({ saved: false, reason: 'empty transcript' })
  }

  const call = await prisma.call
    .findUnique({
      where: { provider_call_id: callId },
      select: { id: true, transcript: true },
    })
    .catch(() => null)
  if (!call) {
    return NextResponse.json({ error: 'unknown call' }, { status: 404 })
  }

  // Later posts append rather than replace. A call that is transferred
  // mid-way can produce two transcripts — the assistant's half and
  // whatever follows — and the second arriving should not erase the
  // first.
  const combined = call.transcript
    ? `${call.transcript}\n\n${transcript}`
    : transcript
  const stored =
    combined.length > MAX_TRANSCRIPT_CHARS
      ? `${combined.slice(0, MAX_TRANSCRIPT_CHARS)}\n\n[truncated]`
      : combined

  try {
    await prisma.call.update({
      where: { id: call.id },
      data: {
        transcript: stored,
        ...(payload?.end_reason ? { end_reason: payload.end_reason } : {}),
      },
    })
  } catch (err) {
    console.error('[POST /api/voice/transcript]', err)
    return NextResponse.json({ error: 'Could not save the transcript.' }, { status: 500 })
  }

  console.log(`[calls] transcript saved for ${callId} (${stored.length} chars)`)
  return NextResponse.json({ saved: true, chars: stored.length })
}
