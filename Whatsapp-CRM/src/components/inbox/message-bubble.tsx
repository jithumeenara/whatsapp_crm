"use client";

import { useState, useEffect, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Message, MessageReaction, TemplateButton } from "@/types";
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  FileText,
  MapPin,
  LayoutTemplate,
  ImageOff,
  CornerDownLeft,
  Bot,
  UserRound,
  Ban,
  ExternalLink,
  Phone,
  Copy,
  Zap,
  Maximize2,
  X,
  Loader2,
  Download,
} from "lucide-react";
import { format } from "date-fns";
import { ReplyQuote } from "./reply-quote";
import { MessageReactions } from "./message-reactions";

/**
 * Applied as an inline `style` (not a Tailwind class) on every element that
 * renders raw message text. This is deliberate, not a style preference:
 * `cn()` runs classes through `tailwind-merge`, which de-duplicates/reorders
 * classes it thinks conflict — `break-words` and an arbitrary
 * `[overflow-wrap:anywhere]` class both target the same CSS property, and
 * whether tailwind-merge's conflict detection recognizes the arbitrary form
 * (and which one it keeps, and in what order Tailwind's build ultimately
 * emits them) isn't something to depend on for a "must never overflow the
 * viewport" guarantee. An inline style has no such ambiguity — it always
 * wins over any class, unconditionally.
 */
const WRAP_STYLE: CSSProperties = { overflowWrap: "anywhere", wordBreak: "break-word" };

/**
 * Matches WhatsApp's own inline-formatting syntax: ```monospace```,
 * *bold*, _italic_, ~strikethrough~. A marker's inner content must not
 * start/end with whitespace to count — "* not bold *" stays literal in
 * real WhatsApp, and this mirrors that. Monospace content is always
 * literal (never re-parsed); bold/italic/strike can nest inside each other.
 */
const FORMAT_REGEX =
  /```([\s\S]+?)```|\*(\S(?:[^*\n]*\S)?)\*|_(\S(?:[^_\n]*\S)?)_|~(\S(?:[^~\n]*\S)?)~/;

/**
 * Turns raw WhatsApp markup (*bold*, _italic_, ~strike~, ```mono```) into
 * real styled text. Previously the inbox showed customers'/templates' own
 * formatting markers verbatim — exactly the raw asterisks/underscores their
 * WhatsApp app itself never displays — instead of the bold/italic/strike
 * text those markers actually produce.
 */
function renderWhatsAppText(text: string, keyPrefix: string, depth = 0): ReactNode[] {
  if (!text) return [];
  if (depth > 4) return [text]; // guard against pathological nested input
  const regex = new RegExp(FORMAT_REGEX, "g");
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text))) {
    if (m.index > lastIndex) nodes.push(text.slice(lastIndex, m.index));
    const key = `${keyPrefix}-${i++}`;
    if (m[1] !== undefined) {
      nodes.push(
        <code key={key} className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.9em]">
          {m[1]}
        </code>,
      );
    } else if (m[2] !== undefined) {
      nodes.push(<strong key={key}>{renderWhatsAppText(m[2], key, depth + 1)}</strong>);
    } else if (m[3] !== undefined) {
      nodes.push(<em key={key}>{renderWhatsAppText(m[3], key, depth + 1)}</em>);
    } else if (m[4] !== undefined) {
      nodes.push(<s key={key}>{renderWhatsAppText(m[4], key, depth + 1)}</s>);
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/** Renders WhatsApp-formatted text (*bold*, _italic_, ~strike~, ```mono```)
 *  as real styled output. Exported for reuse by ReplyQuote, which shows the
 *  same raw `content_text` in the quoted-message preview. */
export function WhatsAppText({ text }: { text: string }) {
  return <>{renderWhatsAppText(text, "f")}</>;
}

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
  /** Display name for the agent who sent this message (if known). */
  agentName?: string;
}

function StatusIcon({ status }: { status: Message["status"] }) {
  switch (status) {
    case "sending":
      return <Clock className="h-3 w-3 text-slate-500" />;
    case "sent":
      return <Check className="h-3 w-3 text-slate-500" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3 text-slate-500" />;
    case "read":
      return <CheckCheck className="h-3 w-3 text-blue-400" />;
    case "failed":
      return <XCircle className="h-3 w-3 text-red-400" />;
    default:
      return null;
  }
}

function MediaUnavailable({ label }: { label: string }) {
  // bg-black/5 + slate text reads correctly against every bubble colour
  // this app uses (light green/teal/amber/slate) — a previous white-on-
  // white-ish styling here (bg-white/10 + text-white/80) was only ever
  // legible against a dark bubble background, which no bubble here has.
  // Rarely hit before (only a literally-missing media_url); now common,
  // since video/audio/document route through this on any failed fetch.
  return (
    <div className="flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-xs text-slate-500">
      <ImageOff className="h-4 w-4 shrink-0 text-slate-400" />
      <span>{label} unavailable</span>
    </div>
  );
}

/** Full-screen click-to-view for an already-resolved image src — reused by
 *  MediaImage below. A separate component so its state doesn't reset every
 *  time the thumbnail re-renders. */
function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-6"
      onClick={onClose}
      role="button"
      tabIndex={-1}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="max-h-full max-w-full rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

/** Best-effort file extension for a suggested download name — WhatsApp
 *  media URLs are opaque IDs (/api/whatsapp/media/{mediaId}), not real
 *  filenames, so there's nothing to extract one from otherwise. */
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/3gpp": "3gp",
  "audio/aac": "aac", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/amr": "amr",
  "audio/ogg": "ogg", "audio/opus": "opus",
  "application/pdf": "pdf",
};
function extFromMime(mime?: string | null): string {
  if (!mime) return "";
  return MIME_EXT[mime] ?? mime.split("/")[1]?.split("+")[0] ?? "";
}

/** Fetches the media and triggers a real browser download (not just a
 *  view) — a plain `<a href download>` on a same-origin proxy route
 *  can't set Content-Disposition itself, so this does the fetch+blob+
 *  synthetic-click dance instead. Returns whether it succeeded, so
 *  callers can show a failure state instead of silently doing nothing. */
async function downloadMediaFile(url: string, filename: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    return true;
  } catch {
    return false;
  }
}

/** Small icon button reused by every media type — positioned by the
 *  caller via `className`. Stops propagation so it never also triggers
 *  whatever click behavior (lightbox, preview) the media itself has. */
function DownloadButton({ url, filename, className }: { url: string; filename: string; className: string }) {
  const [busy, setBusy] = useState(false);

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    const ok = await downloadMediaFile(url, filename);
    setBusy(false);
    if (!ok) console.error("Download failed:", url);
  }

  return (
    <button type="button" onClick={handleClick} disabled={busy} title="Download" className={className}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
    </button>
  );
}

function MediaImage({ url, alt, mimeType }: { url: string; alt: string; mimeType?: string | null }) {
  // Only the proxied /api/whatsapp/media/... case needs a fetch+blob-URL
  // dance (for its own loading/error UI, not an auth requirement — a plain
  // <img src> would send the session cookie same-origin regardless). A
  // direct URL is just used as-is, computed at render time below instead
  // of round-tripping through state, so the effect never needs to call
  // setState synchronously in its own body — only from the fetch's own
  // callbacks, which is what effects are for.
  const isProxied = url.startsWith("/api/whatsapp/media/");
  const [blobSrc, setBlobSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(isProxied);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    if (!url || !isProxied) return;
    let blobUrl: string | null = null;
    let cancelled = false;

    fetch(url)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) throw new Error("Failed to load media");
        const blob = await res.blob();
        blobUrl = URL.createObjectURL(blob);
        if (!cancelled) setBlobSrc(blobUrl);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [url, isProxied]);

  const src = isProxied ? blobSrc : url;

  if (error) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-slate-100">
        <ImageOff className="h-8 w-8 text-slate-500" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-slate-100">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <>
      {/* group + hover overlay: hovering reveals expand/download
          affordances, clicking the image (not the download button)
          opens the full-size image in a lightbox. A plain div (not a
          <button>) so the download button can legally nest inside —
          two real <button> elements can't nest in valid HTML. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setLightboxOpen(true)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setLightboxOpen(true); } }}
        className="group relative block w-fit cursor-zoom-in overflow-hidden rounded-lg"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src ?? ""}
          alt={alt}
          className="max-h-64 max-w-60 rounded-lg object-cover"
          onError={() => setError(true)}
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100">
          <Maximize2 className="h-6 w-6 text-white drop-shadow" />
        </div>
        {src && (
          <DownloadButton
            url={src}
            filename={`image.${extFromMime(mimeType) || "jpg"}`}
            className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
          />
        )}
      </div>
      {lightboxOpen && src && (
        <ImageLightbox src={src} alt={alt} onClose={() => setLightboxOpen(false)} />
      )}
    </>
  );
}

function MediaVideo({ url, mimeType }: { url: string; mimeType?: string | null }) {
  const [error, setError] = useState(false);
  if (error) return <MediaUnavailable label="Video" />;
  return (
    <div className="group relative w-fit">
      <video
        src={url}
        controls
        className="max-h-64 max-w-60 rounded-lg"
        onError={() => setError(true)}
      />
      <DownloadButton
        url={url}
        filename={`video.${extFromMime(mimeType) || "mp4"}`}
        className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
      />
    </div>
  );
}

function MediaAudio({ url, mimeType }: { url: string; mimeType?: string | null }) {
  const [error, setError] = useState(false);
  if (error) return <MediaUnavailable label="Audio" />;
  return (
    <div className="flex items-center gap-1.5">
      <audio
        src={url}
        controls
        className="max-w-60"
        onError={() => setError(true)}
      />
      <DownloadButton
        url={url}
        filename={`audio.${extFromMime(mimeType) || "ogg"}`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      />
    </div>
  );
}

/**
 * Opens `url` in a new tab, resolving it via fetch+blob first so an
 * expired/dead link shows as a failure (via `onFail`) instead of a
 * broken-looking navigation to the proxy route's raw JSON error body.
 * Opens the tab synchronously, before the fetch — popup blockers only
 * allow window.open() within the same event-handler tick as the user's
 * click; calling it after an await risks being silently blocked.
 * Deliberately omits `noopener` (unlike a plain link) since redirecting
 * the tab once the blob is ready requires keeping the window reference —
 * acceptable for a same-app blob: URL, not an external destination.
 */
async function openMediaInTab(url: string, onFail: () => void): Promise<void> {
  const pending = window.open("about:blank", "_blank");
  try {
    const res = await fetch(url);
    if (!res.ok) { onFail(); pending?.close(); return; }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    if (pending) pending.location.href = blobUrl;
    else window.open(blobUrl, "_blank", "noopener,noreferrer"); // last-resort if the pre-open was itself blocked
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch {
    onFail();
    pending?.close();
  }
}

/**
 * PDFs get an inline thumbnail — the browser's own PDF renderer in a
 * small, non-interactive iframe — that opens the full document in a new
 * tab on click. Any other document type just shows its real filename;
 * there's no generic way to thumbnail an arbitrary file type inline.
 */
function MediaDocument({ url, label, mimeType }: { url: string; label: string; mimeType?: string | null }) {
  const isPdf = mimeType ? mimeType === "application/pdf" : /\.pdf$/i.test(label);
  const isProxied = url.startsWith("/api/whatsapp/media/");

  // PDFs fetch eagerly (to render the thumbnail); other types stay lazy,
  // fetching only on click — a long chat history shouldn't eagerly
  // download every document just to show a filename chip.
  const [blobSrc, setBlobSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(isPdf && isProxied);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!isPdf || !isProxied) return;
    let blobUrl: string | null = null;
    let cancelled = false;
    fetch(url)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) throw new Error("Failed to load media");
        const blob = await res.blob();
        blobUrl = URL.createObjectURL(blob);
        if (!cancelled) setBlobSrc(blobUrl);
      })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [url, isPdf, isProxied]);

  if (error) return <MediaUnavailable label={label} />;

  async function handleOpen(e: React.MouseEvent) {
    if (!isProxied) return; // plain URL — let the browser navigate normally
    e.preventDefault();
    setChecking(true);
    await openMediaInTab(url, () => setError(true));
    setChecking(false);
  }

  const downloadUrl = blobSrc ?? url;
  const downloadName = label.includes(".") ? label : `${label}.${extFromMime(mimeType) || (isPdf ? "pdf" : "")}`;

  if (isPdf) {
    return (
      <div className="w-40">
        <a
          href={url}
          onClick={handleOpen}
          target="_blank"
          rel="noopener noreferrer"
          className="group relative block overflow-hidden rounded-lg border border-slate-200 bg-white"
        >
          {loading ? (
            <div className="flex h-48 items-center justify-center bg-slate-50">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : blobSrc ? (
            <>
              {/* pointer-events-none: clicks pass through to the <a>
                  above, which handles opening the full document. */}
              <iframe src={`${blobSrc}#toolbar=0&navpanes=0`} title={label} className="pointer-events-none h-48 w-full" />
              <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/20 group-hover:opacity-100">
                <Maximize2 className="h-6 w-6 text-white drop-shadow" />
              </div>
            </>
          ) : (
            <div className="flex h-48 items-center justify-center bg-rose-50">
              <FileText className="h-8 w-8 text-rose-400" />
            </div>
          )}
        </a>
        <div className="mt-1 flex items-center justify-between gap-1.5">
          <p className="min-w-0 flex-1 truncate text-[12px] text-slate-600" title={label}>{label}</p>
          <DownloadButton
            url={downloadUrl}
            filename={downloadName}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-[13px]">
      <a
        href={url}
        onClick={handleOpen}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-w-0 flex-1 items-center gap-2 hover:opacity-80"
      >
        {checking ? (
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-slate-500" />
        ) : (
          <FileText className="h-5 w-5 shrink-0 text-slate-500" />
        )}
        {/* The actual filename+extension, not a generic "Document" label —
            content_text alone could be a caption rather than the real name. */}
        <span className="truncate">{label}</span>
      </a>
      <DownloadButton
        url={downloadUrl}
        filename={downloadName}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-600"
      />
    </div>
  );
}

/** Small colored label identifying which channel a message came from — only
 * rendered when `message.channel` is set, which only happens in the merged
 * cross-channel timeline view (see /api/contacts/[id]/timeline). Normal
 * single-conversation fetches never set it, since every message in that
 * view already shares the open conversation's one channel. */
const CHANNEL_TAG: Record<string, { label: string; className: string }> = {
  whatsapp: { label: "WhatsApp", className: "bg-emerald-50 text-emerald-600" },
  instagram: { label: "Instagram", className: "bg-pink-50 text-pink-600" },
  facebook: { label: "Messenger", className: "bg-blue-50 text-blue-600" },
  sms: { label: "SMS", className: "bg-indigo-50 text-indigo-600" },
  email: { label: "Email", className: "bg-sky-50 text-sky-600" },
  rcs: { label: "RCS", className: "bg-violet-50 text-violet-600" },
};

function ChannelTag({ channel }: { channel?: string }) {
  if (!channel) return null;
  const tag = CHANNEL_TAG[channel];
  if (!tag) return null;
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide", tag.className)}>
      {tag.label}
    </span>
  );
}

/** Read-only display of a sent template's own buttons — quick-reply, URL,
 * phone, copy-code, flow. Previously invisible in the inbox: the bubble
 * only ever showed the template's body text, never what buttons the
 * customer actually saw and could tap, which made it impossible for an
 * agent to tell at a glance what options had been offered.
 *
 * Styled to match how WhatsApp itself renders template buttons — full-width
 * rows spanning edge-to-edge under the message (a negative horizontal
 * margin cancels the bubble's own left/right padding), each divided by a
 * hairline, not floating pills. The first version of this used small
 * low-contrast chips that were nearly unreadable against the bubble
 * background — this is the redesign. */
function TemplateButtonsList({ buttons }: { buttons?: TemplateButton[] | null }) {
  if (!buttons || buttons.length === 0) return null;
  return (
    <div className="-mx-3 mt-2 flex flex-col border-t border-black/10">
      {buttons.map((btn, i) => {
        const Icon =
          btn.type === "URL" ? ExternalLink
          : btn.type === "PHONE_NUMBER" ? Phone
          : btn.type === "COPY_CODE" ? Copy
          : btn.type === "FLOW" ? Zap
          : CornerDownLeft;
        return (
          <div
            key={`${btn.type}-${i}`}
            className={cn(
              "flex items-center justify-center gap-2 px-3 py-2.5 text-[13px] font-semibold text-indigo-600",
              i > 0 && "border-t border-black/10",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{btn.text}</span>
          </div>
        );
      })}
    </div>
  );
}

function MessageContent({ message }: { message: Message }) {
  // Email messages carry a subject line separate from the body — show it
  // as a small bold header above the body text when present.
  const subject = message.email_subject;

  switch (message.content_type) {
    case "text":
      return (
        <div>
          {subject && (
            <p className="mb-1 border-b border-black/10 pb-1 text-[13px] font-bold" style={WRAP_STYLE}>
              {subject}
            </p>
          )}
          <p className="whitespace-pre-wrap text-[13px]" style={WRAP_STYLE}>
            <WhatsAppText text={message.content_text ?? ""} />
          </p>
        </div>
      );

    case "image":
      return (
        <div>
          {message.media_url ? (
            <MediaImage url={message.media_url} alt="Shared image" mimeType={message.media_mime_type} />
          ) : (
            <MediaUnavailable label="Image" />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap text-[13px]" style={WRAP_STYLE}>
              <WhatsAppText text={message.content_text} />
            </p>
          )}
        </div>
      );

    case "video":
      return (
        <div>
          {message.media_url ? (
            <MediaVideo url={message.media_url} mimeType={message.media_mime_type} />
          ) : (
            <MediaUnavailable label="Video" />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap text-[13px]" style={WRAP_STYLE}>
              <WhatsAppText text={message.content_text} />
            </p>
          )}
        </div>
      );

    case "audio":
      return (
        <div>
          {message.media_url ? (
            <MediaAudio url={message.media_url} mimeType={message.media_mime_type} />
          ) : (
            <MediaUnavailable label="Audio" />
          )}
        </div>
      );

    case "document": {
      // The real filename (media_filename) is preferred over content_text,
      // which is only the customer's caption when they gave one — a
      // caption alone would hide the actual file's name and extension.
      const docLabel = message.media_filename || message.content_text || "Document";
      if (!message.media_url) {
        return <MediaUnavailable label={docLabel} />;
      }
      return (
        <MediaDocument url={message.media_url} label={docLabel} mimeType={message.media_mime_type} />
      );
    }

    case "template":
      return (
        <div>
          <span className="mb-1 inline-flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            <LayoutTemplate className="h-3 w-3" />
            Template
          </span>
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap text-[13px]" style={WRAP_STYLE}>
              <WhatsAppText text={message.content_text} />
            </p>
          )}
          <TemplateButtonsList buttons={message.template_buttons} />
        </div>
      );

    case "location":
      return (
        <div className="flex items-center gap-2 text-[13px]">
          <MapPin className="h-4 w-4 shrink-0 text-slate-500" />
          <span>{message.content_text || "Location shared"}</span>
        </div>
      );

    case "interactive": {
      // Customer tapped a reply button or list row on a message the bot
      // sent. Previously this was just a small grey "BUTTON REPLY" label
      // stacked above a plain paragraph — easy to mistake for typed text.
      // A pill label + highlighted selection chip (mirrors how the tapped
      // option itself looked as a button) makes the tap unmistakable at a
      // glance.
      return (
        <div className="flex flex-col gap-1.5">
          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
            <CornerDownLeft className="h-3 w-3" />
            Button reply
          </span>
          <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 px-2.5 py-1.5">
            <p className="whitespace-pre-wrap text-[13px] font-semibold text-emerald-900" style={WRAP_STYLE}>
              <WhatsAppText text={message.content_text || "[Interactive reply]"} />
            </p>
          </div>
        </div>
      );
    }

    default:
      return (
        <p className="whitespace-pre-wrap text-[13px]" style={WRAP_STYLE}>
          <WhatsAppText text={message.content_text || "[Unsupported message type]"} />
        </p>
      );
  }
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
  agentName,
}: MessageBubbleProps) {
  const isOutbound = message.sender_type === "agent" || message.sender_type === "bot";
  const isBot = message.sender_type === "bot";
  const isAgent = message.sender_type === "agent";
  // "You" = message sent by the currently logged-in user
  const isSelf = isAgent && (message.sender_id === currentUserId || agentName === "You");
  const time = format(new Date(message.created_at), "HH:mm");

  return (
    <div
      className={cn(
        // min-w-0 is required alongside max-w-[88%] here: flex items default
        // to min-width:auto (sized to their content's intrinsic width), which
        // silently overrides max-width and defeats break-words on long
        // unbroken strings (URLs) — the bubble grows past the screen edge
        // instead of wrapping. min-w-0 lets max-width actually take effect.
        //
        // 88%/82% (was 85%/75%) — widened so longer messages (templates,
        // multi-line campaign text) use more of the available thread width
        // instead of leaving a large fixed gap on the un-anchored side,
        // most visible on wide desktop windows where 75% of a very wide
        // panel is still a lot of empty space in absolute pixels.
        "flex min-w-0 max-w-[88%] flex-col sm:max-w-[82%]",
        // Belt-and-suspenders alignment: `items-end`/`self-end` rely on this
        // div's flex CONTEXT being exactly right at every ancestor level to
        // take effect. `ml-auto`/`mr-auto` don't — an auto margin in a flex
        // (or even block) layout independently and forcefully consumes all
        // free space on one side, so this pins the bubble to the correct
        // edge even if something upstream ever changes how the row wraps it.
        isOutbound ? "items-end self-end ml-auto" : "items-start self-start mr-auto",
      )}
    >
      {/* Sender label above the bubble */}
      {(isBot || (isAgent && agentName) || message.channel) && (
        <span className="mb-0.5 flex items-center gap-1.5">
          {isBot && (
            <span className="flex items-center gap-1 text-[10px] text-teal-600">
              <Bot className="h-3 w-3" />
              Chatbot
            </span>
          )}
          {isAgent && agentName && (
            <span
              className={cn(
                "flex items-center gap-1 text-[10px]",
                agentName === "You" ? "text-emerald-600" : "text-amber-600",
              )}
            >
              <UserRound className="h-3 w-3" />
              {agentName}
            </span>
          )}
          <ChannelTag channel={message.channel} />
        </span>
      )}

      <div
        className={cn(
          "relative min-w-0 px-2.5 py-[7px] shadow-sm",
          isOutbound
            ? "rounded-[18px] rounded-tr-[4px]"
            : "rounded-[18px] rounded-tl-[4px]",
          message.deleted_at
            ? "bg-slate-100 text-slate-400 border border-slate-200"
            : isBot
              ? "bg-teal-50 text-teal-900 border border-teal-100"
              : isSelf
                ? "bg-[#DCF8C6] text-slate-800"
                : isAgent
                  ? "bg-amber-50 text-amber-900 border border-amber-100"
                  // Customer bubbles were pure white — against this app's
                  // light doodle-patterned chat background, a white bubble
                  // has almost no contrast/separation from the page itself.
                  // A soft neutral grey reads clearly as "a bubble" while
                  // staying visually distinct from the outbound green/teal/
                  // amber bubbles.
                  : "bg-slate-100 text-slate-800 border border-slate-200",
        )}
      >
        {message.deleted_at ? (
          <span className="flex items-center gap-1.5 text-[12px] italic text-slate-400">
            <Ban className="h-3 w-3" />
            {isOutbound ? "You deleted this message" : "This message was deleted"}
          </span>
        ) : (
          <>
            {reply && (
              <ReplyQuote authorLabel={reply.authorLabel} preview={reply.preview} />
            )}
            <MessageContent message={message} />
          </>
        )}
        <div
          className={cn(
            "mt-0.5 flex items-center gap-1",
            isOutbound ? "justify-end" : "justify-start",
          )}
        >
          <span className="text-[10px] text-slate-500/70">{time}</span>
          {isOutbound && <StatusIcon status={message.status} />}
        </div>
      </div>
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
    </div>
  );
}
