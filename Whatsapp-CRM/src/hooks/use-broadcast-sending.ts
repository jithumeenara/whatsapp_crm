'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Contact } from '@/types';

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv';
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  /** Contacts carrying any of these tags are subtracted from the result. */
  excludeTagIds?: string[];
}

/**
 * Variable mapping — each template placeholder (by key, usually "1",
 * "2", …) is resolved at send time. `field` maps to a built-in contact
 * field (name/phone/email/company); `custom_field` maps to a
 * contact_custom_values.value row keyed by the custom_fields.id stored
 * in `value`.
 */
export type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string };

interface BroadcastPayload {
  name: string;
  template: { name: string; language?: string };
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
}

interface UseBroadcastSendingReturn {
  createAndSendBroadcast: (payload: BroadcastPayload) => Promise<string>;
  isProcessing: boolean;
  progress: number;
}

/**
 * Meta rate-limit buffer. 10 per batch + 1 s pause matches the spec
 * and keeps us comfortably under Meta's per-phone-number messaging
 * rate so a large broadcast never trips the upstream limiter.
 */
const SEND_BATCH_SIZE = 10;
const SEND_BATCH_DELAY_MS = 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BroadcastApiResult {
  phone: string;
  status: 'sent' | 'failed';
  whatsapp_message_id?: string;
  error?: string;
}

/**
 * Per-contact resolution of custom-field placeholders. Static and
 * built-in-field mappings resolve synchronously; custom fields read
 * from a pre-built index to avoid N+1 queries during the send loop.
 */
export function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: { name?: string | null; phone?: string | null; email?: string | null; company?: string | null },
  customValues?: Record<string, string>,
): string[] {
  // Keys are typically "1","2",... — numeric-aware sort keeps
  // {{1}} before {{10}}.
  const keys = Object.keys(variables).sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.localeCompare(b);
  });

  return keys.map((key) => {
    const v = variables[key];
    if (v.type === 'static') return v.value;

    if (v.type === 'field') {
      const fieldMap: Record<string, string | undefined | null> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
      };
      return fieldMap[v.value] ?? '';
    }

    // custom_field
    return customValues?.[v.value] ?? '';
  });
}

// Shape returned by POST /api/broadcasts
interface BroadcastSetupResult {
  broadcastId: string;
  recipients: Array<{
    id: string;
    contact: {
      id: string;
      phone: string;
      name: string | null;
      email: string | null;
      company: string | null;
    } | null;
    customValues: Record<string, string>;
  }>;
}

export function useBroadcastSending(): UseBroadcastSendingReturn {
  // accountId is available from useAuth for any remaining checks, but
  // the actual account resolution happens server-side via getCurrentAccount.
  const { accountId } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function createAndSendBroadcast(payload: BroadcastPayload): Promise<string> {
    setIsProcessing(true);
    setProgress(0);

    if (!accountId) {
      throw new Error('Your profile is not linked to an account.');
    }

    try {
      // ── Step 1: Create broadcast + resolve audience (server-side) ──
      setProgress(10);
      const setupRes = await fetch('/api/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: payload.name,
          template_name: payload.template.name,
          template_language: payload.template.language ?? 'en_US',
          variables: payload.variables,
          audience: payload.audience,
        }),
      });

      if (!setupRes.ok) {
        const err = await setupRes.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error ??
            `Failed to create broadcast (${setupRes.status})`,
        );
      }

      const setup = (await setupRes.json()) as BroadcastSetupResult;
      const { broadcastId, recipients } = setup;

      setProgress(30);

      let failedCount = 0;
      const totalRecipients = recipients.length;

      for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
        const batch = recipients.slice(i, i + SEND_BATCH_SIZE);

        const apiRecipients = batch
          .filter((r) => r.contact?.phone)
          .map((r) => ({
            phone: r.contact!.phone,
            params: resolveVariables(
              payload.variables,
              r.contact!,
              r.customValues,
            ),
          }));

        // Collect per-recipient updates to write back in one call.
        const recipientUpdates: Array<{
          id: string;
          status: string;
          sent_at?: string;
          whatsapp_message_id?: string;
          error_message?: string;
        }> = [];

        if (apiRecipients.length === 0) {
          // No phone numbers in this batch — mark all as failed.
          for (const recipient of batch) {
            failedCount++;
            recipientUpdates.push({
              id: recipient.id,
              status: 'failed',
              error_message: 'No phone number on contact',
            });
          }
        } else {
          try {
            const res = await fetch('/api/whatsapp/broadcast', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                recipients: apiRecipients,
                template_name: payload.template.name,
                template_language: payload.template.language ?? 'en_US',
              }),
            });

            const data = await res.json();

            if (!res.ok) {
              throw new Error(
                (data as { error?: string }).error ?? 'Broadcast API request failed',
              );
            }

            const resultsByPhone = new Map<string, BroadcastApiResult>();
            for (const r of (data.results ?? []) as BroadcastApiResult[]) {
              resultsByPhone.set(r.phone, r);
            }

            for (const recipient of batch) {
              const phone = recipient.contact?.phone;
              const result = phone ? resultsByPhone.get(phone) : undefined;

              if (!result) {
                failedCount++;
                recipientUpdates.push({
                  id: recipient.id,
                  status: 'failed',
                  error_message: 'No phone number on contact',
                });
                continue;
              }

              if (result.status === 'sent') {
                recipientUpdates.push({
                  id: recipient.id,
                  status: 'sent',
                  sent_at: new Date().toISOString(),
                  whatsapp_message_id: result.whatsapp_message_id ?? undefined,
                  error_message: undefined,
                });
              } else {
                failedCount++;
                recipientUpdates.push({
                  id: recipient.id,
                  status: 'failed',
                  error_message: result.error ?? 'Unknown error',
                });
              }
            }
          } catch (err) {
            for (const recipient of batch) {
              failedCount++;
              recipientUpdates.push({
                id: recipient.id,
                status: 'failed',
                error_message: err instanceof Error ? err.message : 'Unknown error',
              });
            }
          }
        }

        // Persist recipient status updates for this batch.
        if (recipientUpdates.length > 0) {
          await fetch(`/api/broadcasts/${broadcastId}/recipients`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updates: recipientUpdates }),
          });
        }

        const progressPct =
          30 + Math.round(((i + batch.length) / totalRecipients) * 60);
        setProgress(progressPct);

        if (i + SEND_BATCH_SIZE < recipients.length) {
          await sleep(SEND_BATCH_DELAY_MS);
        }
      }

      // ── Finalize broadcast status ─────────────────────────────
      setProgress(95);
      const finalStatus = failedCount === totalRecipients ? 'failed' : 'sent';
      await fetch(`/api/broadcasts/${broadcastId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: finalStatus }),
      });

      setProgress(100);
      return broadcastId;
    } finally {
      setIsProcessing(false);
    }
  }

  return { createAndSendBroadcast, isProcessing, progress };
}
