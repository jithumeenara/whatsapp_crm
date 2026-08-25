'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Contact } from '@/types';

// Re-export from the server-safe shared util so existing callers don't break.
export type { VariableMapping } from '@/lib/broadcasts/resolve-variables';
export { resolveVariables } from '@/lib/broadcasts/resolve-variables';
import type { VariableMapping } from '@/lib/broadcasts/resolve-variables';

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv' | 'contacts';
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string; tagNames?: string[]; company?: string; customFields?: Record<string, string> }[];
  contactIds?: string[];
  excludeTagIds?: string[];
}

export interface BroadcastSchedule {
  type: 'now' | 'once' | 'recurring';
  /** ISO datetime -- required for 'once'/'recurring'. */
  scheduledAt?: string;
  intervalValue?: number;
  intervalUnit?: 'minutes' | 'hours' | 'days';
  maxSends?: number;
}

interface BroadcastPayload {
  name: string;
  template: { name: string; language?: string };
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
  /** Campaign-level override for a media-header template's image/video/document. */
  headerMediaUrl?: string;
  /** Defaults to send-now (unchanged behavior) when omitted. */
  schedule?: BroadcastSchedule;
}

interface UseBroadcastSendingReturn {
  createAndSendBroadcast: (payload: BroadcastPayload) => Promise<string>;
  isProcessing: boolean;
  progress: number;
}

// Shape returned by POST /api/broadcasts
interface BroadcastSetupResult {
  broadcastId: string;
  scheduled?: boolean;
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

// Suppress "unused import" — Contact is referenced by AudienceConfig callers
void (null as unknown as Contact);

export function useBroadcastSending(): UseBroadcastSendingReturn {
  const { accountId } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function createAndSendBroadcast(payload: BroadcastPayload): Promise<string> {
    setIsProcessing(true);
    setProgress(10);

    if (!accountId) throw new Error('Your profile is not linked to an account.');

    try {
      const schedule = payload.schedule;
      const setupRes = await fetch('/api/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: payload.name,
          template_name: payload.template.name,
          template_language: payload.template.language ?? 'en_US',
          variables: payload.variables,
          audience: payload.audience,
          header_media_url: payload.headerMediaUrl,
          schedule_type: schedule?.type ?? 'now',
          scheduled_at: schedule?.scheduledAt,
          interval_value: schedule?.intervalValue,
          interval_unit: schedule?.intervalUnit,
          max_sends: schedule?.maxSends,
        }),
      });

      if (!setupRes.ok) {
        const err = await setupRes.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error ?? `Failed to create broadcast (${setupRes.status})`,
        );
      }

      const setup = (await setupRes.json()) as BroadcastSetupResult;
      const { broadcastId } = setup;
      setProgress(50);

      if (setup.scheduled) {
        // Left for the server-side sweep (src/lib/broadcasts/sweep.ts) to
        // pick up at next_send_at -- nothing to kick off right now.
        setProgress(100);
        return broadcastId;
      }

      // Fire-and-forget on the server; returns 202 immediately so
      // sending continues even if the browser tab is closed.
      const processRes = await fetch(`/api/broadcasts/${broadcastId}/process`, {
        method: 'POST',
      });
      if (!processRes.ok) {
        const err = await processRes.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? 'Failed to start sending');
      }

      setProgress(100);
      return broadcastId;
    } finally {
      setIsProcessing(false);
    }
  }

  return { createAndSendBroadcast, isProcessing, progress };
}
