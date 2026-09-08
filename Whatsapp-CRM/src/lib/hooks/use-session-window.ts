"use client";

import { useMemo } from "react";
import { differenceInHours } from "date-fns";

/** The minimum message shape both callers of this hook already have. */
export interface SessionWindowMessage {
  sender_type: string;
  created_at: string;
}

export interface SessionWindowInfo {
  expired: boolean;
  /** "" until there's a customer message at all, "Expired", or "Xh remaining" / "Xm remaining". */
  remaining: string;
}

/**
 * WhatsApp's 24-hour customer-service session window — free-form replies
 * are only allowed within 24h of the customer's last message; outside that
 * window a template is required. This calculation used to be duplicated
 * verbatim in message-thread.tsx (the main Inbox) and leads/[id]/page.tsx
 * (the Lead detail composer) — factored out here so both stay in sync and
 * so the new 72-hour Free Entry Point badge (useFepWindow, same file) has
 * one shared home to sit next to.
 */
export function useSessionWindow(messages: SessionWindowMessage[]): SessionWindowInfo {
  return useMemo(() => {
    if (!messages.length) return { expired: false, remaining: "" };

    const lastCustomerMsg = [...messages].reverse().find((m) => m.sender_type === "customer");
    if (!lastCustomerMsg) return { expired: false, remaining: "" };

    const hoursSince = differenceInHours(new Date(), new Date(lastCustomerMsg.created_at));
    const expired = hoursSince >= 24;
    if (expired) return { expired: true, remaining: "Expired" };

    const hoursLeft = 24 - hoursSince;
    const remaining =
      hoursLeft >= 1 ? `${Math.floor(hoursLeft)}h remaining` : `${Math.floor(hoursLeft * 60)}m remaining`;

    return { expired, remaining };
  }, [messages]);
}

export interface FepWindowInfo {
  /** True only while the 72-hour Free Entry Point window is open. */
  active: boolean;
  /** "Xh left" / "Xm left" while active, "" otherwise. */
  remaining: string;
}

/**
 * Meta's 72-hour Free Entry Point window — distinct from the 24h session
 * window above. Granted when a conversation originates from an ad/referral
 * surface (Click-to-WhatsApp, Click-to-Instagram) and the business replies
 * within the first 24h; for the following 72h from that reply, even
 * TEMPLATE messages are billed free, not just session messages. Purely
 * informational in this pass — see fep_expires_at on the Conversation model.
 */
export function useFepWindow(fepExpiresAt: string | null | undefined): FepWindowInfo {
  return useMemo(() => {
    if (!fepExpiresAt) return { active: false, remaining: "" };
    const msLeft = new Date(fepExpiresAt).getTime() - new Date().getTime();
    if (msLeft <= 0) return { active: false, remaining: "" };

    const hoursLeft = msLeft / 3_600_000;
    const remaining = hoursLeft >= 1 ? `${Math.floor(hoursLeft)}h left` : `${Math.floor(hoursLeft * 60)}m left`;
    return { active: true, remaining };
  }, [fepExpiresAt]);
}
