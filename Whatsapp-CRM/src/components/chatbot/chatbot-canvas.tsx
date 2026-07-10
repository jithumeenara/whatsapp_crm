"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type OnConnect,
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowDownUp,
  ArrowRightLeft,
  ChevronDown,
  Flag,
  LayoutGrid,
  MousePointer2,
  Hand,
  Trash2,
  X,
  Search,
  ChevronRight,
} from "lucide-react";

import {
  NODE_META,
  PALETTE_GROUPS,
  PALETTE_GROUP_COLORS,
  PALETTE_NODES,
  getSourceHandles,
} from "@/lib/chatbot/node-meta";
import {
  defaultConfigFor,
  type ChatbotBuilderNode,
  type ChatbotNodeType,
} from "@/lib/chatbot/types";
import { useConfirm } from "@/hooks/use-confirm";
import { autoLayout, type LayoutEdge, type LayoutNode } from "@/lib/flows/layout";
import { ChatbotNode } from "./chatbot-node";
import { NodeForm } from "./forms/node-form";

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(" ");
}

/** Channel context so any nested component (nodes, palette) can read the current chatbot's channel */
export const ChatbotChannelContext = createContext<string>('whatsapp')

/** Layout direction context so node cards know which edge to put handles on */
export const ChatbotDirectionContext = createContext<'TB' | 'LR'>('TB')

const NODE_CARD_WIDTH = 230
const NODE_CARD_HEIGHT = 140

const NODE_TYPES = { chatbot: ChatbotNode };

let _nodeCounter = 0;
function genKey(type: ChatbotNodeType) {
  return `${type}_${++_nodeCounter}`;
}

function builderToRf(nodes: ChatbotBuilderNode[], entryId: string | null): Node[] {
  return nodes.map((n) => ({
    id: n.node_key,
    type: "chatbot",
    position: { x: n.position_x, y: n.position_y },
    data: { node_type: n.node_type, config: n.config, isEntry: n.node_key === entryId },
    draggable: true,
    selectable: true,
  }));
}

function deriveEdges(nodes: ChatbotBuilderNode[]): Edge[] {
  const edges: Edge[] = [];
  for (const node of nodes) {
    const cfg = node.config;
    const handles = getSourceHandles(node.node_type, cfg);
    for (const h of handles) {
      let targetKey: string | undefined;
      if (node.node_type === "condition") {
        targetKey = h.id === "true" ? (cfg.true_next as string) : (cfg.false_next as string);
      } else if (node.node_type === "send_buttons" && cfg.mode === "cta") {
        targetKey = (cfg.cta_button as Record<string, unknown> | undefined)?.next_node_key as string | undefined;
      } else if (node.node_type === "send_buttons") {
        const buttons = (cfg.buttons as Array<Record<string, unknown>>) ?? [];
        const btn = buttons.find((b) => String(b.reply_id) === h.id.replace(/^btn_/, ""));
        targetKey = btn?.next_node_key as string | undefined;
      } else if (node.node_type === "send_list") {
        const replyId = h.id.replace(/^row_/, "");
        for (const sec of (cfg.sections as Array<Record<string, unknown>>) ?? []) {
          const row = ((sec.rows as Array<Record<string, unknown>>) ?? []).find((r) => String(r.reply_id) === replyId);
          if (row) { targetKey = row.next_node_key as string; break; }
        }
      } else if (node.node_type === "http_request") {
        targetKey = h.id === "error" ? (cfg.error_node_key as string) : (cfg.next_node_key as string);
      } else if (node.node_type === "switch_case") {
        const cases = (cfg.cases as Array<Record<string, unknown>>) ?? [];
        if (h.id === "default") targetKey = cfg.default_next as string;
        else {
          const idx = parseInt(h.id.replace(/^case_/, ""), 10);
          if (!isNaN(idx) && cases[idx]) targetKey = cases[idx].next_node_key as string;
        }
      } else {
        targetKey = cfg.next_node_key as string;
      }
      if (targetKey) {
        edges.push({
          id: `${node.node_key}-${h.id}->${targetKey}`,
          source: node.node_key,
          sourceHandle: h.id,
          target: targetKey,
          label: h.label,
          labelStyle: { fontSize: 10, fill: "#94a3b8" },
          labelBgStyle: { fill: "#f8fafc", fillOpacity: 0.9 },
          style: { stroke: "#818cf8", strokeWidth: 2 },
          type: "smoothstep",
          animated: false,
        });
      }
    }
  }
  return edges;
}

// CSS vars that force all shadcn components inside the panel to render in light mode,
// regardless of the global dark theme the user may have selected.
const LIGHT_PANEL_VARS: React.CSSProperties = {
  "--background":           "oklch(1 0 0)",
  "--foreground":           "oklch(0.16 0.015 256)",
  "--card":                 "oklch(1 0 0)",
  "--card-foreground":      "oklch(0.16 0.015 256)",
  "--popover":              "oklch(1 0 0)",
  "--popover-foreground":   "oklch(0.16 0.015 256)",
  "--muted":                "oklch(0.965 0.002 256)",
  "--muted-foreground":     "oklch(0.52 0.01 256)",
  "--border":               "oklch(0.918 0.003 256)",
  "--input":                "oklch(0.918 0.003 256)",
  "--primary":              "oklch(0.585 0.22 266)",
  "--primary-foreground":   "oklch(1 0 0)",
  "--secondary":            "oklch(0.965 0.002 256)",
  "--secondary-foreground": "oklch(0.16 0.015 256)",
  "--accent":               "oklch(0.965 0.002 256)",
  "--accent-foreground":    "oklch(0.16 0.015 256)",
  "--ring":                 "oklch(0.585 0.22 266)",
  "--destructive":          "oklch(0.577 0.245 27.325)",
  "--radius":               "0.625rem",
} as React.CSSProperties;

// ─── Inner canvas ────────────────────────────────────────────────

interface CanvasProps {
  nodes: ChatbotBuilderNode[];
  entryNodeId: string | null;
  onChange: (nodes: ChatbotBuilderNode[]) => void;
  onEntryChange: (key: string) => void;
}

function CanvasInner({ nodes: builderNodes, entryNodeId, onChange, onEntryChange }: CanvasProps) {
  const { screenToFlowPosition, fitView } = useReactFlow();
  const confirm = useConfirm();

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(builderToRf(builderNodes, entryNodeId));
  const [rfEdges, setRfEdges] = useEdgesState(deriveEdges(builderNodes));
  const [interactionMode, setInteractionMode] = useState<"pan" | "select">("pan");
  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const [direction, setDirection] = useState<"TB" | "LR">("TB");
  const sheetNode = builderNodes.find((n) => n.node_key === sheetKey) ?? null;

  const toggleDirection = useCallback(async () => {
    const nextDirection = direction === "TB" ? "LR" : "TB";
    const yes = await confirm({
      title: `Switch to ${nextDirection === "LR" ? "left-to-right" : "top-to-bottom"} layout?`,
      description: "This automatically re-arranges every node's position. Any manual dragging you've done will be replaced.",
      confirmLabel: "Switch",
    });
    if (!yes) return;

    const layoutNodes: LayoutNode[] = builderNodes.map((n) => {
      // Mirrors chatbot-node.tsx's width-growth formula for switch_case /
      // send_list in TB mode so dagre spaces wide nodes apart correctly.
      const growsWithHandles =
        nextDirection === "TB" && (n.node_type === "switch_case" || n.node_type === "send_list");
      const width = growsWithHandles
        ? Math.min(230 + Math.max(0, getSourceHandles(n.node_type, n.config).length - 3) * 60, 420)
        : NODE_CARD_WIDTH;
      return { id: n.node_key, width, height: NODE_CARD_HEIGHT };
    });
    const layoutEdges: LayoutEdge[] = deriveEdges(builderNodes).map((e) => ({
      source: e.source,
      target: e.target,
    }));
    const positions = autoLayout(layoutNodes, layoutEdges, {
      direction: nextDirection,
      defaultWidth: NODE_CARD_WIDTH,
      defaultHeight: NODE_CARD_HEIGHT,
    });
    const updated = builderNodes.map((n) => {
      const pos = positions.get(n.node_key);
      if (!pos) return n;
      return { ...n, position_x: Math.round(pos.x), position_y: Math.round(pos.y) };
    });
    setDirection(nextDirection);
    onChange(updated);
    requestAnimationFrame(() => fitView({ padding: 0.25, duration: 400 }));
  }, [builderNodes, confirm, direction, fitView, onChange]);

  const prevBuilderRef = useRef(builderNodes);
  useEffect(() => {
    if (prevBuilderRef.current === builderNodes) return;
    prevBuilderRef.current = builderNodes;
    setRfNodes(builderToRf(builderNodes, entryNodeId));
    setRfEdges(deriveEdges(builderNodes));
  }, [builderNodes, entryNodeId, setRfNodes, setRfEdges]);

  const onConnect: OnConnect = useCallback((connection: Connection) => {
    const { source, sourceHandle, target } = connection;
    if (!source || !target) return;
    const updated = builderNodes.map((n) => {
      if (n.node_key !== source) return n;
      const cfg = { ...n.config };
      if (n.node_type === "condition") {
        if (sourceHandle === "true") cfg.true_next = target; else cfg.false_next = target;
      } else if (n.node_type === "send_buttons" && n.config.mode === "cta") {
        cfg.cta_button = { ...((cfg.cta_button as object) ?? {}), next_node_key: target };
      } else if (n.node_type === "send_buttons") {
        const replyId = (sourceHandle ?? "").replace(/^btn_/, "");
        const buttons = [...((cfg.buttons as Array<Record<string, unknown>>) ?? [])];
        const idx = buttons.findIndex((b) => String(b.reply_id) === replyId);
        if (idx !== -1) buttons[idx] = { ...buttons[idx], next_node_key: target };
        cfg.buttons = buttons;
      } else if (n.node_type === "send_list") {
        const replyId = (sourceHandle ?? "").replace(/^row_/, "");
        const sections = JSON.parse(JSON.stringify(cfg.sections ?? [])) as Array<Record<string, unknown>>;
        for (const sec of sections) {
          const rows = (sec.rows as Array<Record<string, unknown>>) ?? [];
          const ri = rows.findIndex((r) => String(r.reply_id) === replyId);
          if (ri !== -1) { rows[ri] = { ...rows[ri], next_node_key: target }; break; }
        }
        cfg.sections = sections;
      } else if (n.node_type === "http_request") {
        if (sourceHandle === "error") cfg.error_node_key = target; else cfg.next_node_key = target;
      } else if (n.node_type === "switch_case") {
        const cases = JSON.parse(JSON.stringify(cfg.cases ?? [])) as Array<Record<string, unknown>>;
        if (sourceHandle === "default") cfg.default_next = target;
        else {
          const idx = parseInt((sourceHandle ?? "").replace(/^case_/, ""), 10);
          if (!isNaN(idx) && cases[idx]) { cases[idx] = { ...cases[idx], next_node_key: target }; cfg.cases = cases; }
        }
      } else {
        cfg.next_node_key = target;
      }
      return { ...n, config: cfg };
    });
    onChange(updated);
    setRfEdges(deriveEdges(updated));
  }, [builderNodes, onChange, setRfEdges]);

  const onNodeDragStop: OnNodeDrag = useCallback((_, rfNode) => {
    const updated = builderNodes.map((n) =>
      n.node_key === rfNode.id
        ? { ...n, position_x: Math.round(rfNode.position.x), position_y: Math.round(rfNode.position.y) }
        : n,
    );
    onChange(updated);
  }, [builderNodes, onChange]);

  const deleteNodes = useCallback(async (keysToRemove: Set<string>) => {
    const count = keysToRemove.size;
    const yes = await confirm({
      title: `Delete ${count === 1 ? `"${[...keysToRemove][0]}"` : `${count} nodes`}?`,
      description: "Connected edges will also be removed.",
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!yes) return;
    const remaining = builderNodes.filter((n) => !keysToRemove.has(n.node_key));
    const cleaned = remaining.map((n) => {
      const cfg = JSON.parse(JSON.stringify(n.config)) as Record<string, unknown>;
      function clearRef(obj: Record<string, unknown>) {
        for (const k of Object.keys(obj)) {
          if (typeof obj[k] === "string" && keysToRemove.has(obj[k] as string)) obj[k] = "";
          else if (Array.isArray(obj[k])) {
            for (const item of obj[k] as unknown[])
              if (typeof item === "object" && item !== null) clearRef(item as Record<string, unknown>);
          } else if (typeof obj[k] === "object" && obj[k] !== null) clearRef(obj[k] as Record<string, unknown>);
        }
      }
      clearRef(cfg);
      return { ...n, config: cfg };
    });
    onChange(cleaned);
    if (sheetKey && keysToRemove.has(sheetKey)) setSheetKey(null);
  }, [builderNodes, onChange, sheetKey, confirm]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    const selected = rfNodes.filter((n) => n.selected);
    if (selected.length === 0) return;
    e.preventDefault();
    const keysToRemove = new Set(selected.map((n) => n.id));
    keysToRemove.delete("start");
    if (keysToRemove.size === 0) return;
    void deleteNodes(keysToRemove);
  }, [rfNodes, deleteNodes]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("chatbot/node_type") as ChatbotNodeType;
    if (!type) return;
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const key = genKey(type);
    onChange([...builderNodes, {
      node_key: key,
      node_type: type,
      config: defaultConfigFor(type),
      position_x: Math.round(pos.x),
      position_y: Math.round(pos.y),
    }]);
  }, [builderNodes, onChange, screenToFlowPosition]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onNodeClick = useCallback((_: React.MouseEvent, rfNode: Node) => {
    setSheetKey(rfNode.id);
  }, []);

  const handleConfigChange = useCallback((key: string, cfg: Record<string, unknown>) => {
    const updated = builderNodes.map((n) => n.node_key === key ? { ...n, config: cfg } : n);
    onChange(updated);
    setRfEdges(deriveEdges(updated));
  }, [builderNodes, onChange, setRfEdges]);

  return (
    <ChatbotDirectionContext.Provider value={direction}>
    <div className="relative h-full w-full outline-none" tabIndex={-1} onKeyDown={handleKeyDown}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onDrop={onDrop}
        onDragOver={onDragOver}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        deleteKeyCode={null}
        panOnDrag={interactionMode === "pan"}
        selectionOnDrag={interactionMode === "select"}
        multiSelectionKeyCode="Meta"
        selectionKeyCode="Shift"
        className="bg-[#D6DDEF]"
        edgesFocusable={false}
        nodesDraggable
        nodesConnectable
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.8} color="#9aabc7" />

        <Controls
          showInteractive={false}
          className="!bottom-6 !left-4 !border-0 !bg-transparent !shadow-none [&>button]:!mb-1 [&>button]:!flex [&>button]:!h-8 [&>button]:!w-8 [&>button]:!items-center [&>button]:!justify-center [&>button]:!rounded-xl [&>button]:!border [&>button]:!border-slate-200 [&>button]:!bg-white [&>button]:!shadow-sm [&>button]:!fill-slate-600 [&>button:hover]:!bg-slate-50"
        />

        <MiniMap
          nodeStrokeWidth={0}
          className="!bottom-6 !right-4 !overflow-hidden !rounded-xl !border !border-slate-200 !bg-white !shadow-lg"
          maskColor="rgba(248,250,252,0.7)"
          nodeColor={(n) => {
            const nd = n.data as { node_type?: string };
            const meta = nd.node_type ? NODE_META[nd.node_type as ChatbotNodeType] : null;
            return meta ? "#6366f1" : "#cbd5e1";
          }}
        />

        {/* Pan / Select / Fit toolbar — shifted left when the node edit
            panel (z-20, 380px wide, right-0) is open so it isn't covered. */}
        <Panel
          position="top-right"
          className={cn("flex items-center gap-2 !top-3", sheetNode ? "!right-[396px]" : "!right-3")}
        >
          <div className="flex gap-0.5 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setInteractionMode("pan")}
              title="Pan mode"
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-all",
                interactionMode === "pan"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-800",
              )}
            >
              <Hand className="h-3 w-3" />
              Pan
            </button>
            <button
              type="button"
              onClick={() => setInteractionMode("select")}
              title="Select mode"
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-all",
                interactionMode === "select"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-800",
              )}
            >
              <MousePointer2 className="h-3 w-3" />
              Select
            </button>
          </div>
          <button
            type="button"
            onClick={() => fitView({ padding: 0.25, duration: 400 })}
            className="flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Fit view
          </button>
          <button
            type="button"
            onClick={() => void toggleDirection()}
            title="Switch node flow direction — re-arranges every node"
            className="flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
          >
            {direction === "TB" ? (
              <ArrowDownUp className="h-3.5 w-3.5" />
            ) : (
              <ArrowRightLeft className="h-3.5 w-3.5" />
            )}
            {direction === "TB" ? "Top-Bottom" : "Left-Right"}
          </button>
        </Panel>

        {interactionMode === "select" && (
          <Panel position="bottom-center" className="!bottom-6">
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/90 px-4 py-2 text-[11px] font-medium text-indigo-600 shadow-sm backdrop-blur-sm">
              Drag to box-select · Shift+click to add · Delete key to remove
            </div>
          </Panel>
        )}
      </ReactFlow>

      {/* Node edit panel */}
      {sheetNode && (
        <div
          className="absolute inset-y-0 right-0 z-20 flex w-[380px] flex-col overflow-hidden bg-white shadow-[−4px_0_32px_rgba(0,0,0,0.08)]"
          style={LIGHT_PANEL_VARS}
        >
          {/* Panel header */}
          <div className="flex shrink-0 flex-col gap-1 border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-sm", NODE_META[sheetNode.node_type].bg)}>
                {(() => {
                  const Icon = NODE_META[sheetNode.node_type].icon;
                  return <Icon className={cn("h-4.5 w-4.5", NODE_META[sheetNode.node_type].color)} />;
                })()}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-[14px] font-bold text-slate-900">
                  {NODE_META[sheetNode.node_type].label}
                </h3>
                <p className="text-[11px] text-slate-400">
                  {NODE_META[sheetNode.node_type].group}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {sheetNode.node_type !== "start" && (
                  <button
                    type="button"
                    onClick={() => void (async () => {
                      const ok = await confirm({ title: "Delete node?", description: "This cannot be undone.", confirmLabel: "Delete", variant: "destructive" });
                      if (ok) { onChange(builderNodes.filter((n) => n.node_key !== sheetNode.node_key)); setSheetKey(null); }
                    })()}
                    title="Delete node"
                    className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-500 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSheetKey(null)}
                  title="Close"
                  className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Entry + description row */}
            <div className="flex items-center gap-2 pt-1">
              <p className="flex-1 text-[11px] text-slate-500 leading-relaxed">
                {NODE_META[sheetNode.node_type].description}
              </p>
              {sheetNode.node_key !== entryNodeId && (
                <button
                  type="button"
                  onClick={() => { onEntryChange(sheetNode.node_key); setSheetKey(null); }}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100 transition-colors"
                >
                  <Flag className="h-3 w-3" />
                  Set entry
                </button>
              )}
              {sheetNode.node_key === entryNodeId && (
                <span className="flex shrink-0 items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Entry node
                </span>
              )}
            </div>
          </div>

          {/* Form */}
          <div className="flex-1 overflow-y-auto px-5 py-5">
            <NodeForm
              node={sheetNode}
              allNodes={builderNodes}
              onChange={(cfg) => handleConfigChange(sheetNode.node_key, cfg)}
            />
          </div>
        </div>
      )}
    </div>
    </ChatbotDirectionContext.Provider>
  );
}

// ─── Node palette sidebar ────────────────────────────────────────

/** Node types that are exclusive to WhatsApp and must be hidden for Instagram chatbots */
const WHATSAPP_ONLY_NODES = new Set<string>([
  // send_buttons IS available on Instagram via Quick Replies API
  'send_list',      // WhatsApp interactive list menus — not supported on Instagram
  'send_template',  // WhatsApp HSM templates — not supported on Instagram
  'send_flow',      // Meta WhatsApp Flows — not supported on Instagram
  'send_to_number', // WhatsApp notification to arbitrary number — not supported on Instagram
])

function NodePalette({ channel = 'whatsapp' }: { channel?: string }) {
  const [query, setQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(PALETTE_GROUPS.slice(0, 2)),
  );

  const availableNodes = useMemo(() =>
    channel === 'instagram'
      ? PALETTE_NODES.filter((t) => !WHATSAPP_ONLY_NODES.has(t))
      : PALETTE_NODES,
  [channel])

  const grouped = useMemo(() => {
    const map = new Map<string, typeof PALETTE_NODES>(PALETTE_GROUPS.map((g) => [g, []]));
    for (const type of availableNodes) {
      map.get(NODE_META[type].group)?.push(type);
    }
    return Array.from(map.entries()).filter(([, items]) => items.length > 0);
  }, [availableNodes]);

  const filtered = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase();
    return availableNodes.filter((type) => {
      const meta = NODE_META[type];
      return meta.label.toLowerCase().includes(q) || meta.group.toLowerCase().includes(q);
    });
  }, [query, availableNodes]);

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group); else next.add(group);
      return next;
    });
  };

  const onDragStart = (e: React.DragEvent, type: ChatbotNodeType) => {
    e.dataTransfer.setData("chatbot/node_type", type);
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div className="flex h-full w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      {/* Header */}
      <div className="border-b border-slate-100 px-4 py-3">
        <p className="text-[12px] font-bold text-slate-800">Node Palette</p>
        <p className="text-[10px] text-slate-400">Drag nodes onto the canvas</p>
      </div>

      {/* Search */}
      <div className="border-b border-slate-100 px-3 py-2.5">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search nodes…"
            className="flex-1 bg-transparent text-[12px] text-slate-700 placeholder:text-slate-400 focus:outline-none"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-slate-400 hover:text-slate-600">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Node list */}
      <div className="flex-1 overflow-y-auto py-1">
        {filtered ? (
          /* Search results */
          <div className="px-2 py-1">
            {filtered.length === 0 ? (
              <p className="px-2 py-4 text-center text-[11px] text-slate-400">No nodes match "{query}"</p>
            ) : (
              filtered.map((type) => <PaletteItem key={type} type={type} onDragStart={onDragStart} />)
            )}
          </div>
        ) : (
          /* Grouped */
          grouped.map(([group, types]) => {
            const isOpen = expandedGroups.has(group);
            const color = PALETTE_GROUP_COLORS[group as keyof typeof PALETTE_GROUP_COLORS];
            return (
              <div key={group} className="border-b border-slate-100 last:border-0">
                <button
                  type="button"
                  onClick={() => toggleGroup(group)}
                  className="flex w-full items-center justify-between px-4 py-2.5 hover:bg-slate-50 transition-colors"
                >
                  <span className={cn("text-[10px] font-bold uppercase tracking-widest", isOpen ? color : "text-slate-400")}>
                    {group}
                  </span>
                  <div className={cn("flex items-center gap-1", isOpen ? color : "text-slate-300")}>
                    <span className="text-[10px] font-medium">{types.length}</span>
                    <ChevronDown className={cn("h-3 w-3 transition-transform", isOpen ? "rotate-0" : "-rotate-90")} />
                  </div>
                </button>
                <div className={cn("overflow-hidden transition-all duration-200", isOpen ? "max-h-[500px]" : "max-h-0")}>
                  <div className="px-2 pb-2">
                    {types.map((type) => <PaletteItem key={type} type={type} onDragStart={onDragStart} />)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function PaletteItem({
  type,
  onDragStart,
}: {
  type: ChatbotNodeType;
  onDragStart: (e: React.DragEvent, type: ChatbotNodeType) => void;
}) {
  const meta = NODE_META[type];
  const Icon = meta.icon;
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, type)}
      className="mb-0.5 flex cursor-grab items-center gap-2.5 rounded-xl border border-transparent p-2 hover:border-slate-200 hover:bg-slate-50 active:cursor-grabbing select-none transition-all group"
      title={meta.description}
    >
      <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg shadow-sm transition-transform group-hover:scale-105", meta.bg)}>
        <Icon className={cn("h-3.5 w-3.5", meta.color)} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-slate-700 leading-tight">{meta.label}</p>
      </div>
      <ChevronRight className="ml-auto h-3 w-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
}

// ─── Public export ───────────────────────────────────────────────

interface ChatbotCanvasProps {
  nodes: ChatbotBuilderNode[];
  entryNodeId: string | null;
  onChange: (nodes: ChatbotBuilderNode[]) => void;
  onEntryChange: (key: string) => void;
  channel?: string;
}

export function ChatbotCanvas({ channel = 'whatsapp', ...props }: ChatbotCanvasProps) {
  return (
    <ChatbotChannelContext.Provider value={channel}>
      <div className="flex h-full w-full overflow-hidden">
        <NodePalette channel={channel} />
        <ReactFlowProvider>
          <CanvasInner {...props} />
        </ReactFlowProvider>
      </div>
    </ChatbotChannelContext.Provider>
  );
}
