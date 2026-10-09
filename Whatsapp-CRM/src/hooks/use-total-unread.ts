"use client";

import { useEffect, useRef, useState } from "react";
import { everyWhileVisible } from "@/lib/visible-interval";

const POLL_INTERVAL_MS = 30_000;

/**
 * Count of conversations with at least one unread inbound message for
 * the current user. Polls /api/conversations/unread every 30 seconds.
 * Never starts a new request while the previous one is still in-flight
 * to avoid request pileup when the server is slow.
 */
export function useTotalUnread(): number {
  const [total, setTotal] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchUnread() {
      // Skip if a request is already in-flight — prevents queue buildup
      if (cancelled || inFlightRef.current) return;
      inFlightRef.current = true;

      // Cancel any lingering request (defensive)
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/conversations/unread", {
          signal: controller.signal,
        });
        if (!res.ok || cancelled) return;
        const json = await res.json() as { total?: number };
        if (!cancelled) setTotal(json.total ?? 0);
      } catch {
        // Fetch aborted or network error — ignore.
      } finally {
        inFlightRef.current = false;
      }
    }

    void fetchUnread();
    // The badge is only seen on screen, so this rests while the tab is
    // hidden and refreshes the moment it is shown again.
    const stop = everyWhileVisible(() => void fetchUnread(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      abortRef.current?.abort();
      stop();
    };
  }, []);

  return total;
}
