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
  type: 'all' | 'tags' | 'custom_field' | 'csv' | 'contacts';
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  /** Manually picked contact IDs (used when type === 'contacts') */
  contactIds?: string[];
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
  const { accountId } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function createAndSendBroadcast(payload: BroadcastPayload): Promise<string> {
    setIsProcessing(true);
    setProgress(10);

    if (!accountId) throw new Error('Your profile is not linked to an account.');

    try {
      // ── Step 1: Create broadcast + resolve audience (server-side) ──
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

      // ── Step 2: Kick off server-side background processing ──
      // Returns 202 immediately; sending continues on the server
      // even if the browser tab is closed.
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
