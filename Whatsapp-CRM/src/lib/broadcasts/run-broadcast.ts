import { prisma } from "@/lib/db";
import { sendTemplateMessage } from "@/lib/whatsapp/meta-api";
import { decrypt } from "@/lib/whatsapp/encryption";
import { isMessageTemplate } from "@/lib/whatsapp/template-row-guard";
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from "@/lib/whatsapp/phone-utils";
import { resolveVariables } from "@/lib/broadcasts/resolve-variables";

const INTER_MESSAGE_MS = 350;
const RATE_LIMIT_BACKOFF_MS = 5_000;
const RATE_LIMIT_MAX_RETRIES = 2;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(msg: string): boolean {
  return /rate.?limit|too many|131048|80007/i.test(msg);
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

  const config = await prisma.whatsAppConfig.findUnique({
    where: { account_id: accountId },
  });
  if (!config) {
    await prisma.broadcast.update({ where: { id: broadcastId }, data: { status: "failed" } });
    return;
  }

  const accessToken = decrypt(config.access_token);

  const templateRow = await prisma.messageTemplate.findFirst({
    where: {
      account_id: accountId,
      name: broadcast.template_name,
      language: broadcast.template_language,
    },
  });
  if (templateRow && !isMessageTemplate(templateRow)) {
    await prisma.broadcast.update({ where: { id: broadcastId }, data: { status: "failed" } });
    return;
  }

  const variables = (broadcast.template_variables ?? {}) as Record<
    string,
    { type: "static" | "field" | "custom_field"; value: string }
  >;

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

    const params = resolveVariables(
      variables,
      { name: contact.name, phone: contact.phone, email: contact.email, company: contact.company },
      customIndex[contact.id] ?? {},
    );

    const variants = phoneVariants(sanitized);
    let sentMessageId: string | null = null;
    let lastError: string | null = null;
    // Stop trying additional phone variants on permanent errors (bad template,
    // suspended account, etc.). Only continue to the next variant for
    // "recipient not in allowed list" errors, which indicate a format mismatch.
    let permanentError = false;

    for (const variant of variants) {
      if (permanentError) break;
      let attempt = 0;
      while (attempt <= RATE_LIMIT_MAX_RETRIES) {
        try {
          const result = await sendTemplateMessage({
            phoneNumberId: config.phone_number_id,
            accessToken,
            to: variant,
            templateName: broadcast.template_name,
            language: broadcast.template_language,
            template: templateRow ?? undefined,
            params,
          });
          sentMessageId = result.messageId;
          lastError = null;
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          if (isRateLimitError(msg) && attempt < RATE_LIMIT_MAX_RETRIES) {
            await sleep(RATE_LIMIT_BACKOFF_MS * (attempt + 1));
            attempt++;
            continue;
          }
          lastError = msg;
          if (!isRecipientNotAllowedError(msg)) permanentError = true;
          break;
        }
      }
      if (sentMessageId) break;
    }

    if (sentMessageId) {
      await prisma.broadcastRecipient.update({
        where: { id: recipient.id },
        data: { status: "sent", sent_at: new Date(), whatsapp_message_id: sentMessageId, error_message: null },
      });
      sentCount++;
      await prisma.broadcast.update({ where: { id: broadcastId }, data: { sent_count: { increment: 1 } } });
    } else {
      await prisma.broadcastRecipient.update({
        where: { id: recipient.id },
        data: { status: "failed", error_message: lastError ?? "Send failed" },
      });
      failedCount++;
      await prisma.broadcast.update({ where: { id: broadcastId }, data: { failed_count: { increment: 1 } } });
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
