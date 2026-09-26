"use client";

import { useEffect, useRef, useState } from "react";
import { CornerUpLeft, Loader2, Mail, PenSquare, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmailReplyTarget {
  id: string;
  subject: string | null;
  preview: string;
}

export interface EmailDraft {
  mode: "reply" | "new";
  subject: string;
  text: string;
  replyToId: string | null;
}

const MAX_SUBJECT = 250;

function stripRe(subject: string): string {
  let s = subject.trim();
  for (;;) {
    const next = s.replace(/^(re|fw|fwd|aw|wg)\s*:\s*/i, "");
    if (next === s) return s;
    s = next;
  }
}

/**
 * The email reply box: Reply keeps the customer's thread and subject;
 * New email starts a separate one with a subject of its own — the two
 * choices HubSpot, Front and respond.io all put side by side. Plain text
 * only, which is also what keeps anything typed here from becoming
 * markup in someone's mail client.
 */
export function EmailComposer({
  contactEmail, latestSubject, target, onClearTarget, onSend,
}: {
  contactEmail: string | null;
  latestSubject: string | null;
  /** The customer email being answered; null means their latest. */
  target: EmailReplyTarget | null;
  onClearTarget: () => void;
  onSend: (draft: EmailDraft) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"reply" | "new">("reply");
  const [newSubject, setNewSubject] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Choosing a particular email to answer means replying to it.
  const activeMode: "reply" | "new" = target ? "reply" : mode;
  useEffect(() => {
    if (target) bodyRef.current?.focus();
  }, [target]);

  const replyBase = target?.subject ?? latestSubject;
  const replySubject = replyBase ? `Re: ${stripRe(replyBase)}` : "Re: (no subject)";
  const canSend =
    !sending && text.trim().length > 0 && (activeMode === "reply" || newSubject.trim().length > 0) && !!contactEmail;

  async function send() {
    if (!canSend) return;
    setSending(true);
    const ok = await onSend({
      mode: activeMode,
      subject: activeMode === "new" ? newSubject.trim() : "",
      text: text.trim(),
      replyToId: activeMode === "reply" ? target?.id ?? null : null,
    });
    setSending(false);
    if (ok) {
      setText("");
      if (activeMode === "new") {
        setNewSubject("");
        setMode("reply");
      }
      onClearTarget();
    }
  }

  return (
    <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-3 sm:px-4">
      <div className="mx-auto max-w-3xl overflow-hidden rounded-xl border border-slate-200 shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15">
        {/* Reply / New email */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-2">
          <div className="flex rounded-lg bg-slate-200/60 p-0.5" role="group" aria-label="Email type">
            {([
              ["reply", "Reply", CornerUpLeft],
              ["new", "New email", PenSquare],
            ] as const).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                aria-pressed={activeMode === value}
                onClick={() => {
                  if (value === "new") onClearTarget();
                  setMode(value);
                }}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-semibold transition-colors",
                  activeMode === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
          <span className="ml-auto flex min-w-0 items-center gap-1.5 text-[12px] text-slate-500">
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <span className="shrink-0">To</span>
            <span className="truncate font-medium text-slate-700">{contactEmail ?? "no email address"}</span>
          </span>
        </div>

        {/* Subject */}
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
          <label htmlFor="email-subject" className="shrink-0 text-[12px] font-medium text-slate-500">Subject</label>
          {activeMode === "reply" ? (
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-800" title="Replies keep the subject, so they stay in the same thread">
              {replySubject}
            </span>
          ) : (
            <input
              id="email-subject"
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value.replace(/[\r\n]+/g, " ").slice(0, MAX_SUBJECT))}
              placeholder="What is this email about?"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-slate-800 outline-none placeholder:font-normal placeholder:text-slate-400"
            />
          )}
        </div>

        {activeMode === "reply" && target && (
          <div className="flex items-center gap-2 border-b border-slate-100 bg-primary/5 px-3 py-1.5 text-[12px] text-slate-600">
            <CornerUpLeft className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate">Replying to: {target.preview}</span>
            <button type="button" onClick={onClearTarget} aria-label="Reply to their latest email instead"
              className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Body */}
        <label htmlFor="email-body" className="sr-only">Email</label>
        <textarea
          id="email-body"
          ref={bodyRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void send();
            }
          }}
          rows={4}
          maxLength={50_000}
          placeholder={activeMode === "reply" ? "Write your reply…" : "Write your email…"}
          className="block max-h-72 min-h-[96px] w-full resize-y px-3 py-2.5 text-[14px] leading-relaxed text-slate-800 outline-none placeholder:text-slate-400"
        />

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
          <span className="hidden text-[11px] text-slate-400 sm:inline">Ctrl + Enter to send</span>
          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            className="ml-auto inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {activeMode === "reply" ? "Send reply" : "Send email"}
          </button>
        </div>
      </div>
    </div>
  );
}
