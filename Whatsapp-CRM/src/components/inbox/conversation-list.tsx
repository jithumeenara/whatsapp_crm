"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus } from "@/types";
import { Search, UserPlus, SlidersHorizontal } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  resyncToken?: number;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-emerald-500",
  pending: "bg-amber-400",
  closed: "bg-slate-400",
};

const FILTERS: { label: string; value: ConversationStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Open", value: "open" },
  { label: "Pending", value: "pending" },
  { label: "Closed", value: "closed" },
];

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
}: ConversationListProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ConversationStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);

  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/conversations");
        if (cancelled) return;
        if (!res.ok) { setLoading(false); return; }
        const body = await res.json();
        if (cancelled) return;
        onConversationsLoadedRef.current(Array.isArray(body) ? body : (body.conversations ?? []));
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [resyncToken]);

  const filtered = useMemo(() => {
    let result = conversations;
    if (filter !== "all") result = result.filter((c) => c.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = c.contact?.name?.toLowerCase() ?? "";
        const phone = c.contact?.phone?.toLowerCase() ?? "";
        const lastMsg = c.last_message_text?.toLowerCase() ?? "";
        return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
      });
    }
    return result;
  }, [conversations, filter, search]);

  return (
    <div className="flex h-full w-full flex-col border-r border-slate-200 bg-white lg:w-[320px]">
      {/* Header */}
      <div className="shrink-0 border-b border-slate-200">
        <div className="flex h-14 items-center justify-between gap-2 px-4">
          <span className="text-[17px] font-semibold text-slate-800">Conversations</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSearchOpen((v) => !v)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            >
              <Search className="h-[18px] w-[18px]" />
            </button>
            <button className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800">
              <UserPlus className="h-[18px] w-[18px]" />
            </button>
            <button className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800">
              <SlidersHorizontal className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>

        {/* Search */}
        {searchOpen && (
          <div className="px-3 pb-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search conversations..."
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-100 pl-9 pr-3 text-[14px] text-slate-800 placeholder:text-slate-500 focus:border-primary/50 focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-0 border-t border-slate-200/60 px-2">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "px-3 py-2.5 text-[14px] font-medium transition-colors",
                filter === f.value
                  ? "border-b-2 border-primary text-primary"
                  : "text-slate-500 hover:text-slate-800",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-slate-500">No conversations found</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
}

function ChannelBadge({ channel }: { channel?: string }) {
  if (!channel || channel === 'whatsapp') return null
  if (channel === 'instagram') {
    return (
      <span className="absolute -bottom-0.5 -left-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 text-[8px] font-bold text-white">
        IG
      </span>
    )
  }
  if (channel === 'facebook') {
    return (
      <span className="absolute -bottom-0.5 -left-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-blue-600 text-[8px] font-bold text-white">
        FB
      </span>
    )
  }
  return null
}

function ConversationItem({ conversation, isActive, onSelect }: ConversationItemProps) {
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || "Unknown";
  const initials = displayName.charAt(0).toUpperCase();
  const channel = conversation.channel;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agent = (conversation as any).assigned_agent as {
    id: string;
    email: string;
    profile?: { full_name?: string };
  } | null | undefined;
  const agentInitial = (agent?.profile?.full_name || agent?.email || "")
    .charAt(0)
    .toUpperCase();

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), { addSuffix: false })
    : "";

  return (
    <button
      onClick={() => onSelect(conversation)}
      className={cn(
        "relative flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors",
        isActive
          ? "bg-slate-100"
          : "hover:bg-slate-50",
      )}
    >
      {/* Active indicator */}
      {isActive && (
        <span className="absolute left-0 top-4 bottom-4 w-[3px] rounded-r-full bg-primary" />
      )}

      {/* Avatar */}
      <div className="relative shrink-0">
        <div className={cn(
          "flex h-12 w-12 items-center justify-center rounded-full text-[16px] font-semibold",
          isActive ? "bg-primary/15 text-primary" : "bg-slate-100 text-slate-800/70",
        )}>
          {contact?.avatar_url ? (
            <img src={contact.avatar_url} alt={displayName} className="h-12 w-12 rounded-full object-cover" />
          ) : (
            initials
          )}
        </div>
        {/* Status dot */}
        <span
          className={cn("absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card", STATUS_COLORS[conversation.status])}
          title={conversation.status}
        />
        {/* Channel badge (Instagram / Facebook) */}
        <ChannelBadge channel={channel} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className={cn("truncate text-[15px] font-semibold leading-snug", isActive ? "text-slate-800" : "text-[#2b2d42]")}>
            {displayName}
          </span>
          <span className="shrink-0 text-[13px] text-slate-500">{timeAgo}</span>
        </div>

        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-[13.5px] text-slate-500 leading-snug">
            {conversation.last_message_text || "No messages yet"}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {conversation.unread_count > 0 && (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-bold text-white">
                {conversation.unread_count}
              </span>
            )}
            {agentInitial && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                {agentInitial}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
