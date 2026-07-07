"use client";

import { memo, useContext } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle } from "lucide-react";
import { NODE_META, summarizeChatbotNode, getSourceHandles } from "@/lib/chatbot/node-meta";
import type { ChatbotNodeType } from "@/lib/chatbot/types";
import { ChatbotChannelContext } from "./chatbot-canvas";

const INSTAGRAM_INCOMPATIBLE = new Set([
  // send_buttons works via Instagram Quick Replies API
  'send_list', 'send_template', 'send_flow', 'send_to_number',
])

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(" ");
}

export interface ChatbotNodeData {
  node_type: ChatbotNodeType;
  config: Record<string, unknown>;
  isEntry?: boolean;
}

const ChatbotNodeComponent = memo(function ChatbotNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as ChatbotNodeData;
  const { node_type, config, isEntry } = nodeData;
  const meta = NODE_META[node_type];
  if (!meta) return null;

  const channel = useContext(ChatbotChannelContext)
  const isIncompatible = channel === 'instagram' && INSTAGRAM_INCOMPATIBLE.has(node_type)

  const Icon = meta.icon;
  const summary = summarizeChatbotNode(node_type, config);
  const sourceHandles = getSourceHandles(node_type, config);
  const isTerminal = node_type === "end" || node_type === "handoff";
  const isStart = node_type === "start";

  return (
    <div
      className={cn(
        "relative w-[230px] overflow-hidden rounded-2xl bg-white transition-all duration-150",
        isIncompatible
          ? "border-2 border-rose-400 shadow-[0_0_0_3px_rgba(244,63,94,0.15),0_4px_16px_rgba(0,0,0,0.13)]"
          : selected
            ? "border-2 border-indigo-400 shadow-[0_0_0_3px_rgba(99,102,241,0.15),0_8px_24px_rgba(99,102,241,0.25)]"
            : "border border-slate-200 shadow-[0_4px_16px_rgba(0,0,0,0.13)] hover:border-indigo-200 hover:shadow-[0_6px_24px_rgba(0,0,0,0.18)]",
        isEntry && !selected && !isIncompatible && "border-emerald-300 shadow-[0_0_0_3px_rgba(16,185,129,0.15),0_4px_16px_rgba(0,0,0,0.13)]",
      )}
    >
      {/* Target handle */}
      {!isStart && (
        <Handle
          type="target"
          position={Position.Top}
          className="!-top-[7px] !h-3.5 !w-3.5 !rounded-full !border-2 !border-white !bg-indigo-500 !shadow-sm"
        />
      )}

      {/* Top accent line */}
      <div className={cn("h-[3px] w-full", isIncompatible ? "bg-rose-400" : meta.bg.replace("bg-", "bg-gradient-to-r from-"))} />

      {/* Instagram incompatibility warning */}
      {isIncompatible && (
        <div className="mx-3 mt-2 flex items-center gap-1.5 rounded-lg bg-rose-50 px-2 py-1.5 text-[10px] font-medium text-rose-700">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          Not supported on Instagram — delete this node
        </div>
      )}

      {/* Card header */}
      <div className="flex items-start gap-2.5 px-3 pt-3 pb-2">
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl shadow-sm", meta.bg)}>
          <Icon className={cn("h-4 w-4", meta.color)} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[12px] font-bold leading-tight text-slate-800">{meta.label}</span>
          {isEntry ? (
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Entry
            </span>
          ) : (
            <span className="text-[10px] text-slate-400">{meta.group}</span>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="px-3 pb-3">
        {summary ? (
          <p className="line-clamp-2 rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] leading-relaxed text-slate-600">
            {summary}
          </p>
        ) : (
          <p className="text-[11px] italic text-slate-300">{meta.description}</p>
        )}
      </div>

      {/* Source handles footer */}
      {!isTerminal && sourceHandles.length > 0 && (
        <div
          className={cn(
            "flex border-t border-slate-100 px-3 py-2",
            sourceHandles.length === 1 ? "justify-center" : "justify-around",
          )}
        >
          {sourceHandles.map((h) => (
            <div key={h.id} className="flex flex-col items-center gap-1">
              {h.label && (
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">
                  {h.label}
                </span>
              )}
              <Handle
                type="source"
                position={Position.Bottom}
                id={h.id}
                className="!relative !bottom-auto !left-auto !right-auto !top-auto !h-3.5 !w-3.5 !translate-x-0 !translate-y-0 !rounded-full !border-2 !border-white !bg-indigo-400 !shadow-sm"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

ChatbotNodeComponent.displayName = "ChatbotNode";
export { ChatbotNodeComponent as ChatbotNode };
