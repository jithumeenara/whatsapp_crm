"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { NODE_META, summarizeChatbotNode, getSourceHandles } from "@/lib/chatbot/node-meta";
import type { ChatbotNodeType } from "@/lib/chatbot/types";

export interface ChatbotNodeData {
  node_type: ChatbotNodeType;
  config: Record<string, unknown>;
  isEntry?: boolean;
  isSelected?: boolean;
}

const ChatbotNodeComponent = memo(function ChatbotNode({
  data,
  selected,
}: NodeProps) {
  const nodeData = data as unknown as ChatbotNodeData;
  const { node_type, config, isEntry } = nodeData;
  const meta = NODE_META[node_type];
  if (!meta) return null;

  const Icon = meta.icon;
  const summary = summarizeChatbotNode(node_type, config);
  const sourceHandles = getSourceHandles(node_type, config);
  const isTerminal = node_type === "end" || node_type === "handoff";
  const isStart = node_type === "start";

  return (
    <div
      className={cn(
        "relative min-w-[200px] max-w-[240px] rounded-xl border-2 bg-card shadow-sm transition-all",
        selected
          ? "border-primary shadow-md shadow-primary/20"
          : "border-border hover:border-primary/40",
        isEntry && !selected && "border-emerald-400",
      )}
    >
      {/* Target handle (top) — all nodes except start */}
      {!isStart && (
        <Handle
          type="target"
          position={Position.Top}
          className="!h-3 !w-3 !border-2 !border-card !bg-primary"
        />
      )}

      {/* Header strip */}
      <div
        className={cn(
          "flex items-center gap-2 rounded-t-xl px-3 py-2",
          meta.bg,
        )}
      >
        <Icon className={cn("h-4 w-4 shrink-0", meta.color)} />
        <span className={cn("text-xs font-semibold", meta.color)}>
          {meta.label}
        </span>
        {isEntry && (
          <span className="ml-auto rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
            Entry
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        {summary ? (
          <p className="line-clamp-2 text-[11px] text-muted-foreground">
            {summary}
          </p>
        ) : (
          <p className="text-[11px] italic text-muted-foreground/60">
            {meta.description}
          </p>
        )}
      </div>

      {/* Source handles (bottom) */}
      {!isTerminal && sourceHandles.length > 0 && (
        <div
          className={cn(
            "flex items-end justify-around border-t border-border/50 px-2 pb-1 pt-1",
            sourceHandles.length === 1 ? "justify-center" : "justify-around",
          )}
        >
          {sourceHandles.map((h) => (
            <div key={h.id} className="relative flex flex-col items-center gap-0.5">
              {h.label && (
                <span className="text-[9px] font-medium text-muted-foreground">
                  {h.label}
                </span>
              )}
              <Handle
                type="source"
                position={Position.Bottom}
                id={h.id}
                className="!relative !bottom-auto !left-auto !right-auto !top-auto !h-3 !w-3 !translate-x-0 !translate-y-0 !border-2 !border-card !bg-primary/70"
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
