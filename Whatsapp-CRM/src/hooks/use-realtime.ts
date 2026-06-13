"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { Message, Conversation } from "@/types";
import { useAuth } from "./use-auth";

interface RealtimeEvent<T> {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T;
  old: Partial<T>;
}

interface UseRealtimeOptions {
  channelName: string;
  onMessageEvent?: (event: RealtimeEvent<Message>) => void;
  onConversationEvent?: (event: RealtimeEvent<Conversation>) => void;
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
  enabled = true,
}: UseRealtimeOptions) {
  const { accountId } = useAuth();
  const [isConnected, setIsConnected] = useState(false);

  const onMessageRef = useRef(onMessageEvent);
  const onConversationRef = useRef(onConversationEvent);
  useEffect(() => {
    onMessageRef.current = onMessageEvent;
    onConversationRef.current = onConversationEvent;
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

    if (socket.connected) {
      handleConnect();
    }

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("message", handleMessage);
    socket.on("conversation", handleConversation);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("message", handleMessage);
      socket.off("conversation", handleConversation);
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
