"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { signOut } from "next-auth/react";

/** Minutes of inactivity before the warning dialog appears. */
const IDLE_MINUTES = 30;
const IDLE_MS = IDLE_MINUTES * 60 * 1000;

/** Seconds the warning countdown shows before auto-logout. */
const WARN_SECONDS = 60;

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "click",
] as const;

export interface InactivityLogoutState {
  showWarning: boolean;
  secondsLeft: number;
  /** Call this when the user clicks "Stay logged in". */
  stayLoggedIn: () => void;
  /** Call this when the user clicks "Log out now". */
  logoutNow: () => void;
}

export function useInactivityLogout(): InactivityLogoutState {
  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(WARN_SECONDS);

  // Refs so event callbacks never capture stale values
  const showWarningRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const secondsRef = useRef(WARN_SECONDS);

  const stopTimers = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  const startIdleTimer = useCallback(() => {
    stopTimers();
    showWarningRef.current = false;
    setShowWarning(false);

    idleTimerRef.current = setTimeout(() => {
      // User has been idle — show warning and start countdown
      showWarningRef.current = true;
      setShowWarning(true);
      secondsRef.current = WARN_SECONDS;
      setSecondsLeft(WARN_SECONDS);

      countdownRef.current = setInterval(() => {
        secondsRef.current -= 1;
        setSecondsLeft(secondsRef.current);
        if (secondsRef.current <= 0) {
          stopTimers();
          void signOut({ callbackUrl: "/login" });
        }
      }, 1_000);
    }, IDLE_MS);
  }, [stopTimers]);

  const stayLoggedIn = useCallback(() => {
    startIdleTimer();
  }, [startIdleTimer]);

  const logoutNow = useCallback(() => {
    stopTimers();
    void signOut({ callbackUrl: "/login" });
  }, [stopTimers]);

  useEffect(() => {
    const onActivity = () => {
      // Don't reset during the warning phase — the user must explicitly click
      // "Stay logged in", not just accidentally move the mouse.
      if (!showWarningRef.current) {
        startIdleTimer();
      }
    };

    ACTIVITY_EVENTS.forEach((e) =>
      window.addEventListener(e, onActivity, { passive: true }),
    );
    startIdleTimer();

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      stopTimers();
    };
    // startIdleTimer / stopTimers are stable (useCallback with stable deps)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { showWarning, secondsLeft, stayLoggedIn, logoutNow };
}
