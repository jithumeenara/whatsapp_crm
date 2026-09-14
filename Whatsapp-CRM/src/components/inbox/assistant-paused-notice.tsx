"use client";

/**
 * Says when the assistant is being held back on this conversation.
 *
 * It pauses on exactly one thing: the thread being assigned to a person,
 * who is expected to answer it. That is worth stating where the replying
 * happens — an agent who does not realise a thread is theirs alone can
 * leave a customer waiting on an assistant that was never going to
 * answer. The reason otherwise exists only as a line in the server log.
 *
 * Deliberately silent when the assistant would not have answered anyway
 * — switched off, pausing switched off, or a channel it does not serve.
 * A notice that appears when nothing is wrong teaches people to ignore
 * it.
 */

import { useEffect, useState } from "react";
import { PauseCircle } from "lucide-react";

interface AssistantPausedNoticeProps {
  assignedAgentId: string | null | undefined;
  /** Names the agent, so the sentence says who rather than "someone". */
  assignedAgentName?: string | null;
  channel?: string;
}

export function AssistantPausedNotice({
  assignedAgentId,
  assignedAgentName,
  channel,
}: AssistantPausedNoticeProps) {
  const [autoReplyOn, setAutoReplyOn] = useState(false);
  const [pauseOnAgent, setPauseOnAgent] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/ai-config");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        setAutoReplyOn(!!data.ai_auto_reply_enabled);
        setPauseOnAgent(data.ai_auto_reply_pause_on_agent !== false);
      } catch {
        /* the thread works without this notice */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Only WhatsApp is wired for auto-replies today, so on any other
  // channel this would be explaining a pause that is not the cause.
  if (channel && channel !== "whatsapp") return null;
  if (!autoReplyOn || !pauseOnAgent || !assignedAgentId) return null;

  return (
    <div className="flex items-start gap-2 border-t border-amber-100 bg-amber-50/80 px-3 py-2 sm:px-4">
      <PauseCircle className="mt-[1px] h-3.5 w-3.5 shrink-0 text-amber-600" />
      <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-amber-900">
        The assistant is not replying here —{" "}
        {assignedAgentName ? (
          <>
            this conversation is assigned to{" "}
            <span className="font-semibold">{assignedAgentName}</span>
          </>
        ) : (
          "this conversation is assigned to an agent"
        )}
        . Unassign it to let the assistant answer again.
      </p>
    </div>
  );
}
