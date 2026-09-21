"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { Message, Conversation, Lead } from "@/types";
import { useAuth } from "./use-auth";

export interface RealtimeEvent<T> {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T;
  old: Partial<T>;
}

interface ChatbotRunEvent {
  id: string;
  execution_count: number;
}

/**
 * A call that is ringing, or has stopped.
 *
 * Deliberately not the RealtimeEvent<T> shape the rows use: a call is not
 * a row being inserted or updated, it is something happening right now,
 * and forcing it into INSERT/UPDATE would only obscure that.
 */
export interface CallRealtimeEvent {
  type?: "ringing" | "ended" | "cancelled";
  callId: string;
  /** Null rings every agent, which is deliberate — better two answer
   *  than nobody. A transfer names the one person it is for. */
  agentId: string | null;
  callerName: string | null;
  callerNumber: string | null;
  conversationId: string | null;
  transferredFromAi?: boolean;
  transferReason?: string | null;
  ringSeconds?: number;
}

/**
 * Somebody's presence changed, right now.
 *
 * Presence is read from users.last_seen_at, which the heartbeat writes
 * on activity. That is accurate but silent: a screen showing the team
 * only learns about it when it next refetches, so an agent who signed
 * in a moment ago stayed grey for up to half a minute on their
 * supervisor's screen. For the one thing on that screen whose whole job
 * is being current, half a minute is too long.
 *
 * So the heartbeat also says so out loud, and anything showing the team
 * moves the dot without waiting to ask.
 */
export interface PresenceEvent {
  userId: string;
  /** ISO. What the row now says, so a listener updates rather than
   *  guesses. */
  lastSeenAt: string;
  /** Set when they have just gone — signed out, or closed their last
   *  window. Null on an ordinary heartbeat. */
  wentOfflineAt: string | null;
}

interface UseRealtimeOptions {
  channelName: string;
  onMessageEvent?: (event: RealtimeEvent<Message>) => void;
  onConversationEvent?: (event: RealtimeEvent<Conversation>) => void;
  onLeadEvent?: (event: RealtimeEvent<Lead>) => void;
  onChatbotEvent?: (event: ChatbotRunEvent) => void;
  onCallEvent?: (event: CallRealtimeEvent) => void;
  onPresenceEvent?: (event: PresenceEvent) => void;
  enabled?: boolean;
}

let sharedSocket: Socket | null = null;

function getSocket(): Socket {
  if (!sharedSocket || !sharedSocket.connected) {
    sharedSocket = io({ path: "/socket.io", transports: ["websocket", "polling"] });
  }
  return sharedSocket;
}

export function useRealtime({
  onMessageEvent,
  onConversationEvent,
  onLeadEvent,
  onChatbotEvent,
  onCallEvent,
  onPresenceEvent,
  enabled = true,
}: UseRealtimeOptions) {
  const { accountId } = useAuth();
  const [isConnected, setIsConnected] = useState(false);

  const onMessageRef = useRef(onMessageEvent);
  const onConversationRef = useRef(onConversationEvent);
  const onLeadRef = useRef(onLeadEvent);
  const onChatbotRef = useRef(onChatbotEvent);
  const onCallRef = useRef(onCallEvent);
  const onPresenceRef = useRef(onPresenceEvent);
  useEffect(() => {
    onMessageRef.current = onMessageEvent;
    onConversationRef.current = onConversationEvent;
    onLeadRef.current = onLeadEvent;
    onChatbotRef.current = onChatbotEvent;
    onCallRef.current = onCallEvent;
    onPresenceRef.current = onPresenceEvent;
  });

  useEffect(() => {
    if (!enabled || !accountId) return;

    const socket = getSocket();

    const handleConnect = () => {
      setIsConnected(true);
      socket.emit("join_account", accountId);
    };

    const handleDisconnect = () => setIsConnected(false);

    const handleMessage = (event: RealtimeEvent<Message>) => {
      onMessageRef.current?.(event);
    };

    const handleConversation = (event: RealtimeEvent<Conversation>) => {
      onConversationRef.current?.(event);
    };

    const handleLead = (event: RealtimeEvent<Lead>) => {
      onLeadRef.current?.(event);
    };

    const handleChatbot = (event: ChatbotRunEvent) => {
      onChatbotRef.current?.(event);
    };

    const handleCall = (event: CallRealtimeEvent) => {
      onCallRef.current?.(event);
    };

    const handlePresence = (event: PresenceEvent) => {
      onPresenceRef.current?.(event);
    };

    if (socket.connected) {
      handleConnect();
    }

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("message", handleMessage);
    socket.on("conversation", handleConversation);
    socket.on("lead", handleLead);
    socket.on("chatbot", handleChatbot);
    socket.on("call", handleCall);
    socket.on("presence", handlePresence);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("message", handleMessage);
      socket.off("conversation", handleConversation);
      socket.off("lead", handleLead);
      socket.off("chatbot", handleChatbot);
      socket.off("call", handleCall);
      socket.off("presence", handlePresence);
      socket.emit("leave_account", accountId);
      setIsConnected(false);
    };
  }, [accountId, enabled]);

  const unsubscribe = useCallback(() => {
    if (sharedSocket && accountId) {
      sharedSocket.emit("leave_account", accountId);
      setIsConnected(false);
    }
  }, [accountId]);

  return { isConnected, unsubscribe };
}
