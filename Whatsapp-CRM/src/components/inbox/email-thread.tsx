"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Check, CheckCheck, ChevronDown, Clock, CornerUpLeft, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { splitQuoted } from "@/lib/email/quote";
import type { Message } from "@/types";

/**
 * An email conversation, shown as email rather than chat.
 *
 * Each email is a full-width card with who, when and the subject, like
 * Gmail, Outlook, Front and HubSpot's inbox: long bodies and quoted
 * history are not what chat bubbles are for. The quoted history each
 * mail client appends is folded under "···", and all but the latest few
 * emails collapse to one line so a long thread stays readable.
 */

const OPEN_BY_DEFAULT = 3;

function when(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
    : d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
}

function StatusIcon({ status }: { status: Message["status"] }) {
  if (status === "sending") return <Clock className="h-3.5 w-3.5 text-slate-400" aria-label="Sending" />;
  if (status === "failed") return <AlertCircle className="h-3.5 w-3.5 text-rose-500" aria-label="Failed" />;
  if (status === "read") return <CheckCheck className="h-3.5 w-3.5 text-sky-500" aria-label="Read" />;
  if (status === "delivered") return <CheckCheck className="h-3.5 w-3.5 text-slate-400" aria-label="Delivered" />;
  return <Check className="h-3.5 w-3.5 text-slate-400" aria-label="Sent" />;
}

function EmailCard({
  message, fromLabel, fromDetail, open, onToggle, onReply,
}: {
  message: Message;
  fromLabel: string;
  fromDetail: string;
  open: boolean;
  onToggle: () => void;
  onReply?: () => void;
}) {
  const [showQuoted, setShowQuoted] = useState(false);
  const outgoing = message.sender_type !== "customer";
  const text = message.content_text ?? "";
  const { main, quoted } = useMemo(() => splitQuoted(text), [text]);
  const initial = (fromLabel || "?").trim().charAt(0).toUpperCase();

  if (message.deleted_at) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-3 text-[12px] italic text-slate-400">
        This email was deleted
      </div>
    );
  }

  return (
    <article
      className={cn(
        "rounded-xl border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow",
        outgoing ? "border-primary/25" : "border-slate-200",
        open && "shadow-[0_2px_10px_rgba(15,23,42,0.06)]",
      )}
    >
      {/* Header — also the fold toggle, like a mail client */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold",
            outgoing ? "bg-primary/15 text-primary" : "bg-indigo-100 text-indigo-600",
          )}
          aria-hidden="true"
        >
          {initial}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[13px] font-semibold text-slate-900">{fromLabel}</span>
            <span className="truncate text-[12px] text-slate-500">{fromDetail}</span>
          </span>
          {open ? (
            message.email_subject && (
              <span className="mt-0.5 block text-[15px] font-semibold leading-snug text-slate-800">{message.email_subject}</span>
            )
          ) : (
            <span className="mt-0.5 block truncate text-[12px] text-slate-500">
              {message.email_subject ? <b className="font-medium text-slate-700">{message.email_subject} — </b> : null}
              {main.replace(/\s+/g, " ").slice(0, 140)}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-[11px] text-slate-400">
          {outgoing && <StatusIcon status={message.status} />}
          {when(message.created_at)}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 pl-16">
          <div className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-slate-800">{main}</div>

          {quoted && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowQuoted((v) => !v)}
                aria-expanded={showQuoted}
                title={showQuoted ? "Hide earlier messages" : "Show earlier messages"}
                className="inline-flex h-6 items-center rounded-md bg-slate-100 px-2 text-slate-500 hover:bg-slate-200"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {showQuoted && (
                <div className="mt-2 whitespace-pre-wrap break-words border-l-2 border-slate-200 pl-3 text-[13px] leading-relaxed text-slate-500">
                  {quoted}
                </div>
              )}
            </div>
          )}

          {message.status === "failed" && (
            <p className="mt-3 flex items-center gap-1.5 text-[12px] text-rose-600">
              <AlertCircle className="h-3.5 w-3.5" /> Not sent. Check the mailbox connection in Settings and try again.
            </p>
          )}

          {!outgoing && onReply && (
            <div className="mt-4">
              <button
                type="button"
                onClick={onReply}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
              >
                <CornerUpLeft className="h-3.5 w-3.5" /> Reply
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export function EmailThread({
  messages, contactName, contactEmail, agentLabelFor, onReply,
}: {
  messages: Message[];
  contactName: string;
  contactEmail: string | null;
  agentLabelFor: (m: Message) => string;
  onReply: (m: Message) => void;
}) {
  const ordered = useMemo(
    () => [...messages].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [messages],
  );
  // Which cards the person opened or closed themselves; everything else
  // follows the default (the latest few open).
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [showOlder, setShowOlder] = useState(false);

  const HIDE_BEYOND = 6;
  const hiddenCount = !showOlder && ordered.length > HIDE_BEYOND ? ordered.length - HIDE_BEYOND : 0;
  const visible = ordered.slice(hiddenCount);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2.5">
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowOlder(true)}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-white/70 py-2 text-[12px] font-medium text-slate-600 hover:bg-white"
        >
          <ChevronDown className="h-3.5 w-3.5" /> {hiddenCount} earlier email{hiddenCount === 1 ? "" : "s"}
        </button>
      )}
      {visible.map((m, i) => {
        const defaultOpen = i >= visible.length - OPEN_BY_DEFAULT;
        const open = toggled[m.id] ?? defaultOpen;
        const outgoing = m.sender_type !== "customer";
        const fromLabel = outgoing
          ? m.sender_type === "bot" ? "Chatbot" : agentLabelFor(m)
          : contactName;
        const fromDetail = outgoing
          ? `to ${contactEmail ?? contactName}`
          : contactEmail && contactEmail !== contactName ? `<${contactEmail}>` : "";
        return (
          <EmailCard
            key={m.id}
            message={m}
            fromLabel={fromLabel}
            fromDetail={fromDetail}
            open={open}
            onToggle={() => setToggled((t) => ({ ...t, [m.id]: !open }))}
            onReply={outgoing ? undefined : () => onReply(m)}
          />
        );
      })}
    </div>
  );
}
