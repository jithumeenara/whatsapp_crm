"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Bold, CalendarClock, CornerUpLeft, Forward, Italic, Languages, List, ListOrdered, Loader2, Mail, Paperclip,
  PenSquare, ReplyAll, Send, ShoppingBag, Sparkles, Underline, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EmojiPickerPopover } from "./emoji-picker-popover";
import { FileManagerPicker } from "./file-manager-picker";

export type EmailComposeMode = "reply" | "reply_all" | "new" | "forward";

export interface EmailReplyTarget {
  id: string;
  subject: string | null;
  preview: string;
  action: "reply" | "reply_all" | "forward";
}

export interface EmailDraftFile {
  id: string;
  name: string;
  size: number;
  url: string;
  mime: string;
}

export interface EmailDraft {
  mode: EmailComposeMode;
  subject: string;
  text: string;
  replyToId: string | null;
  cc: string;
  bcc: string;
  forwardTo: string;
  files: EmailDraftFile[];
  signature: boolean;
}

const MAX_SUBJECT = 250;
const MAX_FILES = 5;
const MAX_FILE_BYTES = 3 * 1024 * 1024 - 1;
const TRANSLATE_TARGETS = ["Malayalam", "English", "Tamil", "Hindi", "Kannada", "Telugu", "Arabic"];

function stripRe(subject: string): string {
  let s = subject.trim();
  for (;;) {
    const next = s.replace(/^(re|fw|fwd|aw|wg)\s*:\s*/i, "");
    if (next === s) return s;
    s = next;
  }
}

interface SavedDraft {
  mode: "reply" | "new";
  subject: string;
  text: string;
  cc: string;
  bcc: string;
  showCc: boolean;
}

const draftKey = (conversationId: string) => `email-draft:v1:${conversationId}`;

/** This person's unsent draft for this conversation, kept in their own
 *  browser only. Missing or unreadable is simply "no draft". */
function loadDraft(conversationId: string): SavedDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(draftKey(conversationId));
    return raw ? (JSON.parse(raw) as SavedDraft) : null;
  } catch {
    return null;
  }
}

function ToolButton({
  label, onClick, children, active, disabled,
}: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40",
        active && "bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The email box. Reply keeps the customer's thread; Reply all and
 * Forward act on the email chosen in the thread; New email starts a
 * separate one with a subject of its own — the choices HubSpot, Front
 * and respond.io all put side by side.
 *
 * Formatting is the light markup in lib/email/markup.ts, which is the
 * only thing that ever becomes tags: nothing typed or pasted here can
 * turn into markup in someone's mail client.
 */
export function EmailComposer({
  conversationId, contactEmail, contactLanguage, latestSubject, target, onClearTarget, onSend,
}: {
  conversationId: string;
  contactEmail: string | null;
  contactLanguage?: string | null;
  latestSubject: string | null;
  /** The customer email being answered or forwarded; null means their latest. */
  target: EmailReplyTarget | null;
  onClearTarget: () => void;
  onSend: (draft: EmailDraft) => Promise<boolean>;
}) {
  const [saved] = useState(() => loadDraft(conversationId));
  const [mode, setMode] = useState<"reply" | "new">(saved?.mode ?? "reply");
  const [newSubject, setNewSubject] = useState(saved?.subject ?? "");
  const [text, setText] = useState(saved?.text ?? "");
  const [cc, setCc] = useState(saved?.cc ?? "");
  const [bcc, setBcc] = useState(saved?.bcc ?? "");
  const [showCc, setShowCc] = useState(saved?.showCc ?? false);
  const [forwardTo, setForwardTo] = useState("");
  const [files, setFiles] = useState<EmailDraftFile[]>([]);
  const [signature, setSignature] = useState(true);
  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menu, setMenu] = useState<null | "translate" | "catalog" | "schedule">(null);
  const [drafting, setDrafting] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [products, setProducts] = useState<Array<{ id: string; name: string; price: number | null; currency: string | null }>>([]);
  const [productQuery, setProductQuery] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // What the reply box is doing: an action picked on an email wins.
  const activeMode: EmailComposeMode = target ? target.action : mode;

  useEffect(() => {
    if (target) bodyRef.current?.focus();
  }, [target]);

  // Keep the unsent draft, per conversation, in this browser.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const empty = !text.trim() && !newSubject.trim() && !cc.trim() && !bcc.trim();
        if (empty) window.localStorage.removeItem(draftKey(conversationId));
        else window.localStorage.setItem(draftKey(conversationId), JSON.stringify({ mode, subject: newSubject, text, cc, bcc, showCc }));
      } catch { /* private window — nothing to keep */ }
    }, 400);
    return () => clearTimeout(t);
  }, [conversationId, mode, newSubject, text, cc, bcc, showCc]);

  // Click-away for the small menus.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu]);

  // Products for the catalog menu, as the person types.
  useEffect(() => {
    if (menu !== "catalog") return;
    let cancelled = false;
    const q = productQuery.trim();
    fetch(`/api/catalog/products${q ? `?search=${encodeURIComponent(q)}` : ""}`)
      .then((r) => (r.ok ? r.json() : { products: [] }))
      .then((d) => { if (!cancelled) setProducts(Array.isArray(d.products) ? d.products.slice(0, 20) : []); })
      .catch(() => { if (!cancelled) setProducts([]); });
    return () => { cancelled = true; };
  }, [menu, productQuery]);

  const replyBase = target?.subject ?? latestSubject;
  const shownSubject =
    activeMode === "forward"
      ? `Fwd: ${replyBase ? stripRe(replyBase) : "email"}`
      : replyBase ? `Re: ${stripRe(replyBase)}` : "Re: (no subject)";

  const canSend =
    !sending &&
    text.trim().length > 0 &&
    !!contactEmail &&
    (activeMode !== "new" || newSubject.trim().length > 0) &&
    (activeMode !== "forward" || forwardTo.trim().length > 0);

  // ── Editing helpers ─────────────────────────────────────────────────
  function replaceRange(start: number, end: number, insert: string, selectFrom: number, selectTo: number) {
    const next = text.slice(0, start) + insert + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      const el = bodyRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(selectFrom, selectTo);
    });
  }

  function wrap(marker: string) {
    const el = bodyRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const selected = text.slice(s, e);
    replaceRange(s, e, `${marker}${selected}${marker}`, s + marker.length, e + marker.length);
  }

  function listify(kind: "bullet" | "number") {
    const el = bodyRef.current;
    if (!el) return;
    const s = text.lastIndexOf("\n", el.selectionStart - 1) + 1;
    const endNl = text.indexOf("\n", el.selectionEnd);
    const e = endNl === -1 ? text.length : endNl;
    const lines = text.slice(s, e).split("\n");
    const isBullet = (l: string) => /^\s*[-•]\s+/.test(l);
    const isNumber = (l: string) => /^\s*\d{1,3}[.)]\s+/.test(l);
    const already = lines.every(kind === "bullet" ? isBullet : isNumber);
    const out = lines.map((l, i) => {
      const bare = l.replace(/^\s*(?:[-•]|\d{1,3}[.)])\s+/, "");
      if (already) return bare;
      return kind === "bullet" ? `- ${bare}` : `${i + 1}. ${bare}`;
    }).join("\n");
    replaceRange(s, e, out, s, s + out.length);
  }

  function insertAtCursor(snippet: string) {
    const el = bodyRef.current;
    const s = el?.selectionStart ?? text.length;
    const e = el?.selectionEnd ?? text.length;
    replaceRange(s, e, snippet, s + snippet.length, s + snippet.length);
  }

  // ── Tools ───────────────────────────────────────────────────────────
  async function draftWithAi() {
    if (drafting) return;
    setDrafting(true);
    try {
      const res = await fetch("/api/messages/ai-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not draft a reply");
      setText(String(data.draft ?? ""));
      bodyRef.current?.focus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not draft a reply");
    } finally {
      setDrafting(false);
    }
  }

  async function translate(language: string) {
    if (!text.trim() || translating) return;
    setMenu(null);
    setTranslating(true);
    try {
      const res = await fetch("/api/messages/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, target_language: language, romanized: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Translation failed");
      setText(String(data.translated_text ?? text));
      toast.success(`Translated to ${language}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Translation failed");
    } finally {
      setTranslating(false);
    }
  }

  function payload() {
    return {
      mode: activeMode,
      subject: activeMode === "new" ? newSubject.trim() : "",
      text: text.trim(),
      replyToId: activeMode === "new" ? null : target?.id ?? null,
      cc,
      bcc,
      forwardTo,
      files,
      signature,
    } satisfies EmailDraft;
  }

  function reset() {
    setText("");
    setCc("");
    setBcc("");
    setForwardTo("");
    setFiles([]);
    if (activeMode === "new") {
      setNewSubject("");
      setMode("reply");
    }
    onClearTarget();
    try { window.localStorage.removeItem(draftKey(conversationId)); } catch { /* nothing kept */ }
  }

  async function send() {
    if (!canSend) return;
    setSending(true);
    const ok = await onSend(payload());
    setSending(false);
    if (ok) reset();
  }

  async function schedule() {
    const when = new Date(scheduleAt);
    if (!scheduleAt || Number.isNaN(when.getTime())) { toast.error("Choose a date and time"); return; }
    if (!canSend) { toast.error("Finish the email first"); return; }
    const d = payload();
    const res = await fetch("/api/scheduled-messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: conversationId,
        content_text: d.text,
        scheduled_at: when.toISOString(),
        email_mode: d.mode,
        email_subject: d.subject || undefined,
        email_cc: d.cc,
        email_bcc: d.bcc,
        email_to: d.forwardTo,
        attachment_ids: d.files.map((f) => f.id),
        reply_to_message_id: d.replyToId ?? undefined,
        email_signature: d.signature,
        email_format: "rich",
      }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) { toast.error(data.error ?? "Could not schedule"); return; }
    toast.success(`Scheduled for ${when.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })}`);
    setMenu(null);
    setScheduleAt("");
    reset();
  }

  const translateTargets = [
    ...(contactLanguage?.trim() ? [contactLanguage.trim()] : []),
    ...TRANSLATE_TARGETS.filter((l) => l.toLowerCase() !== (contactLanguage ?? "").trim().toLowerCase()),
  ];
  const minSchedule = (() => {
    const d = new Date(Date.now() + 5 * 60_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();

  return (
    <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-3 sm:px-4">
      <div className="mx-auto max-w-3xl overflow-visible rounded-xl border border-slate-200 shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15">
        {/* Reply / New email, and who it goes to */}
        <div className="flex flex-wrap items-center gap-2 rounded-t-xl border-b border-slate-100 bg-slate-50/70 px-3 py-2">
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
                  onClearTarget();
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
          {(activeMode === "reply_all" || activeMode === "forward") && (
            <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-1 text-[12px] font-semibold text-indigo-700">
              {activeMode === "forward" ? <Forward className="h-3.5 w-3.5" /> : <ReplyAll className="h-3.5 w-3.5" />}
              {activeMode === "forward" ? "Forward" : "Reply all"}
            </span>
          )}
          <span className="ml-auto flex min-w-0 items-center gap-1.5 text-[12px] text-slate-500">
            {activeMode !== "forward" && (
              <>
                <Mail className="h-3.5 w-3.5 shrink-0" />
                <span className="shrink-0">To</span>
                <span className="truncate font-medium text-slate-700">
                  {contactEmail ?? "no email address"}
                  {activeMode === "reply_all" && " + everyone on that email"}
                </span>
              </>
            )}
            <button type="button" onClick={() => setShowCc((v) => !v)} className="shrink-0 font-medium text-indigo-600 hover:underline">
              Cc/Bcc
            </button>
          </span>
        </div>

        {activeMode === "forward" && (
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <label htmlFor="email-forward-to" className="w-12 shrink-0 text-[12px] font-medium text-slate-500">To</label>
            <input id="email-forward-to" value={forwardTo} onChange={(e) => setForwardTo(e.target.value)} autoComplete="off"
              placeholder="name@example.com, another@example.com"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-800 outline-none placeholder:text-slate-400" />
          </div>
        )}
        {showCc && (
          <>
            <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
              <label htmlFor="email-cc" className="w-12 shrink-0 text-[12px] font-medium text-slate-500">Cc</label>
              <input id="email-cc" value={cc} onChange={(e) => setCc(e.target.value)} autoComplete="off"
                placeholder="Copies, separated by commas"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-800 outline-none placeholder:text-slate-400" />
            </div>
            <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
              <label htmlFor="email-bcc" className="w-12 shrink-0 text-[12px] font-medium text-slate-500">Bcc</label>
              <input id="email-bcc" value={bcc} onChange={(e) => setBcc(e.target.value)} autoComplete="off"
                placeholder="Hidden copies"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-800 outline-none placeholder:text-slate-400" />
            </div>
          </>
        )}

        {/* Subject */}
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
          <label htmlFor="email-subject" className="w-12 shrink-0 text-[12px] font-medium text-slate-500">Subject</label>
          {activeMode === "new" ? (
            <input
              id="email-subject"
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value.replace(/[\r\n]+/g, " ").slice(0, MAX_SUBJECT))}
              placeholder="What is this email about?"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-slate-800 outline-none placeholder:font-normal placeholder:text-slate-400"
            />
          ) : (
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-800" title="Replies keep the subject, so they stay in the same thread">
              {shownSubject}
            </span>
          )}
        </div>

        {target && (
          <div className="flex items-center gap-2 border-b border-slate-100 bg-primary/5 px-3 py-1.5 text-[12px] text-slate-600">
            <CornerUpLeft className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate">
              {target.action === "forward" ? "Forwarding" : "Replying to"}: {target.preview}
            </span>
            <button type="button" onClick={onClearTarget} aria-label="Reply to their latest email instead"
              className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Formatting */}
        <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-100 px-2 py-1">
          <ToolButton label="Bold (Ctrl+B)" onClick={() => wrap("**")}><Bold className="h-4 w-4" /></ToolButton>
          <ToolButton label="Italic (Ctrl+I)" onClick={() => wrap("*")}><Italic className="h-4 w-4" /></ToolButton>
          <ToolButton label="Underline (Ctrl+U)" onClick={() => wrap("__")}><Underline className="h-4 w-4" /></ToolButton>
          <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />
          <ToolButton label="Bulleted list" onClick={() => listify("bullet")}><List className="h-4 w-4" /></ToolButton>
          <ToolButton label="Numbered list" onClick={() => listify("number")}><ListOrdered className="h-4 w-4" /></ToolButton>
        </div>

        {/* Body */}
        <label htmlFor="email-body" className="sr-only">Email</label>
        <textarea
          id="email-body"
          ref={bodyRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            const mod = e.ctrlKey || e.metaKey;
            if (mod && e.key === "Enter") { e.preventDefault(); void send(); }
            else if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); wrap("**"); }
            else if (mod && e.key.toLowerCase() === "i") { e.preventDefault(); wrap("*"); }
            else if (mod && e.key.toLowerCase() === "u") { e.preventDefault(); wrap("__"); }
          }}
          rows={5}
          maxLength={50_000}
          placeholder={activeMode === "new" ? "Write your email…" : activeMode === "forward" ? "Add a note (optional)…" : "Write your reply…"}
          className="block max-h-80 min-h-[120px] w-full resize-y px-3 py-2.5 text-[14px] leading-relaxed text-slate-800 outline-none placeholder:text-slate-400"
        />

        {/* Files */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pb-2">
            {files.map((f) => (
              <span key={f.id} className="inline-flex max-w-[240px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[12px] text-slate-700">
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="truncate">{f.name}</span>
                <button type="button" onClick={() => setFiles((l) => l.filter((x) => x.id !== f.id))} aria-label={`Remove ${f.name}`}
                  className="text-slate-400 hover:text-slate-600"><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
        )}

        {/* Tools and send */}
        <div ref={menuRef} className="relative flex flex-wrap items-center gap-0.5 rounded-b-xl border-t border-slate-100 px-2 py-1.5">
          <EmojiPickerPopover onSelect={insertAtCursor} />
          <ToolButton label="Attach a file (max 3 MB each)" onClick={() => setPickerOpen(true)} disabled={files.length >= MAX_FILES}>
            <Paperclip className="h-4 w-4" />
          </ToolButton>
          <ToolButton label="Insert a product" onClick={() => setMenu(menu === "catalog" ? null : "catalog")} active={menu === "catalog"}>
            <ShoppingBag className="h-4 w-4" />
          </ToolButton>
          <ToolButton label="Schedule" onClick={() => setMenu(menu === "schedule" ? null : "schedule")} active={menu === "schedule"}>
            <CalendarClock className="h-4 w-4" />
          </ToolButton>
          <ToolButton label="Draft a reply with AI" onClick={() => void draftWithAi()} active disabled={drafting}>
            {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          </ToolButton>
          <ToolButton label="Translate" onClick={() => setMenu(menu === "translate" ? null : "translate")} disabled={!text.trim() || translating}>
            {translating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
          </ToolButton>

          <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-[12px] text-slate-500">
            <input type="checkbox" checked={signature} onChange={(e) => setSignature(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--primary)]" />
            Signature
          </label>

          <span className="ml-auto hidden text-[11px] text-slate-400 lg:inline">Ctrl + Enter to send</span>
          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            className="ml-2 inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {activeMode === "new" ? "Send email" : activeMode === "forward" ? "Forward" : "Send reply"}
          </button>

          {/* Menus open upward, above the tool row */}
          {menu === "translate" && (
            <div className="absolute bottom-full left-2 z-20 mb-1 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
              {translateTargets.map((l) => (
                <button key={l} type="button" onClick={() => void translate(l)} className="block w-full px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50">
                  {l}
                </button>
              ))}
            </div>
          )}
          {menu === "catalog" && (
            <div className="absolute bottom-full left-2 z-20 mb-1 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
              <input value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="Search products…" autoFocus
                className="mb-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-[13px] outline-none focus:border-primary/50" />
              <div className="max-h-56 overflow-y-auto">
                {products.length === 0 ? (
                  <p className="px-2 py-3 text-[12px] text-slate-400">No products. Connect a catalog in Settings.</p>
                ) : products.map((p) => (
                  <button key={p.id} type="button"
                    onClick={() => {
                      const price = p.price != null ? ` — ${p.currency === "INR" || !p.currency ? "₹" : `${p.currency} `}${p.price}` : "";
                      insertAtCursor(`${text && !text.endsWith("\n") ? "\n" : ""}- **${p.name}**${price}\n`);
                      setMenu(null);
                    }}
                    className="block w-full truncate rounded-md px-2 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-50">
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {menu === "schedule" && (
            <div className="absolute bottom-full left-2 z-20 mb-1 w-72 space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
              <label htmlFor="email-schedule-at" className="block text-[12px] font-medium text-slate-600">Send this email at</label>
              <input id="email-schedule-at" type="datetime-local" min={minSchedule} value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)}
                className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-[13px] outline-none focus:border-primary/50" />
              <button type="button" onClick={() => void schedule()} disabled={!scheduleAt || !canSend}
                className="w-full rounded-lg bg-primary py-1.5 text-[13px] font-semibold text-primary-foreground disabled:opacity-50">
                Schedule email
              </button>
            </div>
          )}
        </div>
      </div>

      <FileManagerPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(file) => {
          if (file.size > MAX_FILE_BYTES) { toast.error(`${file.original_name} is over 3 MB`); return; }
          setFiles((l) =>
            l.some((x) => x.id === file.id) || l.length >= MAX_FILES
              ? l
              : [...l, { id: file.id, name: file.original_name, size: file.size, url: file.url, mime: file.mime_type }],
          );
        }}
      />
    </div>
  );
}
