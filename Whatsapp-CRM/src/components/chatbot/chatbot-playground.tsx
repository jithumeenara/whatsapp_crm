"use client";

import { useState, useRef, useEffect } from "react";
import { Send, RotateCcw, Play, Bot, Smartphone } from "lucide-react";
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

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(" ");
}

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

  const lastMsg = state?.msgs[state.msgs.length - 1];

  function handleButtonTap(label: string, nextKey: string) {
    if (!state) return;
    setState(applyButtonTap(nodes, state, label, nextKey, lastMsg?.saveVarKey));
  }

  function handleListSelect(label: string, nextKey: string) {
    if (!state) return;
    setState(applyListSelect(nodes, state, label, nextKey, lastMsg?.saveVarKey));
  }

  function handleTextSend() {
    if (!state || !inputText.trim() || !lastMsg?.awaitInput) return;
    const next = applyTextInput(
      nodes, state, inputText.trim(),
      lastMsg.awaitInput.varKey, lastMsg.awaitInput.nextKey,
      lastMsg.awaitInput.inputType, lastMsg.awaitInput.errorMessage,
    );
    setState(next);
    setInputText("");
  }

  const awaitingInput = !!(lastMsg?.awaitInput);
  const isDone = state?.done;

  return (
    <div className="flex h-full flex-col bg-slate-100">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-sm">
            <Smartphone className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-[12px] font-bold text-slate-800">Preview</p>
            <p className="text-[10px] text-slate-400">
              {state ? (isDone ? "Flow complete" : "Running…") : "Tap ▶ to start"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={reset}
            title="Reset"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          {!state && (
            <button
              type="button"
              onClick={startFlow}
              disabled={running || nodes.length === 0}
              title="Start preview"
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              <Play className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Phone frame */}
      <div className="flex flex-1 items-stretch justify-center overflow-hidden p-3">
        <div className="flex w-full max-w-[320px] flex-col overflow-hidden rounded-3xl border border-slate-300 bg-[#ECE5DD] shadow-[0_8px_40px_rgba(0,0,0,0.15)]">

          {/* WhatsApp-style top bar */}
          <div className="flex items-center gap-2.5 bg-[#128C7E] px-4 py-2.5 shadow-sm">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
              <Bot className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-[12px] font-semibold text-white leading-tight">Chatbot</p>
              <p className="text-[10px] text-white/70">
                {state ? (isDone ? "Conversation ended" : "Online") : "Offline"}
              </p>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {!state ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 py-8 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/70 shadow-sm">
                  <Bot className="h-8 w-8 text-[#25D366]" />
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-slate-700">Ready to preview</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {nodes.length === 0 ? "Add nodes to the canvas first" : `${nodes.length} node${nodes.length !== 1 ? "s" : ""} ready`}
                  </p>
                </div>
                {nodes.length > 0 && (
                  <button
                    type="button"
                    onClick={startFlow}
                    disabled={running}
                    className="flex items-center gap-2 rounded-xl bg-[#25D366] px-4 py-2 text-[12px] font-bold text-white shadow-sm hover:bg-[#20bd5a] disabled:opacity-50 transition-colors"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Start Preview
                  </button>
                )}
              </div>
            ) : (
              <>
                {state.msgs.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    onButtonTap={handleButtonTap}
                    onListSelect={handleListSelect}
                    isDone={isDone ?? false}
                  />
                ))}
                {isDone && (
                  <div className="flex justify-center pt-1">
                    <span className="rounded-full bg-white/60 px-3 py-1 text-[10px] font-medium text-slate-500 shadow-sm">
                      Flow ended · tap ↺ to restart
                    </span>
                  </div>
                )}
                <div ref={bottomRef} />
              </>
            )}
          </div>

          {/* Input bar */}
          <div className="shrink-0 border-t border-black/5 bg-[#F0F2F5] px-3 py-2">
            {awaitingInput ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 rounded-full border-0 bg-white px-4 py-2 text-[13px] text-slate-800 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#25D366]/30"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Type a message…"
                  onKeyDown={(e) => e.key === "Enter" && handleTextSend()}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleTextSend}
                  disabled={!inputText.trim()}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white shadow-sm hover:bg-[#20bd5a] disabled:opacity-40 transition-colors"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <p className="py-1.5 text-center text-[11px] text-slate-400">
                {isDone ? "Conversation complete — press ↺ to restart" : state ? "Waiting for bot…" : "Start the preview above"}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Message bubble ──────────────────────────────────────────────

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
      <div className={cn("flex flex-col gap-1.5", isUser ? "items-end" : "items-start", "max-w-[85%]")}>
        <div
          className={cn(
            "rounded-2xl px-3 py-2 text-[13px] leading-relaxed shadow-sm",
            isBot
              ? "rounded-tl-sm bg-white text-slate-800"
              : "rounded-tr-sm bg-[#DCF8C6] text-slate-800",
            msg.terminal && "italic text-slate-500",
          )}
        >
          {msg.media && (
            <div className="mb-2 overflow-hidden rounded-xl bg-slate-100 max-h-36">
              {msg.media.type === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={msg.media.url} alt="media" className="w-full object-cover" />
              ) : (
                <div className="flex items-center gap-2 p-2.5 text-xs text-slate-600">
                  {msg.media.type === "document" && <>📄 {msg.media.filename ?? "document"}</>}
                  {msg.media.type === "video" && <>🎥 Video</>}
                  {msg.media.type === "audio" && <>🎵 Audio</>}
                </div>
              )}
            </div>
          )}
          <p className="whitespace-pre-wrap break-words">{msg.text}</p>
        </div>

        {/* Quick-reply buttons */}
        {isBot && msg.buttons && msg.buttons.length > 0 && !isDone && (
          <div className="flex w-full flex-col gap-1">
            {msg.buttons.map((btn) => (
              <button
                key={btn.id}
                onClick={() => onButtonTap(btn.label, btn.nextKey)}
                className="w-full rounded-xl border border-[#25D366]/30 bg-white px-3 py-2 text-[12px] font-semibold text-[#128C7E] shadow-sm hover:bg-[#25D366]/8 transition-colors"
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
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full rounded-xl border border-[#25D366]/30 bg-white px-3 py-2 text-[12px] font-semibold text-[#128C7E] shadow-sm hover:bg-[#25D366]/8 transition-colors"
      >
        View options ▾
      </button>
      {open && (
        <div className="mt-1.5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => { onSelect(opt.label, opt.nextKey); setOpen(false); }}
              className="flex w-full flex-col gap-0.5 border-b border-slate-100 px-4 py-3 text-left last:border-0 hover:bg-slate-50 transition-colors"
            >
              <span className="text-[12px] font-semibold text-slate-800">{opt.label}</span>
              {opt.description && (
                <span className="text-[11px] text-slate-400">{opt.description}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
