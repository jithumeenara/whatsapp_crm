import { prisma } from "@/lib/db";
import { sendTemplateMessage, sendMarketingTemplateMessage } from "@/lib/whatsapp/meta-api";
import { decrypt } from "@/lib/whatsapp/encryption";
import { isMessageTemplate } from "@/lib/whatsapp/template-row-guard";
import { emitToAccount } from "@/lib/socket";
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from "@/lib/whatsapp/phone-utils";
import { resolveVariables, resolveVariablesByKey, type VariableMapping } from "@/lib/broadcasts/resolve-variables";
import { buildDataStoreIndex } from "@/lib/broadcasts/resolve-data-store";
import { extractVariableKeys, isNamedVariableText } from "@/lib/whatsapp/template-variable-keys";
import { resolveMediaRef } from "@/lib/whatsapp/media-ref";
import { classifyMetaError } from "@/lib/whatsapp/meta-error-codes";
import { resolveWhatsAppConfig, NoWhatsAppConfigError } from "@/lib/whatsapp/resolve-config";

const INTER_MESSAGE_MS = 350;
const RATE_LIMIT_BACKOFF_MS = 5_000;
const RATE_LIMIT_MAX_RETRIES = 2;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Reuses the contact's existing WhatsApp conversation if one already
 *  exists (the normal case — most broadcast recipients have messaged in
 *  before), otherwise creates one. Mirrors the SMS webhook's
 *  findOrCreateSmsConversation, channel:'whatsapp' instead of 'sms'. */
async function findOrCreateWhatsAppConversation(accountId: string, ownerUserId: string, contactId: string, whatsappConfigId: string, createIfMissing: boolean) {
  const existing = await prisma.conversation.findFirst({
    where: { account_id: accountId, contact_id: contactId, channel: "whatsapp", whatsapp_config_id: whatsappConfigId },
  });
  if (existing) return existing;
  // The quiet path stops here. A recipient who has never written in has
  // no thread, and a broadcast is not a reason to open one — the reply
  // is, and the webhook opens it then. Until that happens the send is
  // recorded where it belongs, on the campaign.
  if (!createIfMissing) return null;
  try {
    return await prisma.conversation.create({
      data: { account_id: accountId, user_id: ownerUserId, contact_id: contactId, channel: "whatsapp", whatsapp_config_id: whatsappConfigId },
    });
  } catch (err) {
    console.error("[runBroadcast] conversation create failed:", err);
    return null;
  }
}

/**
 * Writes the Message row for a sent broadcast recipient, so it shows up
 * in that contact's thread. broadcast_id tags it so the bubble can
 * render a "Broadcast" badge. Best-effort: a failure here doesn't undo
 * the real send that already happened, so it's logged and swallowed
 * rather than thrown.
 *
 * ── Why it does not touch the Inbox list ────────────────────────────
 *
 * Because a bulk send is not a conversation. Sending to five hundred
 * people opened five hundred threads and lifted every one of them to
 * the top by last_message_at — so the three customers who had actually
 * asked something were somewhere below four hundred and ninety-seven
 * people who had received an offer and said nothing. The Inbox is a
 * list of things to do, and one campaign could empty it of meaning.
 *
 * So by default a broadcast writes its message into a thread that
 * already exists, and does no more: no new thread for a stranger, no
 * reordering, no unread count, no live event. The customer's reply is
 * what puts them in the Inbox — and the webhook already handles that,
 * including reopening a closed thread.
 *
 * Nothing is lost. The send is on the campaign's own page, recipient by
 * recipient with its delivery state, which is where somebody looks to
 * ask "did this reach them".
 *
 * An account that wants the old behaviour turns on "Show in Inbox" for
 * that campaign.
 */
export async function recordBroadcastMessage(args: {
  accountId: string
  ownerUserId: string
  broadcastId: string
  contactId: string
  templateName: string
  renderedBody: string
  whatsappMessageId: string
  whatsappConfigId: string
  /** The campaign's own choice. False keeps the Inbox as it was. */
  showInInbox: boolean
}) {
  try {
    const conversation = await findOrCreateWhatsAppConversation(
      args.accountId,
      args.ownerUserId,
      args.contactId,
      args.whatsappConfigId,
      args.showInInbox,
    );
    if (!conversation) return;

    const savedMsg = await prisma.message.create({
      data: {
        conversation_id: conversation.id,
        sender_type: "agent",
        sender_id: args.ownerUserId,
        content_type: "template",
        content_text: args.renderedBody,
        template_name: args.templateName,
        message_id: args.whatsappMessageId || null,
        status: "sent",
        broadcast_id: args.broadcastId,
      },
    });
    // Emitted either way: somebody with this one thread open should see
    // the message land in it. What is withheld below is the *list*
    // event, which is what reorders the Inbox.
    emitToAccount(args.accountId, "message", { eventType: "INSERT", new: savedMsg, old: {} });

    if (!args.showInInbox) return;

    const updatedConv = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { last_message_text: args.renderedBody, last_message_at: new Date() },
    });
    emitToAccount(args.accountId, "conversation", { eventType: "UPDATE", new: updatedConv, old: {} });
  } catch (err) {
    console.error("[runBroadcast] recordBroadcastMessage failed:", err);
  }
}

/**
 * Runs the full broadcast send loop server-side.
 * Checks DB for "cancelling" before each message and stops early.
 * Never throws — writes failures to DB directly.
 *
 * @param recipientFilter optional filter; if omitted, loads all "pending" recipients.
 */
export async function runBroadcast(broadcastId: string, accountId: string) {
  const broadcast = await prisma.broadcast.findFirst({
    where: { id: broadcastId, account_id: accountId },
    include: {
      recipients: {
        where: { status: "pending" },
        include: { contact: true },
        orderBy: { created_at: "asc" },
      },
    },
  });

  if (!broadcast) return;

  // Which connected number this campaign sends from (Finding #14) —
  // the broadcast's own choice, falling back to the account's default.
  let config;
  try {
    config = await resolveWhatsAppConfig({ accountId, whatsappConfigId: broadcast.whatsapp_config_id });
  } catch (err) {
    if (err instanceof NoWhatsAppConfigError) {
      await prisma.broadcast.update({ where: { id: broadcastId }, data: { status: "failed" } });
      return;
    }
    throw err;
  }

  const accessToken = decrypt(config.access_token);

  // Resolve the campaign's header media (if any) to a real Meta-usable
  // reference ONCE, up front — not per recipient. A relative
  // /api/files/... upload URL isn't fetchable by Meta's servers and was
  // being sent as-is, which Meta rejects with "Param ...link is not a
  // valid URI" for every single recipient. See media-ref.ts.
  let resolvedHeaderMedia: { id: string; link?: never } | { link: string; id?: never } | null = null;
  if (broadcast.header_media_url) {
    try {
      resolvedHeaderMedia = await resolveMediaRef(broadcast.header_media_url, config.phone_number_id, accessToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      await prisma.broadcast.update({
        where: { id: broadcastId },
        data: { status: "failed" },
      });
      console.error(`[runBroadcast] Failed to resolve header media for broadcast ${broadcastId}:`, msg);
      return;
    }
  }

  const templateRow = await prisma.messageTemplate.findFirst({
    where: {
      account_id: accountId,
      // Templates are approved per-WABA (Finding #14) — filter to the
      // WABA this campaign is actually sending on when known, so a
      // same-named template on a different number's WABA can't be
      // picked by mistake.
      ...(config.waba_id ? { waba_id: config.waba_id } : {}),
      name: broadcast.template_name,
      language: broadcast.template_language,
    },
  });
  if (templateRow && !isMessageTemplate(templateRow)) {
    await prisma.broadcast.update({ where: { id: broadcastId }, data: { status: "failed" } });
    return;
  }

  // Finding #10 — Marketing-category sends on an eligible number route
  // through Meta's dedicated /marketing_messages endpoint (better
  // deliverability, per Meta's own claim). Never a hard requirement:
  // an unenrolled number, or any non-Marketing template, uses the
  // normal endpoint unchanged.
  const useMarketingEndpoint = templateRow?.category === "Marketing" && config.marketing_messages_status === "ELIGIBLE";
  const templateSendFn = useMarketingEndpoint ? sendMarketingTemplateMessage : sendTemplateMessage;

  const variables = (broadcast.template_variables ?? {}) as Record<string, VariableMapping>;
  // Mapping is never mandatory — a placeholder the user never touched in
  // the Personalize step simply has no entry in `variables` at all. Give
  // it a blank static mapping so resolveVariables/resolveVariablesByKey
  // (which only iterate Object.keys(variables)) don't silently drop it;
  // orBlankSpace() in resolve-variables.ts turns the blank into a single
  // space rather than failing the send.
  if (templateRow) {
    for (const key of extractVariableKeys(templateRow.body_text)) {
      if (!(key in variables)) variables[key] = { type: "static", value: "" };
    }
  }

  const contactIds = broadcast.recipients.map((r) => r.contact_id).filter(Boolean);
  const customValueRows = await prisma.contactCustomValue.findMany({
    where: { contact_id: { in: contactIds } },
    select: { contact_id: true, custom_field_id: true, value: true },
  });
  const customIndex: Record<string, Record<string, string>> = {};
  for (const row of customValueRows) {
    if (!customIndex[row.contact_id]) customIndex[row.contact_id] = {};
    customIndex[row.contact_id][row.custom_field_id] = row.value ?? "";
  }

  // Pre-resolve any Data Store-mapped variables in one pass per table
  // (not one query per recipient) — see resolve-data-store.ts.
  const dataStoreIndex = await buildDataStoreIndex(
    variables,
    broadcast.recipients
      .map((r) => r.contact)
      .filter((c): c is NonNullable<typeof c> => Boolean(c)),
  );

  let sentCount = 0;
  let failedCount = 0;

  for (let i = 0; i < broadcast.recipients.length; i++) {
    const recipient = broadcast.recipients[i];

    // Cancellation check before each message
    const current = await prisma.broadcast.findFirst({
      where: { id: broadcastId },
      select: { status: true },
    });
    if (current?.status === "cancelling" || current?.status === "cancelled") {
      await prisma.broadcast.update({ where: { id: broadcastId }, data: { status: "cancelled" } });
      return;
    }

    if (i > 0) await sleep(INTER_MESSAGE_MS);

    const contact = recipient.contact;
    if (!contact?.phone) {
      await prisma.broadcastRecipient.update({
        where: { id: recipient.id },
        data: { status: "failed", error_message: "No phone number on contact" },
      });
      failedCount++;
      await prisma.broadcast.update({ where: { id: broadcastId }, data: { failed_count: { increment: 1 } } });
      continue;
    }

    const sanitized = sanitizePhoneForMeta(contact.phone);
    if (!isValidE164(sanitized)) {
      await prisma.broadcastRecipient.update({
        where: { id: recipient.id },
        data: { status: "failed", error_message: "Invalid phone number format" },
      });
      failedCount++;
      await prisma.broadcast.update({ where: { id: broadcastId }, data: { failed_count: { increment: 1 } } });
      continue;
    }

    // Named-parameter templates ({{customer_name}}) must match values by
    // name, not array position — resolveVariables' sorted array is only
    // meaningful for positional ({{1}}, {{2}}) templates. See
    // template-variable-keys.ts for why the two formats need different
    // handling all the way through to the actual Meta send payload.
    const named = isNamedVariableText(templateRow?.body_text);
    const contactForResolve = { name: contact.name, phone: contact.phone, email: contact.email, company: contact.company };
    // Resolved once by key regardless of format — used directly as
    // bodyByName for a named template, and always used to build the
    // recipient's rendered_body preview (substituting by key name works
    // the same way for "1"/"2" as it does for "customer_name").
    const resolvedByKey = resolveVariablesByKey(variables, contactForResolve, customIndex[contact.id] ?? {}, dataStoreIndex[contact.id] ?? {});
    const params = named
      ? undefined
      : resolveVariables(variables, contactForResolve, customIndex[contact.id] ?? {}, dataStoreIndex[contact.id] ?? {});
    const bodyByName = named ? resolvedByKey : undefined;

    let renderedBody = templateRow?.body_text ?? "";
    for (const [key, value] of Object.entries(resolvedByKey)) {
      renderedBody = renderedBody.replaceAll(`{{${key}}}`, value);
    }

    const variants = phoneVariants(sanitized);
    let sentMessageId: string | null = null;
    let lastError: string | null = null;
    // Stop trying additional phone variants on permanent errors (bad template,
    // suspended account, etc.). Only continue to the next variant for
    // "recipient not in allowed list" errors, which indicate a format mismatch.
    let permanentError = false;
    // A code-190 (expired/invalid token) means every remaining send in
    // this run is doomed too — not just this one recipient. Distinct from
    // permanentError, which only stops trying phone variants for THIS
    // recipient before moving on to the next one.
    let tokenExpired = false;

    for (const variant of variants) {
      if (permanentError) break;
      let attempt = 0;
      while (attempt <= RATE_LIMIT_MAX_RETRIES) {
        try {
          const result = await templateSendFn({
            phoneNumberId: config.phone_number_id,
            accessToken,
            to: variant,
            templateName: broadcast.template_name,
            language: broadcast.template_language,
            template: templateRow ?? undefined,
            params,
            messageParams: {
              // Campaign-level override of the template's approved sample
              // media, when the user picked one for this broadcast —
              // resolved to a real Meta media id/URL above, never the raw
              // relative /api/files/... path. Falls back to the template's
              // own header_media_url when unset (buildSendComponents
              // handles that fallback already).
              headerMediaUrl: resolvedHeaderMedia && "link" in resolvedHeaderMedia ? resolvedHeaderMedia.link : undefined,
              headerMediaId: resolvedHeaderMedia && "id" in resolvedHeaderMedia ? resolvedHeaderMedia.id : undefined,
              bodyByName,
            },
          });
          sentMessageId = result.messageId;
          lastError = null;
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          const classified = classifyMetaError(msg);
          if (classified.category === "rate_limited" && attempt < RATE_LIMIT_MAX_RETRIES) {
            await sleep(RATE_LIMIT_BACKOFF_MS * (attempt + 1));
            attempt++;
            continue;
          }
          lastError = msg;
          if (classified.category === "auth_expired") {
            tokenExpired = true;
            permanentError = true;
          } else if (!isRecipientNotAllowedError(msg)) {
            permanentError = true;
          }
          break;
        }
      }
      if (sentMessageId || tokenExpired) break;
    }

    if (sentMessageId) {
      await prisma.broadcastRecipient.update({
        where: { id: recipient.id },
        data: { status: "sent", sent_at: new Date(), whatsapp_message_id: sentMessageId, error_message: null, rendered_body: renderedBody },
      });
      sentCount++;
      await prisma.broadcast.update({ where: { id: broadcastId }, data: { sent_count: { increment: 1 } } });
      await recordBroadcastMessage({
        accountId,
        ownerUserId: broadcast.user_id,
        broadcastId,
        contactId: contact.id,
        templateName: broadcast.template_name,
        renderedBody,
        whatsappMessageId: sentMessageId,
        whatsappConfigId: config.id,
        showInInbox: broadcast.show_in_inbox,
      });
    } else {
      await prisma.broadcastRecipient.update({
        where: { id: recipient.id },
        data: { status: "failed", error_message: lastError ?? "Send failed", rendered_body: renderedBody },
      });
      failedCount++;
      await prisma.broadcast.update({ where: { id: broadcastId }, data: { failed_count: { increment: 1 } } });

      // The token is bad for every remaining recipient too — stop burning
      // API calls one doomed request at a time and bulk-fail whatever's
      // still pending in one shot, instead of letting the loop keep
      // grinding through the rest of the list.
      if (tokenExpired) {
        await prisma.broadcastRecipient.updateMany({
          where: { broadcast_id: broadcastId, status: "pending" },
          data: {
            status: "failed",
            error_message: "Broadcast aborted: WhatsApp access token expired mid-run. Reconnect WhatsApp in Settings, then retry the failed recipients.",
          },
        });
        const remaining = broadcast.recipients.length - (i + 1);
        if (remaining > 0) {
          failedCount += remaining;
          await prisma.broadcast.update({ where: { id: broadcastId }, data: { failed_count: { increment: remaining } } });
        }
        await prisma.broadcast.update({ where: { id: broadcastId }, data: { status: "failed" } });
        return;
      }
    }
  }

  // C4 fix: use the DB's accumulated sent_count (not local counter) so that
  // a retry run which itself sends 0 doesn't mark a previously-partially-sent
  // broadcast as "failed".
  const finalRow = await prisma.broadcast.findFirst({
    where: { id: broadcastId },
    select: { sent_count: true },
  });
  const finalStatus = (finalRow?.sent_count ?? 0) > 0 ? "sent" : "failed";
  await prisma.broadcast.update({ where: { id: broadcastId }, data: { status: finalStatus } });
}
