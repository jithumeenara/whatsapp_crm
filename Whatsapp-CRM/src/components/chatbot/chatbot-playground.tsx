"use client";

import { useState, useRef, useEffect } from "react";
import { Send, RotateCcw, Play, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  startSimulation,
  runUntilInteractive,
  applyButtonTap,
  applyListSelect,
  applyTextInput,
  type PlaygroundState,
  type PlaygroundMsg,
} from "@/lib/chatbot/simulator";
import type { ChatbotBuilderNode } from "@/lib/chatbot/types";

interface ChatbotPlaygroundProps {
  nodes: ChatbotBuilderNode[];
  entryNodeKey: string;
}

export function ChatbotPlayground({ nodes, entryNodeKey }: ChatbotPlaygroundProps) {
  const [state, setState] = useState<PlaygroundState | null>(null);
  const [inputText, setInputText] = useState("");
  const [running, setRunning] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state?.msgs]);

  function startFlow() {
    if (!entryNodeKey || nodes.length === 0) return;
    setRunning(true);
    const initial = startSimulation(nodes, entryNodeKey);
    const advanced = runUntilInteractive(nodes, entryNodeKey, initial);
    setState(advanced);
    setRunning(false);
  }

  function reset() {
    setState(null);
    setInputText("");
    setRunning(false);
  }

  function handleButtonTap(label: string, nextKey: string) {
    if (!state) return;
    setState(applyButtonTap(nodes, state, label, nextKey));
  }

  function handleListSelect(label: string, nextKey: string) {
    if (!state) return;
    setState(applyListSelect(nodes, state, label, nextKey));
  }

  function handleTextSend() {
    if (!state || !inputText.trim() || !lastMsg?.awaitInput) return;
    const next = applyTextInput(
      nodes,
      state,
      inputText.trim(),
      lastMsg.awaitInput.varKey,
      lastMsg.awaitInput.nextKey,
    );
    setState(next);
    setInputText("");
  }

  const lastMsg = state?.msgs[state.msgs.length - 1];
  const awaitingInput = !!(lastMsg?.awaitInput);
  const isDone = state?.done;

  return (
    <div className="flex h-full flex-col bg-[#ECE5DD]">
      {/* Phone chrome top bar */}
      <div className="flex items-center gap-3 bg-[#25D366] px-4 py-3 shadow-md">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
          <Bot className="h-4 w-4 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-white">Chatbot Preview</p>
          <p className="text-[10px] text-white/70">
            {state ? (isDone ? "Conversation ended" : "Online") : "Start to preview"}
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-white hover:bg-white/20"
            onClick={reset}
            title="Reset"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          {!state && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-white hover:bg-white/20"
              onClick={startFlow}
              disabled={running || nodes.length === 0}
              title="Start flow"
            >
              <Play className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2">
        {!state && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white shadow">
              <Bot className="h-7 w-7 text-[#25D366]" />
            </div>
            <p className="text-sm font-medium text-gray-600">Tap ▶ to simulate your chatbot</p>
            <p className="text-xs text-gray-400">
              {nodes.length === 0
                ? "Add nodes to the canvas first"
                : `${nodes.length} node${nodes.length === 1 ? "" : "s"} ready`}
            </p>
            {nodes.length > 0 && (
              <Button
                onClick={startFlow}
                className="bg-[#25D366] hover:bg-[#20bd5a] text-white text-xs"
                size="sm"
              >
                <Play className="h-3.5 w-3.5 mr-1" /> Start Preview
              </Button>
            )}
          </div>
        )}

        {state?.msgs.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            onButtonTap={handleButtonTap}
            onListSelect={handleListSelect}
            isDone={isDone ?? false}
          />
        ))}

        {isDone && (
          <div className="flex justify-center">
            <span className="rounded-full bg-black/10 px-3 py-1 text-[11px] text-gray-500">
              Flow ended
            </span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="border-t border-black/10 bg-[#F0F2F5] px-3 py-2">
        {awaitingInput ? (
          <div className="flex gap-2">
            <Input
              className="flex-1 h-9 rounded-full border-none bg-white text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-[#25D366]"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Type a message…"
              onKeyDown={(e) => e.key === "Enter" && handleTextSend()}
              autoFocus
            />
            <Button
              size="icon"
              className="h-9 w-9 rounded-full bg-[#25D366] hover:bg-[#20bd5a] shrink-0"
              onClick={handleTextSend}
              disabled={!inputText.trim()}
            >
              <Send className="h-4 w-4 text-white" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-center h-9">
            <p className="text-[11px] text-gray-400">
              {isDone
                ? "Conversation complete — press ↺ to restart"
                : state
                ? "Waiting for bot response…"
                : "Start the preview above"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Message bubble renderer ─────────────────────────────────────

function MessageBubble({
  msg,
  onButtonTap,
  onListSelect,
  isDone,
}: {
  msg: PlaygroundMsg;
  onButtonTap: (label: string, nextKey: string) => void;
  onListSelect: (label: string, nextKey: string) => void;
  isDone: boolean;
}) {
  const isBot = msg.role === "bot";
  const isUser = msg.role === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("flex flex-col gap-1.5", isUser ? "items-end" : "items-start", "max-w-[80%]")}>
        {/* Main bubble */}
        <div
          className={cn(
            "rounded-2xl px-3 py-2 text-sm shadow-sm",
            isBot
              ? "rounded-tl-sm bg-white text-gray-800"
              : "rounded-tr-sm bg-[#DCF8C6] text-gray-800",
            msg.terminal && "italic text-gray-500",
          )}
        >
          {msg.media && (
            <div className="mb-2 rounded-lg overflow-hidden bg-gray-100 max-h-40">
              {msg.media.type === "image" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={msg.media.url} alt="media" className="w-full object-cover" />
              )}
              {msg.media.type === "document" && (
                <div className="flex items-center gap-2 p-2 text-xs text-gray-600">
                  📄 {msg.media.filename ?? "document"}
                </div>
              )}
              {msg.media.type === "video" && (
                <div className="flex items-center gap-2 p-2 text-xs text-gray-600">
                  🎥 Video
                </div>
              )}
              {msg.media.type === "audio" && (
                <div className="flex items-center gap-2 p-2 text-xs text-gray-600">
                  🎵 Audio
                </div>
              )}
            </div>
          )}
          <p className="whitespace-pre-wrap break-words">{msg.text}</p>
        </div>

        {/* Quick-reply buttons */}
        {isBot && msg.buttons && msg.buttons.length > 0 && !isDone && (
          <div className="flex flex-col gap-1.5 w-full">
            {msg.buttons.map((btn) => (
              <button
                key={btn.id}
                onClick={() => onButtonTap(btn.label, btn.nextKey)}
                className="w-full rounded-xl border border-[#25D366]/30 bg-white px-3 py-2 text-sm font-medium text-[#128C7E] shadow-sm hover:bg-[#25D366]/10 transition-colors"
              >
                {btn.label}
              </button>
            ))}
          </div>
        )}

        {/* List picker */}
        {isBot && msg.listOptions && msg.listOptions.length > 0 && !isDone && (
          <ListPicker options={msg.listOptions} onSelect={onListSelect} />
        )}
      </div>
    </div>
  );
}

function ListPicker({
  options,
  onSelect,
}: {
  options: Array<{ id: string; label: string; description?: string; nextKey: string }>;
  onSelect: (label: string, nextKey: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(!open)}
        className="w-full rounded-xl border border-[#25D366]/30 bg-white px-3 py-2 text-sm font-medium text-[#128C7E] shadow-sm hover:bg-[#25D366]/10 transition-colors"
      >
        View options ▾
      </button>
      {open && (
        <div className="mt-1 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
          {options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => {
                onSelect(opt.label, opt.nextKey);
                setOpen(false);
              }}
              className="flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-gray-50 border-b border-gray-100 last:border-0 transition-colors"
            >
              <span className="text-sm font-medium text-gray-800">{opt.label}</span>
              {opt.description && (
                <span className="text-xs text-gray-400">{opt.description}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
