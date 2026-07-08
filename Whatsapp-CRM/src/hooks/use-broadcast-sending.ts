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
  csvContacts?: { phone: string; name?: string }[];
  contactIds?: string[];
  excludeTagIds?: string[];
}

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
          (err as { error?: string }).error ?? `Failed to create broadcast (${setupRes.status})`,
        );
      }

      const setup = (await setupRes.json()) as BroadcastSetupResult;
      const { broadcastId } = setup;
      setProgress(50);

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
