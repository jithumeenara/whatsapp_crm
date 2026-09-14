"use client";

/**
 * The ringing screen an agent sees when a call is transferred to them.
 *
 * Centre of the screen, over everything, because it expires. Every other
 * notification in this app can be read late; this one is a person
 * holding a phone to their ear, and a banner in a corner that is noticed
 * forty seconds later is the same as no banner at all.
 *
 * It is mounted once in the dashboard shell rather than per page, so a
 * call does not stop ringing because the agent happened to navigate.
 *
 * What it deliberately does not do is play a sound on its own. Browsers
 * block audio that no gesture asked for, and a ring that silently fails
 * to play is worse than no ring — the agent would learn to trust it.
 * It asks for permission to make noise the first time an agent accepts a
 * call, when a gesture is available to authorise it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { PhoneIncoming, PhoneOff, Phone, Bot, Loader2 } from "lucide-react";
import { useRealtime } from "@/hooks/use-realtime";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

export interface IncomingCallEvent {
  callId: string;
  /** Who the call is for. Ignored when it is not this agent. */
  agentId: string | null;
  callerName: string | null;
  callerNumber: string | null;
  conversationId: string | null;
  /** Set when the assistant handled it first and is passing it on. */
  transferredFromAi?: boolean;
  transferReason?: string | null;
  /** Seconds before it gives up, from the account's call settings. */
  ringSeconds?: number;
}

export function IncomingCallPopup() {
  const { userId } = useAuth();
  const [call, setCall] = useState<IncomingCallEvent | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [acting, setActing] = useState<"accept" | "decline" | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const dismiss = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setCall(null);
    setActing(null);
  }, []);

  // The countdown mirrors the server's own ring timeout. It is shown
  // rather than kept internal because an agent deciding whether to run
  // for a quiet room needs to know if they have twenty seconds or three.
  useEffect(() => {
    if (!call) return;
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          dismiss();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [call, dismiss]);

  useRealtime({
    channelName: "incoming-calls",
    onCallEvent: (event: IncomingCallEvent & { type?: string }) => {
      if (event.type === "ended" || event.type === "cancelled") {
        // Only clear the popup if it is this call that ended — another
        // call ending must not silence the one still ringing.
        setCall((current) => (current && current.callId === event.callId ? null : current));
        return;
      }
      // A transfer names its agent. An unassigned call rings everyone,
      // which is deliberate: better two people answer than nobody.
      //
      // `userId` is only trusted once it is known. useAuth resolves
      // asynchronously and a socket event can arrive first, and while it
      // is null every call reads as "not for me" — which silently threw
      // away a ringing phone and looked precisely like the feature being
      // broken. Ringing when unsure is the same trade this component
      // already makes everywhere else, and the server settles the claim.
      if (userId && event.agentId && event.agentId !== userId) return;
      setCall(event);
      // Set alongside the call rather than from an effect reacting to
      // it: the countdown is a property of this call arriving, and
      // deriving it a render later is how a ring starts at the wrong
      // number.
      setSecondsLeft(event.ringSeconds ?? 30);
    },
  });

  const respond = useCallback(
    async (action: "accept" | "decline") => {
      if (!call || acting) return;
      setActing(action);
      try {
        const res = await fetch(`/api/calls/${call.callId}/respond`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          toast.error(data?.error ?? `Could not ${action} the call`);
          setActing(null);
          return;
        }
        if (action === "accept" && data?.join_url) {
          // Opened rather than navigated to: the agent keeps whatever
          // they were doing, and the call is its own window.
          window.open(data.join_url, "_blank", "noopener,width=420,height=640");
        }
        dismiss();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `Could not ${action} the call`);
        setActing(null);
      }
    },
    [call, acting, dismiss],
  );

  if (!call) return null;

  const who = call.callerName || call.callerNumber || "Unknown number";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Incoming call from ${who}`}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-[340px] overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex flex-col items-center px-6 pb-5 pt-8 text-center">
          <span className="relative grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/30" />
            <PhoneIncoming className="relative h-7 w-7" />
          </span>

          <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {call.transferredFromAi ? "Transferred from the assistant" : "Incoming call"}
          </p>
          <p className="mt-1 max-w-full truncate text-[19px] font-semibold text-slate-900">{who}</p>
          {call.callerName && call.callerNumber && (
            <p className="mt-0.5 text-[12.5px] tabular-nums text-slate-500">{call.callerNumber}</p>
          )}

          {call.transferredFromAi && call.transferReason && (
            <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-indigo-50/70 px-3 py-2 text-left text-[11.5px] leading-relaxed text-indigo-900">
              <Bot className="mt-[1px] h-3.5 w-3.5 shrink-0" />
              <span>{call.transferReason}</span>
            </p>
          )}

          <p className="mt-3 text-[11.5px] tabular-nums text-slate-400">
            Ringing · {secondsLeft}s
          </p>
        </div>

        <div className="flex gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-4">
          <button
            type="button"
            onClick={() => void respond("decline")}
            disabled={acting !== null}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white py-2.5 text-[13px] font-semibold text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-100 disabled:opacity-60"
          >
            {acting === "decline" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PhoneOff className="h-4 w-4" />
            )}
            Decline
          </button>
          <button
            type="button"
            onClick={() => void respond("accept")}
            disabled={acting !== null}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
          >
            {acting === "accept" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Phone className="h-4 w-4" />
            )}
            Answer
          </button>
        </div>
      </div>
    </div>
  );
}
