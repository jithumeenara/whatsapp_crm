"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { Message, MessageReaction } from "@/types";
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
} from "lucide-react";
import { format } from "date-fns";
import { ReplyQuote } from "./reply-quote";
import { MessageReactions } from "./message-reactions";

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

function MessageContent({ message }: { message: Message }) {
  switch (message.content_type) {
    case "text":
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text}
        </p>
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
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
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
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
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
          className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm hover:bg-slate-100"
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
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-slate-500" />
          <span>{message.content_text || "Location shared"}</span>
        </div>
      );

    case "interactive": {
      // Customer tapped a reply button or list row on a message the bot
      // sent. We show the tapped option's title (already in content_text,
      // set by parseMessageContent in the webhook) with a small affordance
      // so agents reading the inbox can tell at a glance that this is a
      // tap rather than the customer typing the same words.
      return (
        <div className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
            <CornerDownLeft className="h-3 w-3" />
            Button reply
          </span>
          <p className="whitespace-pre-wrap break-words text-sm">
            {message.content_text || "[Interactive reply]"}
          </p>
        </div>
      );
    }

    default:
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || "[Unsupported message type]"}
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
        // min-w-0 is required alongside max-w-[85%] here: flex items default
        // to min-width:auto (sized to their content's intrinsic width), which
        // silently overrides max-width and defeats break-words on long
        // unbroken strings (URLs) — the bubble grows past the screen edge
        // instead of wrapping. min-w-0 lets max-width actually take effect.
        "flex min-w-0 max-w-[85%] flex-col sm:max-w-[75%]",
        isOutbound ? "items-end self-end" : "items-start self-start",
      )}
    >
      {/* Sender label above the bubble */}
      {isBot && (
        <span className="mb-0.5 flex items-center gap-1 text-[10px] text-teal-600">
          <Bot className="h-3 w-3" />
          Chatbot
        </span>
      )}
      {isAgent && agentName && (
        <span
          className={cn(
            "mb-0.5 flex items-center gap-1 text-[10px]",
            agentName === "You" ? "text-emerald-600" : "text-amber-600",
          )}
        >
          <UserRound className="h-3 w-3" />
          {agentName}
        </span>
      )}

      <div
        className={cn(
          "relative min-w-0 px-3 py-2 shadow-sm",
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
                  : "bg-white text-slate-800 border border-slate-100",
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
