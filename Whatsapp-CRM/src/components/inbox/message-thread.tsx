"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type React from "react";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type {
  Conversation,
  Message,
  MessageReaction,
  Contact,
  ConversationStatus,
  MessageTemplate,
  Profile,
} from "@/types";
import {
  MessageSquare,
  ChevronDown,
  UserPlus,
  Check,
  ArrowLeft,
  RefreshCw,
} from "lucide-react";
import { format, isToday, isYesterday, differenceInHours } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MessageBubble } from "./message-bubble";
import { MessageActions } from "./message-actions";
import { MessageComposer } from "./message-composer";
import { TemplatePicker } from "./template-picker";
import { buildReplyPreview } from "./reply-quote";
import { toast } from "sonner";

interface ReplyDraft {
  id: string;
  authorLabel: string;
  preview: string;
}

function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    return params[idx] ?? `{{${raw}}}`;
  });
}

interface MessageThreadProps {
  conversation: Conversation | null;
  contact: Contact | null;
  messages: Message[];
  onMessagesLoaded: (messages: Message[]) => void;
  onNewMessage: (message: Message) => void;
  onUpdateMessage: (id: string, updates: Partial<Message>) => void;
  onStatusChange: (conversationId: string, status: ConversationStatus) => void;
  onAssignChange: (
    conversationId: string,
    assignedAgentId: string | null,
  ) => void;
  /**
   * On mobile, the thread is shown full-screen with the conversation list
   * hidden. This callback lets the page deselect the active conversation
   * and reveal the list again. Rendered as a back-arrow in the header on
   * mobile only.
   */
  onBack?: () => void;
  /**
   * Increment to force the messages + reactions fetch effects to refire.
   * Parent bumps this on realtime reconnect / tab visibility → visible
   * so the open thread catches up on any events sent while the WS was
   * disconnected or the tab was throttled. Optional so existing callers
   * keep working.
   */
  resyncToken?: number;
  /**
   * Fired by the manual-refresh button in the thread header. The parent
   * typically bumps the same `resyncToken` it controls — this gives the
   * user a way to force a refetch when they suspect realtime missed an
   * event (or they're impatient). Optional so existing callers keep
   * working; the button is only rendered when this is provided.
   */
  onRefresh?: () => void;
}

function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMMM d, yyyy");
}

function groupMessagesByDate(messages: Message[]) {
  const groups: { date: string; messages: Message[] }[] = [];
  let currentDate = "";

  for (const msg of messages) {
    const day = format(new Date(msg.created_at), "yyyy-MM-dd");
    if (day !== currentDate) {
      currentDate = day;
      groups.push({ date: msg.created_at, messages: [msg] });
    } else {
      groups.at(-1)!.messages.push(msg);
    }
  }

  return groups;
}

const STATUS_OPTIONS: { label: string; value: ConversationStatus; color: string }[] = [
  { label: "Open", value: "open", color: "text-primary" },
  { label: "Pending", value: "pending", color: "text-amber-400" },
  { label: "Closed", value: "closed", color: "text-slate-500" },
];

function findReactionByMessage(
  reactions: MessageReaction[],
  messageId: string,
  userId: string | null,
): MessageReaction | undefined {
  return reactions.find(
    (r) => r.message_id === messageId && r.actor_type === "agent" && r.actor_id === userId,
  );
}

function findOwnReaction(
  reactions: MessageReaction[] | undefined,
  userId: string | null,
): MessageReaction | undefined {
  return reactions?.find((r) => r.actor_type === "agent" && r.actor_id === userId);
}

function AssignAgentDropdown({
  assignedAgentId,
  profiles,
  userId,
  onAssignChange,
  trigger,
  align = "end",
}: Readonly<{
  assignedAgentId: string | null;
  profiles: Profile[];
  userId: string | null;
  onAssignChange: (agentId: string | null) => void;
  trigger: React.ReactNode;
  align?: "start" | "end";
}>) {
  return (
    <DropdownMenu>
      {trigger}
      <DropdownMenuContent align={align} className="border-slate-200 bg-white">
        {profiles.length === 0 ? (
          <DropdownMenuItem disabled className="text-sm text-slate-500">
            No teammates available
          </DropdownMenuItem>
        ) : (
          profiles.map((p) => {
            const isSelected = p.user_id === assignedAgentId;
            return (
              <DropdownMenuItem
                key={p.id}
                onClick={() => onAssignChange(p.user_id)}
                className={cn("text-sm", isSelected ? "text-primary" : "text-slate-800/80")}
              >
                <span className="flex-1">
                  {p.full_name}
                  {p.user_id === userId ? " (me)" : ""}
                </span>
                {isSelected && <Check className="ml-2 h-3 w-3" />}
              </DropdownMenuItem>
            );
          })
        )}
        {assignedAgentId && (
          <>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem onClick={() => onAssignChange(null)} className="text-sm text-slate-500">
              Unassign
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * WhatsApp-style doodle background applied to the chat area (both the
 * active thread and the empty state). The SVG tile lives at
 * `/public/inbox-doodle.svg`; the slate-950 colour sits underneath so
 * the doodles read as a subtle pattern rather than a stark grid.
 *
 * Defined once at module scope so the two render paths can't drift —
 * if we ever switch the asset, both spots update together.
 */
const DOODLE_BG_CLASSES =
  "bg-white bg-[url('/inbox-doodle.svg')] bg-repeat";

export function MessageThread({
  conversation,
  contact,
  messages,
  onMessagesLoaded,
  onNewMessage,
  onUpdateMessage,
  onStatusChange,
  onAssignChange,
  onBack,
  resyncToken = 0,
  onRefresh,
}: Readonly<MessageThreadProps>) {
  const { userId } = useAuth();
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  // Purely visual spin state for the manual-refresh button. The actual
  // refetch is fire-and-forget through `onRefresh` (which bumps the
  // parent's resyncToken); the 700ms spin is just feedback so the click
  // doesn't feel like a no-op. Cleared via the timer ref on unmount.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);
  const handleRefreshClick = useCallback(() => {
    if (isRefreshing || !onRefresh) return;
    setIsRefreshing(true);
    onRefresh();
    refreshTimerRef.current = setTimeout(() => {
      setIsRefreshing(false);
      refreshTimerRef.current = null;
    }, 700);
  }, [isRefreshing, onRefresh]);
  const [replyTo, setReplyTo] = useState<ReplyDraft | null>(null);

  // Profiles for the assign-agent dropdown.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/profiles")
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled) setProfiles((body.profiles as Profile[]) ?? []);
      })
      .catch((err) => {
        if (!cancelled) console.error("Failed to fetch profiles:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 24-hour session timer
  const sessionInfo = useMemo(() => {
    if (!messages.length) return { expired: false, remaining: "" };

    // Find last customer message
    const lastCustomerMsg = [...messages]
      .reverse()
      .find((m) => m.sender_type === "customer");

    if (!lastCustomerMsg) return { expired: false, remaining: "" };

    const hoursSince = differenceInHours(new Date(), new Date(lastCustomerMsg.created_at));
    const expired = hoursSince >= 24;

    if (expired) {
      return { expired: true, remaining: "Expired" };
    }

    const hoursLeft = 24 - hoursSince;
    const remaining =
      hoursLeft >= 1
        ? `${Math.floor(hoursLeft)}h remaining`
        : `${Math.floor(hoursLeft * 60)}m remaining`;

    return { expired, remaining };
  }, [messages]);

  // Store latest callback in a ref so fetchMessages doesn't need to
  // depend on `onMessagesLoaded` — otherwise parent re-renders cause
  // fetchMessages to change → useEffect re-fires → refetch → realtime
  // UPDATE on conversations.unread_count → parent re-renders → LOOP.
  // The ref is written inside an effect so the mutation doesn't happen
  // during render (React 19 refs rule); consumers only read `.current`
  // inside the async fetch completion, which runs after the render.
  const onMessagesLoadedRef = useRef(onMessagesLoaded);
  useEffect(() => {
    onMessagesLoadedRef.current = onMessagesLoaded;
  });

  const conversationId = conversation?.id;
  const hasUnread = (conversation?.unread_count ?? 0) > 0;

  // Fetch messages whenever the selected conversation changes. Kept
  // separate from the unread-reset effect so that incoming messages
  // arriving while the thread is open don't trigger a full refetch —
  // they only flip hasUnread, which only the reset effect listens to.
  useEffect(() => {
    if (!conversationId) return;

    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/conversations/${conversationId}/messages`);
        if (cancelled) return;
        if (!res.ok) {
          console.error("Failed to fetch messages:", res.status);
        } else {
          const body = await res.json();
          if (!cancelled) onMessagesLoadedRef.current(Array.isArray(body) ? body : (body.messages ?? []));
        }
      } catch (err) {
        if (!cancelled) console.error("Failed to fetch messages:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus —
    // realtime is best-effort and any message events sent while the WS
    // was disconnected or throttled are otherwise lost.
  }, [conversationId, resyncToken]);

  // Reactions fetch — pulls the current state from the DB. Kept separate
  // from the channel subscription below so a `resyncToken` bump just
  // refetches the rows without also tearing down and rebuilding the
  // realtime channel.
  useEffect(() => {
    if (!conversationId) {
      setReactions([]);
      return;
    }
    let cancelled = false;

    fetch(`/api/conversations/${conversationId}/reactions`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          console.error("Failed to fetch reactions:", res.status);
          return;
        }
        const body = await res.json();
        if (!cancelled) setReactions((body.reactions as MessageReaction[]) ?? []);
      })
      .catch((err) => {
        if (!cancelled) console.error("Failed to fetch reactions:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, resyncToken]);

  // Poll reactions every 30 seconds while a conversation is open.
  // In-flight guard prevents pileup when the server is slow.
  useEffect(() => {
    if (!conversationId) return;

    const POLL_MS = 30_000;
    let cancelled = false;
    let inFlight = false;

    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/conversations/${conversationId}/reactions`);
        if (cancelled || !res.ok) return;
        const body = await res.json();
        if (!cancelled) {
          setReactions((prev) => {
            const incoming = (body.reactions as MessageReaction[]) ?? [];
            const tempRows = prev.filter((r) => r.id.startsWith("temp-"));
            return [...incoming, ...tempRows];
          });
        }
      } catch {
        // silently swallow poll errors
      } finally {
        inFlight = false;
      }
    };

    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [conversationId]);

  // Clear any in-progress reply draft when the active conversation changes —
  // a quote pulled from conversation A shouldn't bleed into conversation B.
  useEffect(() => {
    setReplyTo(null);
  }, [conversationId]);

  // Reset the server-side unread_count to 0 whenever an unread count
  // surfaces on the active conversation — covers both (a) opening a
  // conversation that had unread messages and (b) new messages arriving
  // while the user is already viewing the thread (webhook server-bumps
  // unread_count to N+1; the realtime UPDATE propagates it into the
  // client, which re-runs this effect and flips it back to 0).
  //
  // Guarding on hasUnread prevents the eq-update loop: once unread_count
  // is 0 the condition is false, so no further UPDATE is issued.
  useEffect(() => {
    if (!conversationId || !hasUnread) return;
    fetch(`/api/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unread_count: 0 }),
    }).catch((err) => console.error("Failed to reset unread_count:", err));
  }, [conversationId, hasUnread]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(
    async (text: string, replyToId?: string) => {
      if (!conversation) return;

      const tempId = `temp-${Date.now()}`;

      // Optimistic update — shows the message immediately with "sending" status
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        sender_id: userId ?? undefined,
        content_type: "text",
        content_text: text,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "text",
            content_text: text,
            reply_to_message_id: replyToId,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send message:", reason);
          toast.error(`Failed to send: ${reason}`);
          // Mark the optimistic bubble as failed so the user sees what happened
          onUpdateMessage(tempId, { status: "failed" });
          return;
        }

        // Success — the realtime INSERT event will replace the temp bubble
        // with the real DB row. If realtime hasn't arrived yet, at least
        // flip status to 'sent' so the UI stops showing "sending".
        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send message:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
      }
    },
    [conversation, userId, onNewMessage, onUpdateMessage]
  );

  const handleSendMedia = useCallback(
    async (mediaUrl: string, mediaType: 'image' | 'document' | 'audio' | 'video', filename?: string) => {
      if (!conversation) return;
      const tempId = `temp-${Date.now()}`;
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: 'agent',
        sender_id: userId ?? undefined,
        content_type: mediaType,
        content_text: filename ?? undefined,
        media_url: mediaUrl,
        status: 'sending',
        created_at: new Date().toISOString(),
      };
      onNewMessage(optimisticMsg);
      try {
        const res = await fetch('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: mediaType,
            media_url: mediaUrl,
            content_text: filename,
          }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(payload?.error || `Failed to send file`);
          onUpdateMessage(tempId, { status: 'failed' });
          return;
        }
        onUpdateMessage(tempId, { status: 'sent' });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to send file');
        onUpdateMessage(tempId, { status: 'failed' });
      }
    },
    [conversation, userId, onNewMessage, onUpdateMessage],
  );

  const handleStatusChange = useCallback(
    async (status: ConversationStatus) => {
      if (!conversation) return;

      await fetch(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });

      onStatusChange(conversation.id, status);
    },
    [conversation, onStatusChange]
  );

  const handleOpenTemplates = useCallback(() => {
    const ch = (conversation as { channel?: string })?.channel
    if (ch === 'instagram' || ch === 'facebook') {
      toast.info('Templates are not supported for this channel.')
      return
    }
    setTemplateModalOpen(true);
  }, [conversation]);

  const handleSendTemplate = useCallback(
    async (
      template: MessageTemplate,
      values: {
        body: string[];
        headerText?: string;
        buttonParams?: Record<number, string>;
      },
    ) => {
      if (!conversation) return;

      const renderedBody = renderTemplateBody(template.body_text, values.body);
      const tempId = `temp-${Date.now()}`;

      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        sender_id: userId ?? undefined,
        content_type: "template",
        content_text: renderedBody,
        template_name: template.name,
        status: "sending",
        created_at: new Date().toISOString(),
      };
      onNewMessage(optimisticMsg);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "template",
            template_name: template.name,
            template_language: template.language,
            // Structured params drive the new send-builder path
            // (header media + URL button substitution). Body values
            // are mirrored under both shapes so the route can fall
            // back if the template row isn't found locally.
            template_message_params: {
              body: values.body,
              headerText: values.headerText,
              buttonParams: values.buttonParams,
            },
            template_params: values.body,
            content_text: renderedBody,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send template:", reason);
          toast.error(`Failed to send template: ${reason}`);
          onUpdateMessage(tempId, { status: "failed" });
          return;
        }

        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send template:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send template: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
      }
    },
    [conversation, userId, onNewMessage, onUpdateMessage],
  );

  // Build a quick id → Message map so reply quotes can be rendered without
  // an extra fetch — the thread already holds the full conversation.
  const messagesById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  // Bucket reactions by their target message_id for O(1) per-bubble lookup.
  const reactionsByMessageId = useMemo(() => {
    const map = new Map<string, MessageReaction[]>();
    for (const r of reactions) {
      const bucket = map.get(r.message_id);
      if (bucket) bucket.push(r);
      else map.set(r.message_id, [r]);
    }
    return map;
  }, [reactions]);

  const contactDisplayName = contact?.name || contact?.phone || "Customer";

  // Map every team member's user_id → display name for per-message attribution.
  const senderNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of profiles) {
      map.set(p.user_id, p.full_name || p.email);
    }
    return map;
  }, [profiles]);

  // Resolve the human-readable sender label for an outbound (agent) message.
  const agentLabelFor = useCallback(
    (msg: Message): string => {
      if (!msg.sender_id) return "Agent";
      if (msg.sender_id === userId) return "You";
      return senderNameById.get(msg.sender_id) ?? "Agent";
    },
    [userId, senderNameById],
  );

  // Author label for a quoted message: sender name for agent/bot, contact name for customer.
  const authorLabelFor = useCallback(
    (m: Message): string => {
      if (m.sender_type === "bot") return "Chatbot";
      if (m.sender_type === "agent") return agentLabelFor(m);
      return contactDisplayName;
    },
    [contactDisplayName, agentLabelFor],
  );

  const handleStartReply = useCallback(
    (msg: Message) => {
      setReplyTo({
        id: msg.id,
        authorLabel: authorLabelFor(msg),
        preview: buildReplyPreview(msg),
      });
    },
    [authorLabelFor],
  );

  const handleDeleteMessage = useCallback(
    async (msg: Message) => {
      if (msg.id.startsWith("temp-")) return;
      const channel = (conversation as { channel?: string })?.channel ?? "whatsapp";
      onUpdateMessage(msg.id, { deleted_at: new Date().toISOString() });
      try {
        const res = await fetch(`/api/messages/${msg.id}`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ channel, message_id: msg.message_id }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string };
          toast.error(err.error ?? "Delete failed");
          onUpdateMessage(msg.id, { deleted_at: null });
        }
      } catch {
        toast.error("Delete failed");
        onUpdateMessage(msg.id, { deleted_at: null });
      }
    },
    [conversation, onUpdateMessage],
  );

  // Single reaction-set primitive. emoji === "" removes; otherwise adds/swaps.
  // The "toggle" semantic (pill click) is computed at the call site where the
  // current reactions for the bubble are already in scope — keeps this
  // function dependency-free w.r.t. the reaction list.
  const postReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!userId || !conversation) {
        console.warn("[reactions] missing user or conversation");
        return;
      }
      if (messageId.startsWith("temp-")) {
        toast.error("Wait for the message to finish sending");
        return;
      }

      const convId = conversation.id;
      let snapshot: MessageReaction[] = [];

      // Functional updater — captures the freshest reactions list, never a
      // stale closure. Snapshot stored for rollback on POST failure.
      setReactions((prev) => {
        snapshot = prev;
        const own = findReactionByMessage(prev, messageId, userId);
        if (emoji === "") return own ? prev.filter((r) => r !== own) : prev;
        if (own) return prev.map((r) => (r === own ? { ...own, emoji } : r));
        return [
          ...prev,
          {
            id: `temp-${Date.now()}`,
            message_id: messageId,
            conversation_id: convId,
            actor_type: "agent",
            actor_id: userId ?? undefined,
            emoji,
            created_at: new Date().toISOString(),
          },
        ];
      });

      try {
        const res = await fetch("/api/whatsapp/react", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_id: messageId, emoji }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error || `HTTP ${res.status}`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Reaction failed: ${reason}`);
        setReactions(snapshot);
      }
    },
    [conversation, userId],
  );

  const handleAssignChange = useCallback(
    async (agentId: string | null) => {
      if (!conversation) return;

      const res = await fetch(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assigned_agent_id: agentId }),
      });

      if (!res.ok) {
        console.error("Failed to update assignment:", res.status);
        toast.error("Failed to update assignment");
        return;
      }

      onAssignChange(conversation.id, agentId);
    },
    [conversation, onAssignChange],
  );

  // Empty state — same WhatsApp-style doodle background as the active
  // thread below, so swapping between empty/selected doesn't change the
  // pattern under the user's eye.
  if (!conversation || !contact) {
    return (
      <div className={cn("flex flex-1 flex-col items-center justify-center", DOODLE_BG_CLASSES)}>
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
          <MessageSquare className="h-8 w-8 text-slate-600" />
        </div>
        <h3 className="mt-4 text-sm font-medium text-slate-500">
          Select a conversation
        </h3>
        <p className="mt-1 text-xs text-slate-600">
          Choose a conversation from the left to start messaging
        </p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const messageGroups = groupMessagesByDate(messages);
  const currentStatus = STATUS_OPTIONS.find(
    (s) => s.value === conversation.status
  );
  const assignedAgentId = conversation.assigned_agent_id ?? null;
  const currentAssignee = profiles.find((p) => p.user_id === assignedAgentId);

  let messagesContent: React.ReactNode;
  if (loading) {
    messagesContent = (
      <div className="flex items-center justify-center py-12">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  } else if (messages.length === 0) {
    messagesContent = (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-sm text-slate-500">No messages yet</p>
        <p className="text-xs text-slate-600">
          Send a template to start the conversation
        </p>
      </div>
    );
  } else {
    messagesContent = (
      <div className="space-y-4">
        {messageGroups.map((group) => (
          <div key={group.date}>
            <div className="mb-3 flex items-center justify-center">
              <span className="rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold text-slate-500 shadow-sm backdrop-blur-sm select-none">
                {formatDateSeparator(group.date)}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {group.messages.map((msg) => {
                const parent = msg.reply_to_message_id && msg.content_type !== 'interactive'
                  ? messagesById.get(msg.reply_to_message_id)
                  : null;
                const reply = parent
                  ? { authorLabel: authorLabelFor(parent), preview: buildReplyPreview(parent) }
                  : null;
                const msgReactions = reactionsByMessageId.get(msg.id);
                const handlePillToggle = (emoji: string) => {
                  const own = findOwnReaction(msgReactions, userId);
                  const next = own?.emoji === emoji ? "" : emoji;
                  void postReaction(msg.id, next);
                };
                return (
                  <MessageActions
                    key={msg.id}
                    message={msg}
                    onReply={() => handleStartReply(msg)}
                    onReact={(emoji) => {
                      if (emoji) void postReaction(msg.id, emoji);
                    }}
                    onDelete={
                      (msg.sender_type === "agent" || msg.sender_type === "bot") && !msg.deleted_at
                        ? () => void handleDeleteMessage(msg)
                        : undefined
                    }
                  >
                    <MessageBubble
                      message={msg}
                      reply={reply}
                      reactions={msgReactions}
                      currentUserId={userId ?? undefined}
                      onToggleReaction={handlePillToggle}
                      agentName={
                        msg.sender_type === "agent"
                          ? agentLabelFor(msg)
                          : undefined
                      }
                    />
                  </MessageActions>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-1 flex-col overflow-hidden", DOODLE_BG_CLASSES)}>
      {/* ── Header — WhatsApp-style on mobile ── */}
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 border-b border-slate-200 bg-white px-2 py-2 sm:px-3 lg:px-4 lg:py-0 lg:h-14">
        {/* Back arrow (mobile) */}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to conversations"
            className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 lg:hidden"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}

        {/* Avatar */}
        <div className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[14px] sm:text-[15px] font-semibold text-primary">
          {displayName.charAt(0).toUpperCase()}
        </div>

        {/* Name + sub-row */}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[14px] sm:text-[15px] font-semibold leading-tight text-slate-900">
            {displayName}
          </h2>
          {/* Sub-row: assignment + session timer */}
          <div className="flex items-center gap-1.5 mt-0.5">
            <AssignAgentDropdown
              assignedAgentId={assignedAgentId}
              profiles={profiles}
              userId={userId}
              onAssignChange={handleAssignChange}
              align="start"
              trigger={
                <DropdownMenuTrigger className="flex items-center gap-0.5 text-[11px] sm:text-[11.5px] text-slate-400 hover:text-slate-700 leading-none">
                  <span className="truncate max-w-[80px] sm:max-w-[140px]">
                    {currentAssignee ? currentAssignee.full_name : "Unassigned"}
                  </span>
                  <ChevronDown className="h-3 w-3 shrink-0" />
                </DropdownMenuTrigger>
              }
            />
            {sessionInfo.remaining && (
              <span className={cn(
                "shrink-0 text-[11px] leading-none",
                sessionInfo.expired ? "text-red-400" : "text-slate-400"
              )}>
                · {sessionInfo.remaining}
              </span>
            )}
          </div>
        </div>

        {/* Action buttons (right side) */}
        <div className="flex items-center gap-0.5 shrink-0">
          {/* Manual refresh — desktop only; mobile relies on realtime + focus resync */}
          {onRefresh && (
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={isRefreshing}
              title="Refresh"
              className="hidden lg:flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            >
              <RefreshCw className={cn("h-[17px] w-[17px]", isRefreshing && "animate-spin")} />
            </button>
          )}

          {/* Status — compact pill on mobile, labeled on desktop */}
          <DropdownMenu>
            <DropdownMenuTrigger className={cn(
              "flex h-7 items-center gap-1 rounded-full border px-2 sm:px-2.5 text-[11px] sm:text-[12px] font-medium",
              "lg:h-8 lg:rounded-lg lg:px-3 lg:text-[13px]",
              currentStatus?.color ?? "text-slate-500",
              "border-current/30 hover:bg-slate-50"
            )}>
              {currentStatus?.label ?? "Status"}
              <ChevronDown className="h-3 w-3 shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-slate-200 bg-white">
              {STATUS_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => handleStatusChange(opt.value)}
                  className={cn("text-sm", opt.color)}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Assign agent — desktop only; mobile uses the assignee dropdown under the name */}
          <AssignAgentDropdown
            assignedAgentId={assignedAgentId}
            profiles={profiles}
            userId={userId}
            onAssignChange={handleAssignChange}
            align="end"
            trigger={
              <DropdownMenuTrigger title="Assign agent" className={cn(
                "hidden lg:flex h-9 w-9 items-center justify-center rounded-full hover:bg-slate-100",
                assignedAgentId ? "text-primary" : "text-slate-500"
              )}>
                <UserPlus className="h-[17px] w-[17px]" />
              </DropdownMenuTrigger>
            }
          />
        </div>
      </div>

      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-styled px-3 py-3 sm:px-4 sm:py-4">
        {messagesContent}
      </div>

      {/* Composer */}
      <MessageComposer
        conversationId={conversation.id}
        sessionExpired={sessionInfo.expired}
        channel={(conversation as { channel?: string })?.channel}
        onSend={handleSend}
        onSendMedia={handleSendMedia}
        onOpenTemplates={handleOpenTemplates}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
      />

      <TemplatePicker
        open={templateModalOpen}
        onOpenChange={setTemplateModalOpen}
        onSelect={handleSendTemplate}
      />
    </div>
  );
}
