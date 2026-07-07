import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { sendReactionMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

/**
 * POST /api/whatsapp/react
 *
 * Body: { message_id: <internal UUID>, emoji: <single emoji or "" to remove> }
 *
 * Sends the reaction to Meta and mirrors it into `message_reactions`
 * (delete on empty emoji). Customer-side reactions are handled by the
 * webhook — this route only writes `actor_type = 'agent'` rows.
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const limit = checkRateLimit(`react:${userId}`, RATE_LIMITS.react);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    // Resolve the caller's account_id and role so conversation lookups
    // work for teammates who didn't author the rows directly, and so
    // agents are restricted to their assigned conversations.
    const profile = await prisma.profile.findUnique({
      where: { user_id: userId },
      select: { account_id: true, account_role: true },
    });
    const accountId = profile?.account_id;
    const isAgent = profile?.account_role === "agent";
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { message_id, emoji } = body as {
      message_id?: string;
      emoji?: string;
    };

    if (!message_id || typeof emoji !== 'string') {
      return NextResponse.json(
        { error: 'message_id and emoji are required' },
        { status: 400 },
      );
    }

    // Resolve target message + its conversation; verify ownership.
    const targetMessage = await prisma.message.findUnique({
      where: { id: message_id },
      select: { id: true, message_id: true, conversation_id: true },
    });

    if (!targetMessage) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    if (!targetMessage.message_id) {
      return NextResponse.json(
        { error: 'Cannot react to a message that has not been sent to WhatsApp' },
        { status: 400 },
      );
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: targetMessage.conversation_id,
        account_id: accountId,
        ...(isAgent ? { assigned_agent_id: userId } : {}),
      },
      select: {
        id: true,
        account_id: true,
        contact: { select: { phone: true } },
      },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 },
      );
    }

    const contactPhone = conversation.contact?.phone;
    if (!contactPhone) {
      return NextResponse.json(
        { error: 'Contact phone number not found' },
        { status: 400 },
      );
    }

    // WhatsApp config + access token. Account-scoped.
    const config = await prisma.whatsAppConfig.findUnique({
      where: { account_id: accountId },
      select: { phone_number_id: true, access_token: true },
    });

    if (!config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured.' },
        { status: 400 },
      );
    }

    const accessToken = decrypt(config.access_token);
    const sanitizedPhone = sanitizePhoneForMeta(contactPhone);

    try {
      await sendReactionMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: sanitizedPhone,
        targetMessageId: targetMessage.message_id,
        emoji,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown Meta API error';
      console.error('[whatsapp/react] Meta send failed:', message);
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 502 },
      );
    }

    // Mirror into DB. Empty emoji = removal.
    if (emoji === '') {
      try {
        await prisma.messageReaction.deleteMany({
          where: {
            message_id: targetMessage.id,
            actor_type: 'agent',
            actor_id: userId,
          },
        });
      } catch (err) {
        console.error('[whatsapp/react] DB delete failed:', err instanceof Error ? err.message : err);
        return NextResponse.json(
          { error: 'Reaction sent to Meta but DB delete failed' },
          { status: 500 },
        );
      }
    } else {
      // Upsert. The unique constraint (message_id, actor_type, actor_id)
      // lets us swap emoji in a single statement.
      try {
        await prisma.messageReaction.upsert({
          where: {
            message_id_actor_type_actor_id: {
              message_id: targetMessage.id,
              actor_type: 'agent',
              actor_id: userId,
            },
          },
          create: {
            message_id: targetMessage.id,
            conversation_id: targetMessage.conversation_id,
            actor_type: 'agent',
            actor_id: userId,
            emoji,
          },
          update: { emoji },
        });
      } catch (err) {
        console.error('[whatsapp/react] DB upsert failed:', err instanceof Error ? err.message : err);
        return NextResponse.json(
          { error: 'Reaction sent to Meta but DB upsert failed' },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in WhatsApp react POST:', error);
    return NextResponse.json(
      { error: 'Failed to react to message' },
      { status: 500 },
    );
  }
}
