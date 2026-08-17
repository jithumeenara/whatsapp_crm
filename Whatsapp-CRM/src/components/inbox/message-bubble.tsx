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
  return (
    <div className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs text-white/80">
      <ImageOff className="h-4 w-4 shrink-0 text-slate-500" />
      <span>{label} unavailable</span>
    </div>
  );
}

function MediaImage({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!url) return;
    let blobUrl: string | null = null;
    let cancelled = false;

    if (url.startsWith("/api/whatsapp/media/")) {
      fetch(url)
        .then(async (res) => {
          if (cancelled) return;
          if (!res.ok) throw new Error("Failed to load media");
          const blob = await res.blob();
          blobUrl = URL.createObjectURL(blob);
          if (!cancelled) setSrc(blobUrl);
        })
        .catch(() => {
          if (!cancelled) setError(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      setSrc(url);
      setLoading(false);
    }

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [url]);

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
    <img
      src={src ?? ""}
      alt={alt}
      className="max-h-64 max-w-60 rounded-lg object-cover"
      onError={() => setError(true)}
    />
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
            <MediaImage url={message.media_url} alt="Shared image" />
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
            <video
              src={message.media_url}
              controls
              className="max-h-64 max-w-60 rounded-lg"
            />
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
            <audio src={message.media_url} controls className="max-w-60" />
          ) : (
            <MediaUnavailable label="Audio" />
          )}
        </div>
      );

    case "document":
      if (!message.media_url) {
        return <MediaUnavailable label={message.content_text || "Document"} />;
      }
      return (
        <a
          href={message.media_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-[13px] hover:bg-slate-100"
        >
          <FileText className="h-5 w-5 shrink-0 text-slate-500" />
          <span className="truncate">
            {message.content_text || "Document"}
          </span>
        </a>
      );

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
