"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
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
  Copy,
  CornerDownRight,
  Settings2,
} from "lucide-react";

import {
  NODE_META,
  PALETTE_GROUPS,
  PALETTE_GROUP_COLORS,
  PALETTE_NODES,
  getSourceHandles,
  CHANNEL_INCOMPATIBLE_NODES,
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

/** Every connection line gets a small red X at its midpoint to disconnect
 * it (with confirmation, wired up via `data.onDisconnect` — see
 * CanvasInner, which injects it per-edge since deriveEdges below is a pure
 * function with no access to component state/callbacks). */
function ChatbotEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  style, label, labelStyle, data,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  });
  const onDisconnect = (data as { onDisconnect?: () => void } | undefined)?.onDisconnect;
  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan absolute flex items-center gap-1"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: "all" }}
        >
          {label ? (
            <span
              className="rounded border border-slate-200 bg-white/95 px-1 text-[10px] shadow-sm"
              style={labelStyle as React.CSSProperties}
            >
              {label}
            </span>
          ) : null}
          <button
            type="button"
            onClick={onDisconnect}
            title="Disconnect"
            className="flex h-4 w-4 items-center justify-center rounded-full border border-rose-200 bg-white text-rose-500 shadow-sm transition-colors hover:bg-rose-50 hover:border-rose-300"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const EDGE_TYPES = { chatbot: ChatbotEdge };

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
          type: "chatbot",
          animated: false,
        });
      }
    }
  }
  return edges;
}

/** Sets the target node-key for one outgoing handle of one node, matching
 * exactly which config field each node type stores that handle's target
 * in (mirrors deriveEdges' per-type extraction above — keep both in sync).
 * Shared by onConnect (drag a wire), the edge disconnect button (target
 * ""), and the right-click "Next node" picker (target any node) below, so
 * this branching only has to be gotten right in one place. */
function applyNodeTarget(
  nodes: ChatbotBuilderNode[],
  sourceKey: string,
  sourceHandle: string | null | undefined,
  targetKey: string,
): ChatbotBuilderNode[] {
  return nodes.map((n) => {
    if (n.node_key !== sourceKey) return n;
    const cfg = { ...n.config } as Record<string, unknown>;
    if (n.node_type === "condition") {
      if (sourceHandle === "true") cfg.true_next = targetKey; else cfg.false_next = targetKey;
    } else if (n.node_type === "send_buttons" && cfg.mode === "cta") {
      cfg.cta_button = { ...((cfg.cta_button as object) ?? {}), next_node_key: targetKey };
    } else if (n.node_type === "send_buttons") {
      const replyId = (sourceHandle ?? "").replace(/^btn_/, "");
      const buttons = [...((cfg.buttons as Array<Record<string, unknown>>) ?? [])];
      const idx = buttons.findIndex((b) => String(b.reply_id) === replyId);
      if (idx !== -1) buttons[idx] = { ...buttons[idx], next_node_key: targetKey };
      cfg.buttons = buttons;
    } else if (n.node_type === "send_list") {
      const replyId = (sourceHandle ?? "").replace(/^row_/, "");
      const sections = JSON.parse(JSON.stringify(cfg.sections ?? [])) as Array<Record<string, unknown>>;
      for (const sec of sections) {
        const rows = (sec.rows as Array<Record<string, unknown>>) ?? [];
        const ri = rows.findIndex((r) => String(r.reply_id) === replyId);
        if (ri !== -1) { rows[ri] = { ...rows[ri], next_node_key: targetKey }; break; }
      }
      cfg.sections = sections;
    } else if (n.node_type === "http_request") {
      if (sourceHandle === "error") cfg.error_node_key = targetKey; else cfg.next_node_key = targetKey;
    } else if (n.node_type === "switch_case") {
      const cases = JSON.parse(JSON.stringify(cfg.cases ?? [])) as Array<Record<string, unknown>>;
      if (sourceHandle === "default") cfg.default_next = targetKey;
      else {
        const idx = parseInt((sourceHandle ?? "").replace(/^case_/, ""), 10);
        if (!isNaN(idx) && cases[idx]) { cases[idx] = { ...cases[idx], next_node_key: targetKey }; cfg.cases = cases; }
      }
    } else {
      cfg.next_node_key = targetKey;
    }
    return { ...n, config: cfg };
  });
}

/** Reads back the current target for one outgoing handle — the inverse of
 * applyNodeTarget, used to show "currently pointing at X" in the
 * right-click Next-node picker. */
function getHandleTarget(node: ChatbotBuilderNode, handleId: string): string {
  const cfg = node.config as Record<string, unknown>;
  if (node.node_type === "condition") {
    return ((handleId === "true" ? cfg.true_next : cfg.false_next) as string) ?? "";
  }
  if (node.node_type === "send_buttons") {
    if (cfg.mode === "cta") return ((cfg.cta_button as Record<string, unknown> | undefined)?.next_node_key as string) ?? "";
    const replyId = handleId.replace(/^btn_/, "");
    const btn = ((cfg.buttons as Array<Record<string, unknown>>) ?? []).find((b) => String(b.reply_id) === replyId);
    return (btn?.next_node_key as string) ?? "";
  }
  if (node.node_type === "send_list") {
    const replyId = handleId.replace(/^row_/, "");
    for (const sec of (cfg.sections as Array<Record<string, unknown>>) ?? []) {
      const row = ((sec.rows as Array<Record<string, unknown>>) ?? []).find((r) => String(r.reply_id) === replyId);
      if (row) return (row.next_node_key as string) ?? "";
    }
    return "";
  }
  if (node.node_type === "http_request") {
    return ((handleId === "error" ? cfg.error_node_key : cfg.next_node_key) as string) ?? "";
  }
  if (node.node_type === "switch_case") {
    if (handleId === "default") return (cfg.default_next as string) ?? "";
    const idx = parseInt(handleId.replace(/^case_/, ""), 10);
    const cases = (cfg.cases as Array<Record<string, unknown>>) ?? [];
    return (cases[idx]?.next_node_key as string) ?? "";
  }
  return (cfg.next_node_key as string) ?? "";
}

// Field names that mean "connection to another node" or "which variable
// this writes to" across every node config shape in this file (see the
// per-node-type branches in deriveEdges/onConnect above for where each one
// is set). Shared by node duplication below — a duplicate should keep the
// node's own content but not silently share a wire or a variable slot with
// the original.
const CONNECTION_FIELD_NAMES = new Set([
  "next_node_key", "true_next", "false_next", "error_node_key", "default_next",
]);
const VARIABLE_FIELD_NAMES = new Set(["save_reply_to", "var_key"]);

/** Deep-clones a node config for duplication, clearing every connection
 * and variable-target field found anywhere in the tree (button lists,
 * list-section rows, switch cases, cta_button, assignments, etc.) — the
 * duplicate keeps the original's text/media/labels but starts unwired and
 * writes to no variable until the user configures it. */
function cloneConfigForDuplicate(cfg: Record<string, unknown>): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(cfg)) as Record<string, unknown>;
  function strip(value: unknown): void {
    if (Array.isArray(value)) { value.forEach(strip); return; }
    if (value && typeof value === "object") {
      const rec = value as Record<string, unknown>;
      for (const key of Object.keys(rec)) {
        if (CONNECTION_FIELD_NAMES.has(key)) { rec[key] = ""; continue; }
        if (VARIABLE_FIELD_NAMES.has(key)) { rec[key] = ""; continue; }
        strip(rec[key]);
      }
    }
  }
  strip(cloned);
  return cloned;
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
  const [quickAdd, setQuickAdd] = useState<{ screenX: number; screenY: number; flowX: number; flowY: number } | null>(null);
  const [nodeMenu, setNodeMenu] = useState<{ screenX: number; screenY: number; nodeKey: string } | null>(null);
  const channel = useContext(ChatbotChannelContext);
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
    const updated = applyNodeTarget(builderNodes, source, sourceHandle, target);
    onChange(updated);
    setRfEdges(deriveEdges(updated));
  }, [builderNodes, onChange, setRfEdges]);

  // Clears one edge's underlying "next node" field — same applyNodeTarget
  // helper as onConnect above, just targeting "" instead of a real key.
  const handleDisconnectEdge = useCallback(async (source: string, sourceHandle: string | null | undefined) => {
    const yes = await confirm({
      title: "Disconnect this connection?",
      description: "The node will no longer point to this next step — you can rewire it any time.",
      confirmLabel: "Disconnect",
      variant: "destructive",
    });
    if (!yes) return;
    onChange(applyNodeTarget(builderNodes, source, sourceHandle, ""));
  }, [builderNodes, onChange, confirm]);

  // Inject the per-edge disconnect callback here (deriveEdges is a pure
  // function with no access to component state) rather than baking it into
  // rfEdges directly — keeps deriveEdges reusable for the plain-data
  // autoLayout call in toggleDirection above.
  const edgesForCanvas = useMemo(
    () => rfEdges.map((e) => ({
      ...e,
      data: { ...e.data, onDisconnect: () => void handleDisconnectEdge(e.source, e.sourceHandle) },
    })),
    [rfEdges, handleDisconnectEdge],
  );

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

  // Shared by drag-drop from the palette and the right-click quick-add menu.
  const addNodeAt = useCallback((type: ChatbotNodeType, flowX: number, flowY: number) => {
    const key = genKey(type);
    onChange([...builderNodes, {
      node_key: key,
      node_type: type,
      config: defaultConfigFor(type),
      position_x: Math.round(flowX),
      position_y: Math.round(flowY),
    }]);
  }, [builderNodes, onChange]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("chatbot/node_type") as ChatbotNodeType;
    if (!type) return;
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addNodeAt(type, pos.x, pos.y);
  }, [addNodeAt, screenToFlowPosition]);

  const duplicateNode = useCallback((nodeKey: string) => {
    const original = builderNodes.find((n) => n.node_key === nodeKey);
    if (!original) return;
    const newKey = genKey(original.node_type);
    onChange([...builderNodes, {
      node_key: newKey,
      node_type: original.node_type,
      config: cloneConfigForDuplicate(original.config as Record<string, unknown>),
      position_x: original.position_x + 40,
      position_y: original.position_y + 40,
    }]);
    // Open the new node's properties right away — its content is copied
    // but it's unwired (no next-node, no target variable), so the natural
    // next step is to review/connect it.
    setSheetKey(newKey);
  }, [builderNodes, onChange]);

  // Right-click "Next node" picker — sets one specific handle's target,
  // reusing the exact same per-node-type logic drag-connecting a wire uses.
  const setHandleTarget = useCallback((nodeKey: string, sourceHandle: string, targetKey: string) => {
    onChange(applyNodeTarget(builderNodes, nodeKey, sourceHandle, targetKey));
  }, [builderNodes, onChange]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  // Right-click on blank canvas space — quick-add menu with search, so
  // adding a node doesn't require finding it in the palette sidebar.
  const onPaneContextMenu = useCallback((e: MouseEvent | React.MouseEvent) => {
    e.preventDefault();
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setQuickAdd({ screenX: e.clientX, screenY: e.clientY, flowX: pos.x, flowY: pos.y });
  }, [screenToFlowPosition]);

  // Right-click on a node — Duplicate / Next node / Delete.
  const onNodeContextMenu = useCallback((e: React.MouseEvent, rfNode: Node) => {
    e.preventDefault();
    setNodeMenu({ screenX: e.clientX, screenY: e.clientY, nodeKey: rfNode.id });
  }, []);

  // Double-click opens the properties panel — single click only selects the
  // node (xyflow's default click behavior), so a quick click-to-select-and-
  // -drag doesn't also pop the panel open every time.
  const onNodeDoubleClick = useCallback((_: React.MouseEvent, rfNode: Node) => {
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
        edges={edgesForCanvas}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeContextMenu={onNodeContextMenu}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onPaneContextMenu={onPaneContextMenu}
        onPaneClick={() => { setQuickAdd(null); setNodeMenu(null); }}
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

      {/* Right-click quick-add menu */}
      {quickAdd && (
        <QuickAddMenu
          screenX={quickAdd.screenX}
          screenY={quickAdd.screenY}
          channel={channel}
          onPick={(type) => {
            addNodeAt(type, quickAdd.flowX, quickAdd.flowY);
            setQuickAdd(null);
          }}
          onClose={() => setQuickAdd(null)}
        />
      )}

      {/* Right-click node menu — Duplicate / Next node / Delete */}
      {nodeMenu && (() => {
        const targetNode = builderNodes.find((n) => n.node_key === nodeMenu.nodeKey);
        if (!targetNode) return null;
        return (
          <NodeContextMenu
            screenX={nodeMenu.screenX}
            screenY={nodeMenu.screenY}
            node={targetNode}
            allNodes={builderNodes}
            onOpenProperties={() => { setSheetKey(nodeMenu.nodeKey); setNodeMenu(null); }}
            onDuplicate={() => { duplicateNode(nodeMenu.nodeKey); setNodeMenu(null); }}
            onSetNext={(handleId, targetKey) => { setHandleTarget(nodeMenu.nodeKey, handleId, targetKey); setNodeMenu(null); }}
            onDelete={() => { void deleteNodes(new Set([nodeMenu.nodeKey])); setNodeMenu(null); }}
            onClose={() => setNodeMenu(null)}
          />
        );
      })()}

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

/** Right-click-on-blank-canvas menu — a searchable list of every node type
 * (respecting the same channel-incompatibility filter as the sidebar
 * palette) so adding a node doesn't require scrolling/hunting through the
 * palette groups. Positioned at the click point, clamped to the viewport. */
/** Right-click-on-a-node menu: Duplicate, Next node (inline searchable
 * sub-list of every other node), Delete. Same positioning/outside-click/
 * Escape handling as QuickAddMenu, kept separate since the two show very
 * different content and duplicating that little bit of plumbing is
 * clearer here than threading a "mode" prop through one shared component. */
function NodeContextMenu({
  screenX,
  screenY,
  node,
  allNodes,
  onOpenProperties,
  onDuplicate,
  onSetNext,
  onDelete,
  onClose,
}: {
  screenX: number;
  screenY: number;
  node: ChatbotBuilderNode;
  allNodes: ChatbotBuilderNode[];
  onOpenProperties: () => void;
  onDuplicate: () => void;
  onSetNext: (handleId: string, targetKey: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  // Which handle's picker is expanded — null means none. Node types with
  // more than one outgoing handle (condition's True/False, http_request's
  // Success/Error, send_buttons' per-button targets, switch_case's per-
  // case targets, send_list's per-row targets) get one row per handle
  // instead of a single "Next node" entry, since a single field can't
  // represent "point every branch at once" for those types.
  const [openHandle, setOpenHandle] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  const confirm = useConfirm();

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as globalThis.Node)) onCloseRef.current();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    const t = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
      document.addEventListener("keydown", handleKey);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  const handles = useMemo(() => getSourceHandles(node.node_type, node.config), [node.node_type, node.config]);
  const otherNodes = useMemo(
    () => allNodes.filter((n) => n.node_key !== node.node_key),
    [allNodes, node.node_key],
  );
  const filteredNodes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return otherNodes;
    return otherNodes.filter((n) =>
      n.node_key.toLowerCase().includes(q) || NODE_META[n.node_type].label.toLowerCase().includes(q),
    );
  }, [query, otherNodes]);

  const MENU_W = 224;
  const left = Math.min(screenX, window.innerWidth - MENU_W - 8);
  const top = Math.min(screenY, window.innerHeight - Math.min(380 + handles.length * 32, 520) - 8);

  const handleDelete = async () => {
    const yes = await confirm({
      title: `Delete "${node.node_key}"?`,
      description: "Connected edges will also be removed.",
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (yes) onDelete();
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-30 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
      style={{ left, top }}
    >
      <button
        type="button"
        onClick={onOpenProperties}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[12px] font-medium text-slate-700 hover:bg-slate-50"
      >
        <Settings2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        Properties
      </button>

      <button
        type="button"
        onClick={onDuplicate}
        className="flex w-full items-center gap-2.5 border-t border-slate-100 px-3 py-2.5 text-left text-[12px] font-medium text-slate-700 hover:bg-slate-50"
      >
        <Copy className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        Duplicate
      </button>

      {handles.length > 0 && (
        <div className="border-t border-slate-100">
          {handles.map((h) => {
            const isOpen = openHandle === h.id;
            const currentTarget = getHandleTarget(node, h.id);
            return (
              <div key={h.id} className="border-b border-slate-100 last:border-0">
                <button
                  type="button"
                  onClick={() => { setOpenHandle(isOpen ? null : h.id); setQuery(""); }}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[12px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate">
                    {handles.length > 1 ? (h.label || h.id) : "Next node"}
                  </span>
                  <ChevronRight className={cn("ml-auto h-3.5 w-3.5 shrink-0 text-slate-300 transition-transform", isOpen && "rotate-90")} />
                </button>
                {isOpen && (
                  <div className="bg-slate-50/60">
                    <div className="p-2">
                      <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1">
                        <Search className="h-3 w-3 shrink-0 text-slate-400" />
                        <input
                          autoFocus
                          type="text"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onClose(); }}
                          placeholder="Search nodes…"
                          className="flex-1 bg-transparent text-[11px] text-slate-700 placeholder:text-slate-400 focus:outline-none"
                        />
                      </div>
                    </div>
                    <div className="max-h-40 overflow-y-auto px-1.5 pb-1.5">
                      {filteredNodes.length === 0 ? (
                        <p className="px-2 py-3 text-center text-[11px] text-slate-400">No nodes match</p>
                      ) : (
                        filteredNodes.map((n) => {
                          const meta = NODE_META[n.node_type];
                          const Icon = meta.icon;
                          return (
                            <button
                              key={n.node_key}
                              type="button"
                              onClick={() => onSetNext(h.id, n.node_key)}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-lg p-1.5 text-left hover:bg-white transition-colors",
                                currentTarget === n.node_key && "bg-indigo-50",
                              )}
                            >
                              <div className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-md", meta.bg)}>
                                <Icon className={cn("h-3 w-3", meta.color)} />
                              </div>
                              <span className="min-w-0 truncate text-[11px] font-medium text-slate-700">{meta.label}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {node.node_type !== "start" && (
        <button
          type="button"
          onClick={() => void handleDelete()}
          className="flex w-full items-center gap-2.5 border-t border-slate-100 px-3 py-2.5 text-left text-[12px] font-medium text-rose-600 hover:bg-rose-50"
        >
          <Trash2 className="h-3.5 w-3.5 shrink-0" />
          Delete node
        </button>
      )}
    </div>
  );
}

function QuickAddMenu({
  screenX,
  screenY,
  channel,
  onPick,
  onClose,
}: {
  screenX: number;
  screenY: number;
  channel: string;
  onPick: (type: ChatbotNodeType) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Ref instead of a dep on the (inline, identity-changes-every-render)
  // onClose prop — keeps the listener-attach effect below from tearing
  // down and re-running on every parent re-render while the menu is open,
  // which was starving the mousedown/keydown listeners from ever staying
  // attached and made the menu feel like it randomly ate keystrokes/clicks.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as globalThis.Node)) onCloseRef.current();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    // Delay attaching so the same right-click that opened the menu doesn't
    // immediately trigger handleClick and close it again.
    const t = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
      document.addEventListener("keydown", handleKey);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  const available = useMemo(() => {
    const incompatible = CHANNEL_INCOMPATIBLE_NODES[channel];
    return incompatible ? PALETTE_NODES.filter((t) => !incompatible.has(t)) : PALETTE_NODES;
  }, [channel]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return available;
    return available.filter((type) => {
      const meta = NODE_META[type];
      return meta.label.toLowerCase().includes(q) || meta.group.toLowerCase().includes(q);
    });
  }, [query, available]);

  // Clamp so the menu doesn't render off-screen when right-clicking near an edge.
  const MENU_W = 240;
  const MENU_H = 340;
  const left = Math.min(screenX, window.innerWidth - MENU_W - 8);
  const top = Math.min(screenY, window.innerHeight - MENU_H - 8);

  return (
    <div
      ref={menuRef}
      className="fixed z-30 flex max-h-[340px] w-60 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
      style={{ left, top }}
    >
      <div className="shrink-0 border-b border-slate-100 px-2.5 py-2">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // Stop every keystroke here from reaching the canvas's own
            // Delete/Backspace-to-remove-node handler (and any xyflow
            // internal shortcut handling) — without this, typing letters
            // that happen to be shortcut keys could get intercepted instead
            // of landing in the input. Escape is handled locally so it
            // still closes the menu even though propagation is stopped.
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onClose(); }}
            placeholder="Search nodes to add…"
            className="flex-1 bg-transparent text-[12px] text-slate-700 placeholder:text-slate-400 focus:outline-none"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
        {filtered.length === 0 ? (
          <p className="px-2 py-4 text-center text-[11px] text-slate-400">No nodes match &quot;{query}&quot;</p>
        ) : (
          filtered.map((type) => {
            const meta = NODE_META[type];
            const Icon = meta.icon;
            return (
              <button
                key={type}
                type="button"
                onClick={() => onPick(type)}
                className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left hover:bg-slate-50 transition-colors"
              >
                <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg shadow-sm", meta.bg)}>
                  <Icon className={cn("h-3.5 w-3.5", meta.color)} />
                </div>
                <span className="min-w-0 truncate text-[11px] font-semibold text-slate-700">{meta.label}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function NodePalette({ channel = 'whatsapp' }: { channel?: string }) {
  const [query, setQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(PALETTE_GROUPS.slice(0, 2)),
  );

  const availableNodes = useMemo(() => {
    const incompatible = CHANNEL_INCOMPATIBLE_NODES[channel]
    return incompatible ? PALETTE_NODES.filter((t) => !incompatible.has(t)) : PALETTE_NODES
  }, [channel])

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
              <p className="px-2 py-4 text-center text-[11px] text-slate-400">No nodes match &quot;{query}&quot;</p>
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
