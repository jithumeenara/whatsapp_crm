import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { issueLiveVoiceTicket } from '@/lib/ai/live-voice-ticket'
import { getProviderKeys } from '@/lib/ai/providers/registry'
import { LIVE_VOICE_PATH } from '@/lib/ai/live-voice-server'

/**
 * Authorises one live voice session.
 *
 * The browser cannot be handed the account's Gemini key — anyone can
 * read it out of the network tab — so it gets a short-lived signed
 * ticket instead and the key stays on the server, where the relay holds
 * the upstream connection. See lib/ai/live-voice-ticket.ts.
 */

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let accountId: string
  let userId: string
  try {
    const session = await requireRole('admin')
    accountId = session.accountId
    userId = session.userId
  } catch (err) {
    return toErrorResponse(err)
  }

  const aiConfig = await prisma.aiConfig.findUnique({ where: { account_id: accountId } })
  if (!aiConfig) {
    return NextResponse.json({ error: 'Set up the AI assistant first.' }, { status: 400 })
  }
  if (!aiConfig.live_voice_enabled) {
    return NextResponse.json(
      { error: 'Live voice is switched off. Turn it on in Advanced Features.' },
      { status: 400 },
    )
  }
  if (!getProviderKeys(aiConfig).gemini?.api_key) {
    return NextResponse.json(
      { error: 'Live voice needs a Gemini key, which this account does not have saved.' },
      { status: 400 },
    )
  }

  const body = (await req.json().catch(() => null)) as { mode?: string } | null
  const mode = body?.mode === 'admin' ? 'admin' : 'customer'

  return NextResponse.json({
    ticket: issueLiveVoiceTicket({ accountId, userId, mode }),
    path: LIVE_VOICE_PATH,
    model: aiConfig.live_voice_model,
    voice: aiConfig.live_voice_name,
  })
}
