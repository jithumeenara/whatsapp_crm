/**
 * What happens when a call arrives.
 *
 * Records it, decides who should take it, and rings them. The decision
 * of *who* reuses the same routing the chatbot handoff step uses — there
 * is one idea of "an agent who is actually available" in this app and it
 * should not grow a second one for calls.
 *
 * Deliberately never throws at the webhook. Meta retries a webhook that
 * does not return 200, and a retry storm on a call that already rang is
 * worse than a dropped log line.
 */

import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { emitToAccount } from '@/lib/socket'
import { pickAgent, type AgentPickStrategy } from '@/lib/flows/agent-routing'
import { rejectCall, type CallWebhookEvent } from '@/lib/whatsapp/calling-api'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

interface HandleArgs {
  accountId: string
  phoneNumberId: string
  accessToken: string
  event: CallWebhookEvent
}

export async function handleCallEvent(args: HandleArgs): Promise<void> {
  try {
    if (args.event.kind === 'connect') return await handleIncoming(args, args.event)
    if (args.event.kind === 'terminate') return await handleTerminate(args, args.event)

    // Anything Meta adds later. Recorded rather than guessed at — an
    // unrecognised event on a known call is still worth having.
    if (args.event.callId) {
      await prisma.call
        .updateMany({
          where: { provider_call_id: args.event.callId },
          data: { end_reason: args.event.event },
        })
        .catch(() => {})
    }
    console.log(`[calls] unhandled event "${args.event.event}"`)
  } catch (err) {
    // Never rethrown: Meta retries anything that is not a 200, and a
    // retry storm on a call that has already rung helps nobody.
    console.error('[calls] handler failed:', err instanceof Error ? err.message : err)
  }
}

async function handleIncoming(
  args: HandleArgs,
  event: Extract<CallWebhookEvent, { kind: 'connect' }>,
): Promise<void> {
  const config = await prisma.callConfig.findUnique({ where: { account_id: args.accountId } })

  // Matched to a contact by number so the ringing popup can say a name
  // rather than eleven digits. Failing to match is normal — someone can
  // call who has never messaged — and is not an error.
  const normalized = normalizePhone(event.from)
  const contact = await prisma.contact.findFirst({
    where: { account_id: args.accountId, phone: { in: [event.from, normalized].filter(Boolean) } },
    select: { id: true, name: true, phone: true },
  })

  const conversation = contact
    ? await prisma.conversation.findFirst({
        where: { account_id: args.accountId, contact_id: contact.id, channel: 'whatsapp' },
        orderBy: { last_message_at: 'desc' },
        select: { id: true },
      })
    : null

  // Upserted on the provider's id, because Meta replays webhooks and a
  // replay must not produce a second row for one call.
  const call = await prisma.call.upsert({
    where: { provider_call_id: event.callId },
    create: {
      account_id: args.accountId,
      provider_call_id: event.callId,
      channel: 'whatsapp',
      direction: 'inbound',
      status: 'ringing',
      from_number: event.from,
      to_number: event.to,
      contact_id: contact?.id ?? null,
      conversation_id: conversation?.id ?? null,
      started_at: event.timestamp,
      raw_payload: { sdp_offer_present: Boolean(event.sdp) },
    },
    update: {},
    select: { id: true, status: true },
  })

  // A replay of a call already dealt with. Ringing it again would put a
  // popup back on screen for a conversation that has moved on.
  if (call.status !== 'ringing') return

  const pick = await pickAgent({
    accountId: args.accountId,
    strategy: (config?.transfer_strategy as AgentPickStrategy) ?? 'least_busy',
    specificUserId: config?.transfer_to ?? null,
    onlyOnline: config?.transfer_only_online ?? true,
    fallbackUserId: config?.transfer_fallback_to ?? null,
  }).catch(() => ({ agent: null, reason: 'agent selection failed' }))

  const aiWouldAnswer = Boolean(config?.ai_answer_enabled)

  // Nobody to ring and no assistant to answer. Declined rather than left
  // to ring out: a caller who is told immediately can try something else,
  // where thirty seconds of ringing into an empty office teaches them the
  // number does not work.
  if (!pick.agent && !aiWouldAnswer) {
    await rejectCall({
      phoneNumberId: args.phoneNumberId,
      accessToken: args.accessToken,
      callId: event.callId,
    }).catch(() => {})
    await prisma.call.update({
      where: { id: call.id },
      data: {
        status: 'missed',
        ended_at: new Date(),
        end_reason: pick.reason,
      },
    })
    console.warn(`[calls] declined ${event.callId}: ${pick.reason}, and the assistant is not answering calls`)
    emitToAccount(args.accountId, 'call', { type: 'ended', callId: call.id, agentId: null })
    return
  }

  // Rung on every open screen. An unassigned call deliberately rings
  // everyone — two people answering is a far smaller problem than nobody,
  // and the claim is settled in the respond route, not here.
  emitToAccount(args.accountId, 'call', {
    type: 'ringing',
    callId: call.id,
    agentId: pick.agent?.userId ?? null,
    callerName: contact?.name ?? null,
    callerNumber: event.from,
    conversationId: conversation?.id ?? null,
    transferredFromAi: false,
    transferReason: null,
    ringSeconds: config?.ring_seconds ?? 30,
  })

  // Says who it went to, because "the popup did not appear" and "the
  // popup appeared for somebody else" look identical from one screen and
  // need completely different fixes.
  console.log(
    `[calls] ringing ${event.callId} from ${contact?.name ?? event.from} — ${pick.reason}` +
      (pick.agent ? ` [to ${pick.agent.fullName}]` : ' [to everyone]') +
      (aiWouldAnswer ? ' (assistant is standing by)' : ''),
  )

  // What is deliberately NOT done here: accepting the call. Answering
  // needs an SDP answer from a real WebRTC stack (see calling-api.ts), and
  // fabricating one would produce a call that connects and then sits in
  // silence — the hardest possible failure to diagnose. Until that exists,
  // an unanswered call ends the way Meta ends it, and lands in history as
  // missed.
  void markMissedAfterRinging(call.id, config?.ring_seconds ?? 30)
}

/**
 * A call nobody picked up is missed once the ring window passes.
 *
 * Meta sends a terminate event too, and that is the authority; this is
 * the safety net for when it does not arrive, so a call cannot sit in
 * history as "ringing" for ever. Guarded on status so it can never
 * overwrite a call somebody actually answered.
 */
async function markMissedAfterRinging(callId: string, ringSeconds: number): Promise<void> {
  const graceMs = (ringSeconds + 15) * 1000
  setTimeout(() => {
    void prisma.call
      .updateMany({
        where: { id: callId, status: 'ringing' },
        data: { status: 'missed', ended_at: new Date(), end_reason: 'no answer' },
      })
      .catch(() => {})
  }, graceMs).unref?.()
}

async function handleTerminate(
  args: HandleArgs,
  event: Extract<CallWebhookEvent, { kind: 'terminate' }>,
): Promise<void> {
  const call = await prisma.call.findUnique({
    where: { provider_call_id: event.callId },
    select: { id: true, status: true, answered_at: true, started_at: true, handled_by: true },
  })
  if (!call) return

  const endedAt = event.timestamp

  // Was this call actually answered?
  //
  // Pressing Answer in the app is one way to know, and until the media
  // path exists it is the rarer one — a call answered on somebody's
  // handset never touches this app at all. Meta knows, and says so two
  // ways: a status, and a talk duration. A duration above zero means two
  // people were connected, whatever the status string happens to read.
  //
  // Deciding this on answered_at alone filed every real conversation
  // held on a phone as a call nobody took.
  const metaStatus = (event.status ?? '').toLowerCase()
  const connected =
    Boolean(call.answered_at) ||
    (event.durationSeconds ?? 0) > 0 ||
    metaStatus === 'completed' ||
    metaStatus === 'answered'

  // Talk time, not ring time. Null when it was never answered — zero
  // would read as "answered, said nothing".
  const duration =
    event.durationSeconds ??
    (call.answered_at
      ? Math.max(0, Math.round((endedAt.getTime() - call.answered_at.getTime()) / 1000))
      : null)

  // Reconstructed when the call was answered somewhere this app could
  // not see. Without it the history shows talk time but claims the call
  // was never picked up, which is the contradiction that started this.
  const answeredAt =
    call.answered_at ??
    (connected && duration && duration > 0 ? new Date(endedAt.getTime() - duration * 1000) : null)

  await prisma.call.update({
    where: { id: call.id },
    data: {
      status: connected ? 'completed' : 'missed',
      answered_at: answeredAt,
      // A person took it, even though this app cannot say which — the
      // assistant cannot answer calls yet, so there is no other
      // possibility.
      handled_by: call.handled_by ?? (connected ? 'agent' : null),
      ended_at: endedAt,
      duration_seconds: duration,
      end_reason: event.status ?? (connected ? null : 'no answer'),
    },
  })

  // Stops every popup still ringing for this call.
  emitToAccount(args.accountId, 'call', { type: 'ended', callId: call.id, agentId: null })
}

/** Resolves the decrypted token for an account's number, for the actions
 *  the webhook has to take back against Meta. */
export async function resolveCallCredentials(
  phoneNumberId: string,
): Promise<{ accountId: string; accessToken: string } | null> {
  const config = await prisma.whatsAppConfig.findFirst({
    where: { phone_number_id: phoneNumberId },
    select: { account_id: true, access_token: true },
  })
  if (!config?.access_token) return null
  try {
    return { accountId: config.account_id, accessToken: decrypt(config.access_token) }
  } catch {
    return null
  }
}
