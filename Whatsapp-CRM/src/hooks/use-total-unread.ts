"use client";

import { useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 10_000;

/**
 * Count of conversations with at least one unread inbound message for
 * the current user. Polls /api/conversations/unread every 10 seconds
 * so the sidebar badge stays roughly up-to-date without requiring a
 * Supabase realtime channel.
 */
export function useTotalUnread(): number {
  const [total, setTotal] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchUnread() {
      if (cancelled) return;
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch("/api/conversations/unread", {
          signal: controller.signal,
        });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled) setTotal(json.total ?? 0);
      } catch {
        // Fetch aborted or network error — ignore.
      }
    }

    // Immediate first fetch, then poll.
    void fetchUnread();
    const timer = setInterval(fetchUnread, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      abortRef.current?.abort();
      clearInterval(timer);
    };
  }, []);

  return total;
}
