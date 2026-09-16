import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { loadCallVoiceContext } from '@/lib/ai/live-voice-context'
import { buildCustomerContext } from '@/lib/ai/customer-context'
import { findExistingContact } from '@/lib/contacts/dedupe'
import { checkVoiceAgentAuth, VOICE_AUTH_RESPONSES } from '@/lib/voice/agent-auth'

/**
 * What the assistant on a phone call should know, and who it is talking to.
 *
 * A WhatsApp call is answered by a separate process on a separate machine
 * — Pipecat, holding the WebRTC leg — which cannot reach the database the
 * way the chat path does. Left to itself it carries a stub prompt, and the
 * result is the one failure this endpoint exists to prevent: the same
 * question answered one way in chat and another way on the phone, with
 * only one of them quoting the real fee.
 *
 * So the instruction is assembled here instead, out of the same company
 * profile, knowledge base, escalation rules and caller record the chat
 * path already uses, and handed over once at the start of each call.
 *
 * Reachable without a session, because the voice server is not a browser.
 * The shared secret below is what secures it — the same arrangement as the
 * cron sweeps and the inbound webhooks, and it is listed in proxy.ts's
 * PUBLIC_PREFIXES for the same reason they are.
 */

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = checkVoiceAgentAuth(request)
  if (!auth.ok) {
    const { body, status } = VOICE_AUTH_RESPONSES[auth.reason]
    return NextResponse.json(body, { status })
  }

  const body = (await request.json().catch(() => null)) as {
    phone_number_id?: string
    from?: string
  } | null

  const phoneNumberId = body?.phone_number_id?.trim()
  if (!phoneNumberId) {
    return NextResponse.json({ error: 'phone_number_id is required' }, { status: 400 })
  }

  // The business number the call arrived on is the only thing tying it to
  // an account, exactly as it is for an inbound message.
  const config = await prisma.whatsAppConfig.findFirst({
    where: { phone_number_id: phoneNumberId },
    select: { account_id: true },
  })
  if (!config) {
    return NextResponse.json({ error: 'unknown number' }, { status: 404 })
  }
  const accountId = config.account_id

  const callConfig = await prisma.callConfig.findUnique({
    where: { account_id: accountId },
    select: { ai_answer_enabled: true, ai_greeting: true, ai_max_minutes: true },
  })

  // Said plainly rather than by handing back an empty prompt: a voice
  // server that knows the assistant is switched off can decline the call
  // and let it ring a person instead, which is the whole point of the
  // setting.
  if (!callConfig?.ai_answer_enabled) {
    return NextResponse.json({ ai_answer_enabled: false })
  }

  const voice = await loadCallVoiceContext({ accountId, mode: 'customer' })
  if (!voice) {
    return NextResponse.json({ error: 'no assistant configured' }, { status: 404 })
  }

  // Who is calling, matched the way an inbound message is matched, so the
  // person the assistant greets is the contact the CRM already holds —
  // not a stranger it asks to introduce themselves for the fourth time.
  let callerBlock = ''
  let callerName: string | null = null
  const from = body?.from?.trim()
  if (from) {
    const contact = await findExistingContact(accountId, from).catch(() => null)
    if (contact) {
      callerName = (contact.name as string | null) ?? null
      callerBlock = await buildCustomerContext({
        accountId,
        contactId: contact.id,
        currentChannel: 'whatsapp',
      }).catch(() => '')
    }
  }

  return NextResponse.json({
    ai_answer_enabled: true,
    system_instruction: [voice.systemInstruction, callerBlock].filter(Boolean).join('\n\n'),
    voice_name: voice.voiceName,
    model: voice.model,
    greeting: callConfig.ai_greeting?.trim() || null,
    max_minutes: callConfig.ai_max_minutes,
    caller_name: callerName,
  })
}
