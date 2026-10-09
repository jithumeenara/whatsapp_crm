"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Bold, CalendarClock, CornerUpLeft, FolderOpen, Forward, Italic, Languages, Link2, List, ListOrdered, Loader2, Mail,
  Maximize2, Minimize2, Paperclip, PenSquare, ReplyAll, Send, ShoppingBag, Sparkles, Underline, Unlink, Upload, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EmojiPickerPopover } from "./emoji-picker-popover";
import { FileManagerPicker } from "./file-manager-picker";
import { NO_FORMAT, RichEmailEditor, type FormatState, type RichEmailEditorHandle } from "./rich-email-editor";

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
/** What the device picker offers — the same types the server accepts. */
const ATTACH_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.mp4,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,image/*";
/** One tool in the bottom row: an icon, and its name where there is room. */
const TOOL_TILE =
  "flex h-9 w-full min-w-0 items-center justify-center gap-1.5 rounded-lg px-1 text-[12.5px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40";

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
  label, onClick, children, active, disabled, pressed,
}: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean; disabled?: boolean; pressed?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      // Keeps the text selection in the editor while a button is clicked.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40",
        active && "bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200",
        pressed && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
      )}
    >
      {children}
    </button>
  );
}

function ToolTile({
  label, title, onClick, children, active, disabled,
}: { label: string; title: string; onClick: () => void; children: React.ReactNode; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className={cn(TOOL_TILE, active && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary")}
    >
      {children}
      <span className="hidden truncate lg:inline">{label}</span>
    </button>
  );
}

/**
 * The email box. Reply keeps the customer's thread; Reply all and
 * Forward act on the email chosen in the thread; New email starts a
 * separate one with a subject of its own — the choices HubSpot, Front
 * and respond.io all put side by side.
 *
 * The body is a real formatted editor (rich-email-editor.tsx). What it
 * hands over is the light markup in lib/email/markup.ts, which is the
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
  const [menu, setMenu] = useState<null | "translate" | "catalog" | "schedule" | "attach">(null);
  const [expanded, setExpanded] = useState(false);
  const [uploading, setUploading] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [drafting, setDrafting] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [products, setProducts] = useState<Array<{ id: string; name: string; price: number | null; currency: string | null }>>([]);
  const [productQuery, setProductQuery] = useState("");
  const editorRef = useRef<RichEmailEditorHandle>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [format, setFormat] = useState<FormatState>(NO_FORMAT);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  // What the reply box is doing: an action picked on an email wins.
  const activeMode: EmailComposeMode = target ? target.action : mode;

  useEffect(() => {
    if (target) editorRef.current?.focus();
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

  // Escape leaves the large view (the draft stays as it is).
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !menu) setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, menu]);

  // Click-away for the small menus.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
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
    uploading.length === 0 &&
    text.trim().length > 0 &&
    !!contactEmail &&
    (activeMode !== "new" || newSubject.trim().length > 0) &&
    (activeMode !== "forward" || forwardTo.trim().length > 0);

  // ── Editing helpers ─────────────────────────────────────────────────
  /** Replaces the whole body, in the editor and in the draft. */
  function setBody(markup: string) {
    setText(markup);
    editorRef.current?.setMarkup(markup);
  }

  function insertAtCursor(snippet: string) {
    editorRef.current?.insertText(snippet);
  }

  function openLink() {
    editorRef.current?.saveSelection();
    setLinkUrl(format.link ?? "");
    setLinkOpen(true);
  }

  function applyLink() {
    if (!linkUrl.trim()) return;
    if (!editorRef.current?.applyLink(linkUrl)) {
      toast.error("Enter a web address, like https://example.com");
      return;
    }
    setLinkOpen(false);
    setLinkUrl("");
  }

  /** Files from this PC or phone — the picker, a drop or a paste. Each
   *  is checked by the server (type, real content, 3 MB) before it is
   *  kept, and lands in the File Manager too. */
  async function uploadFiles(list: File[]) {
    setDragging(false);
    const room = MAX_FILES - files.length - uploading.length;
    if (room <= 0) {
      toast.error(`An email can carry ${MAX_FILES} files`);
      return;
    }
    if (list.length > room) toast.error(`Only ${room} more file${room === 1 ? "" : "s"} fit in this email`);
    for (const file of list.slice(0, room)) {
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`${file.name} is over 3 MB — email attachments can be 3 MB each`);
        continue;
      }
      setUploading((u) => [...u, file.name]);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/email/attachments", { method: "POST", body: form });
        const data = (await res.json().catch(() => ({}))) as { file?: EmailDraftFile; error?: string };
        if (!res.ok || !data.file) throw new Error(data.error || "Could not attach that file");
        const added = data.file;
        setFiles((l) => (l.some((x) => x.id === added.id) || l.length >= MAX_FILES ? l : [...l, added]));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not attach that file");
      } finally {
        setUploading((u) => {
          const i = u.indexOf(file.name);
          return i === -1 ? u : [...u.slice(0, i), ...u.slice(i + 1)];
        });
      }
    }
  }

  // ── Tools ───────────────────────────────────────────────────────────
  // Something typed → "Improve" rewrites it (same language, same facts,
  // markup kept); an empty body → a fresh draft. The agent's own text is
  // one click away in the toast.
  async function draftWithAi() {
    if (drafting) return;
    const original = text;
    const typed = original.trim();
    setDrafting(true);
    try {
      const res = await fetch("/api/messages/ai-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId, ...(typed ? { text: original } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || (typed ? "Could not improve the email" : "Could not draft a reply"));
      setBody(String(data.draft ?? ""));
      editorRef.current?.focus();
      const warnings: string[] = Array.isArray(data.warnings) ? data.warnings : [];
      if (typed) {
        toast.success("Improved. Check it before sending.", {
          action: { label: "↶ Original", onClick: () => setBody(original) },
          duration: 10000,
        });
      }
      for (const w of warnings) toast.warning(w);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : typed ? "Could not improve the email" : "Could not draft a reply");
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
      setBody(String(data.translated_text ?? text));
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
    setBody("");
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
    <div
      className={cn(
        expanded
          ? "fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-2 backdrop-blur-[2px] sm:p-6"
          : "shrink-0 border-t border-slate-200 bg-white px-3 py-3 sm:px-4",
      )}
      onMouseDown={(e) => {
        if (expanded && e.target === e.currentTarget) setExpanded(false);
      }}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          void uploadFiles(Array.from(e.dataTransfer.files));
        }
      }}
    >
      <div
        className={cn(
          "relative mx-auto w-full overflow-visible rounded-xl border border-slate-200 bg-white shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15",
          expanded ? "flex h-full max-h-[920px] max-w-5xl flex-col shadow-2xl" : "max-w-3xl",
          dragging && "border-primary ring-2 ring-primary/30",
        )}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-xl bg-primary/10 text-[14px] font-semibold text-primary backdrop-blur-[1px]">
            <Paperclip className="mr-2 h-4 w-4" /> Drop files to attach
          </div>
        )}
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
          <button
            type="button"
            onClick={() => {
              setExpanded((v) => !v);
              requestAnimationFrame(() => editorRef.current?.focus());
            }}
            title={expanded ? "Back to the small box (Esc)" : "Write in a large window"}
            aria-label={expanded ? "Exit large view" : "Expand editor"}
            aria-pressed={expanded}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-800"
          >
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
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
          <ToolButton label="Bold (Ctrl+B)" pressed={format.bold} onClick={() => editorRef.current?.command("bold")}><Bold className="h-4 w-4" /></ToolButton>
          <ToolButton label="Italic (Ctrl+I)" pressed={format.italic} onClick={() => editorRef.current?.command("italic")}><Italic className="h-4 w-4" /></ToolButton>
          <ToolButton label="Underline (Ctrl+U)" pressed={format.underline} onClick={() => editorRef.current?.command("underline")}><Underline className="h-4 w-4" /></ToolButton>
          <ToolButton label="Link (Ctrl+K)" pressed={!!format.link || linkOpen} onClick={openLink}><Link2 className="h-4 w-4" /></ToolButton>
          <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />
          <ToolButton label="Bulleted list — or type “- ”" pressed={format.ul} onClick={() => editorRef.current?.command("ul")}><List className="h-4 w-4" /></ToolButton>
          <ToolButton label="Numbered list — or type “1. ”" pressed={format.ol} onClick={() => editorRef.current?.command("ol")}><ListOrdered className="h-4 w-4" /></ToolButton>
        </div>

        {linkOpen && (
          <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-1.5">
            <Link2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <input
              id="email-link-url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); applyLink(); }
                if (e.key === "Escape") { e.preventDefault(); setLinkOpen(false); editorRef.current?.focus(); }
              }}
              placeholder="Paste or type a web address — select words first to link them"
              autoFocus
              autoComplete="off"
              aria-label="Link address"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-800 outline-none placeholder:text-slate-400"
            />
            <button type="button" onClick={applyLink} disabled={!linkUrl.trim()}
              className="rounded-md bg-primary px-2.5 py-1 text-[12px] font-semibold text-primary-foreground disabled:opacity-40">
              {format.link ? "Update" : "Add link"}
            </button>
            {format.link && (
              <button type="button" onMouseDown={(e) => e.preventDefault()}
                onClick={() => { editorRef.current?.removeLink(); setLinkOpen(false); }}
                title="Remove link" aria-label="Remove link"
                className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-rose-600">
                <Unlink className="h-3.5 w-3.5" />
              </button>
            )}
            <button type="button" onClick={() => { setLinkOpen(false); editorRef.current?.focus(); }} aria-label="Close"
              className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Body */}
        <div className={cn("relative", expanded && "min-h-0 flex-1")}>
          {!text.trim() && (
            <span aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 text-[14px] text-slate-400">
              {activeMode === "new" ? "Write your email…" : activeMode === "forward" ? "Add a note (optional)…" : "Write your reply…"}
            </span>
          )}
          <RichEmailEditor
            ref={editorRef}
            id="email-body"
            initialMarkup={saved?.text ?? ""}
            placeholder={activeMode === "new" ? "Write your email" : "Write your reply"}
            onChange={setText}
            onFormatChange={setFormat}
            onSubmit={() => void send()}
            onLinkShortcut={openLink}
            onFiles={(list) => void uploadFiles(list)}
            className={expanded ? "h-full max-h-none text-[15px]" : undefined}
          />
        </div>

        {/* Files */}
        {(files.length > 0 || uploading.length > 0) && (
          <div className="flex flex-wrap gap-2 px-3 pb-2">
            {uploading.map((name, i) => (
              <span key={`${name}-${i}`} className="inline-flex max-w-[240px] items-center gap-1.5 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-2 py-1 text-[12px] text-slate-600">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                <span className="truncate">{name}</span>
              </span>
            ))}
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
        <div ref={menuRef} className="relative flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-b-xl border-t border-slate-100 px-2 py-1.5">
          <div className="grid min-w-0 flex-1 basis-full grid-cols-6 gap-1 sm:basis-0">
            <EmojiPickerPopover onSelect={insertAtCursor} label="Emoji" buttonClassName={TOOL_TILE} />
            <ToolTile label="Attach" title="Attach files — from this device or the File Manager (3 MB each)"
              onClick={() => setMenu(menu === "attach" ? null : "attach")} active={menu === "attach"}
              disabled={files.length + uploading.length >= MAX_FILES}>
              <Paperclip className="h-4 w-4 shrink-0" />
            </ToolTile>
            <ToolTile label="Product" title="Insert a product" onClick={() => setMenu(menu === "catalog" ? null : "catalog")} active={menu === "catalog"}>
              <ShoppingBag className="h-4 w-4 shrink-0" />
            </ToolTile>
            <ToolTile label="Schedule" title="Send later" onClick={() => setMenu(menu === "schedule" ? null : "schedule")} active={menu === "schedule"}>
              <CalendarClock className="h-4 w-4 shrink-0" />
            </ToolTile>
            <ToolTile label={text.trim() ? "Improve" : "AI draft"} title={text.trim() ? "Rewrite what you typed to read professional, in the same language" : "Draft a reply with AI"} onClick={() => void draftWithAi()} disabled={drafting}>
              {drafting ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Sparkles className="h-4 w-4 shrink-0 text-violet-500" />}
            </ToolTile>
            <ToolTile label="Translate" title="Translate what you wrote" onClick={() => setMenu(menu === "translate" ? null : "translate")}
              active={menu === "translate"} disabled={!text.trim() || translating}>
              {translating ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Languages className="h-4 w-4 shrink-0" />}
            </ToolTile>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-slate-500">
              <input type="checkbox" checked={signature} onChange={(e) => setSignature(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--primary)]" />
              Signature
            </label>
            <button
              type="button"
              onClick={() => void send()}
              disabled={!canSend}
              title="Send (Ctrl + Enter)"
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {activeMode === "new" ? "Send email" : activeMode === "forward" ? "Forward" : "Send reply"}
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ATTACH_ACCEPT}
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (picked.length) void uploadFiles(picked);
            }}
          />

          {menu === "attach" && (
            <div className="absolute bottom-full left-2 z-20 mb-1 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
              <button type="button" onClick={() => { setMenu(null); fileInputRef.current?.click(); }}
                className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-slate-50">
                <Upload className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>
                  <span className="block text-[13px] font-medium text-slate-800">Upload from this device</span>
                  <span className="block text-[11.5px] text-slate-500">PC or phone · 3 MB each · or drop files on the box</span>
                </span>
              </button>
              <button type="button" onClick={() => { setMenu(null); setPickerOpen(true); }}
                className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-slate-50">
                <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <span>
                  <span className="block text-[13px] font-medium text-slate-800">Choose from File Manager</span>
                  <span className="block text-[11.5px] text-slate-500">Files already uploaded to the CRM</span>
                </span>
              </button>
            </div>
          )}

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
                      editorRef.current?.insertMarkup(`- **${p.name}**${price}`);
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
