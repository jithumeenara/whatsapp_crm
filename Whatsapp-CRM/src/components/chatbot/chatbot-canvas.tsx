"use client";

/**
 * Chatbot builder canvas.
 *
 * Features:
 * - Drag nodes from the LEFT palette onto the canvas
 * - React Flow drag-to-pan (default) or drag-to-select (toggle)
 * - Click a node → right side-sheet opens with config form
 * - Drag between handles to wire next_node_key / buttons / etc.
 * - Delete / Backspace removes selected nodes (with confirm dialog)
 * - Ctrl/Cmd+click for multi-select; toggle button for box selection
 * - "Set as entry" sets entry_node_id
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type OnConnect,
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Flag,
  LayoutGrid,
  MousePointer2,
  Hand,
  Trash2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
import { ChatbotNode } from "./chatbot-node";
import { NodeForm } from "./forms/node-form";

// ─── React Flow node types registry ─────────────────────────────
const NODE_TYPES = { chatbot: ChatbotNode };

// ─── Helpers ────────────────────────────────────────────────────
let _nodeCounter = 0;
function genKey(type: ChatbotNodeType) {
  return `${type}_${++_nodeCounter}`;
}

function builderToRf(
  nodes: ChatbotBuilderNode[],
  entryId: string | null,
): Node[] {
  return nodes.map((n) => ({
    id: n.node_key,
    type: "chatbot",
    position: { x: n.position_x, y: n.position_y },
    data: {
      node_type: n.node_type,
      config: n.config,
      isEntry: n.node_key === entryId,
    },
    draggable: true,
    selectable: true,
  }));
}

/** Derive React Flow edges from node configs. */
function deriveEdges(nodes: ChatbotBuilderNode[]): Edge[] {
  const edges: Edge[] = [];
  for (const node of nodes) {
    const cfg = node.config;
    const handles = getSourceHandles(node.node_type, cfg);

    for (const h of handles) {
      let targetKey: string | undefined;

      if (node.node_type === "condition") {
        targetKey =
          h.id === "true"
            ? (cfg.true_next as string)
            : (cfg.false_next as string);
      } else if (node.node_type === "send_buttons") {
        const buttons = (cfg.buttons as Array<Record<string, unknown>>) ?? [];
        const replyId = h.id.replace(/^btn_/, "");
        const btn = buttons.find((b) => String(b.reply_id) === replyId);
        targetKey = btn?.next_node_key as string | undefined;
      } else if (node.node_type === "send_list") {
        const sections =
          (cfg.sections as Array<Record<string, unknown>>) ?? [];
        const replyId = h.id.replace(/^row_/, "");
        for (const sec of sections) {
          const rows = (sec.rows as Array<Record<string, unknown>>) ?? [];
          const row = rows.find((r) => String(r.reply_id) === replyId);
          if (row) { targetKey = row.next_node_key as string; break; }
        }
      } else if (node.node_type === "http_request") {
        targetKey =
          h.id === "error"
            ? (cfg.error_node_key as string)
            : (cfg.next_node_key as string);
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
          labelStyle: { fontSize: 10, fill: "var(--muted-foreground)" },
          style: { stroke: "var(--primary)", strokeWidth: 1.5 },
          animated: false,
        });
      }
    }
  }
  return edges;
}

// ─── Inner canvas (needs useReactFlow inside provider) ──────────

interface CanvasProps {
  nodes: ChatbotBuilderNode[];
  entryNodeId: string | null;
  onChange: (nodes: ChatbotBuilderNode[]) => void;
  onEntryChange: (key: string) => void;
}

function CanvasInner({
  nodes: builderNodes,
  entryNodeId,
  onChange,
  onEntryChange,
}: CanvasProps) {
  const { screenToFlowPosition, fitView } = useReactFlow();
  const confirm = useConfirm();

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(
    builderToRf(builderNodes, entryNodeId),
  );
  const [rfEdges, setRfEdges] = useEdgesState(deriveEdges(builderNodes));

  // Pan vs box-selection mode
  const [interactionMode, setInteractionMode] = useState<"pan" | "select">("pan");

  // Sync RF nodes from external builder state change (save/load / undo/redo)
  const prevBuilderRef = useRef(builderNodes);
  useEffect(() => {
    if (prevBuilderRef.current === builderNodes) return;
    prevBuilderRef.current = builderNodes;
    setRfNodes(builderToRf(builderNodes, entryNodeId));
    setRfEdges(deriveEdges(builderNodes));
  }, [builderNodes, entryNodeId, setRfNodes, setRfEdges]);

  // Side-sheet state
  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const sheetNode = builderNodes.find((n) => n.node_key === sheetKey) ?? null;

  // ── Handle connecting nodes via drag ────────────────────────
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      const { source, sourceHandle, target } = connection;
      if (!source || !target) return;

      const updated = builderNodes.map((n) => {
        if (n.node_key !== source) return n;
        const cfg = { ...n.config };

        if (n.node_type === "condition") {
          if (sourceHandle === "true") cfg.true_next = target;
          else cfg.false_next = target;
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
          if (sourceHandle === "error") cfg.error_node_key = target;
          else cfg.next_node_key = target;
        } else {
          cfg.next_node_key = target;
        }

        return { ...n, config: cfg };
      });

      onChange(updated);
      setRfEdges(deriveEdges(updated));
    },
    [builderNodes, onChange, setRfEdges],
  );

  // ── Drag position update ─────────────────────────────────────
  const onNodeDragStop: OnNodeDrag = useCallback(
    (_, rfNode) => {
      const updated = builderNodes.map((n) =>
        n.node_key === rfNode.id
          ? { ...n, position_x: Math.round(rfNode.position.x), position_y: Math.round(rfNode.position.y) }
          : n,
      );
      onChange(updated);
    },
    [builderNodes, onChange],
  );

  // ── Delete selected nodes (with confirm) ─────────────────────
  const deleteNodes = useCallback(
    async (keysToRemove: Set<string>) => {
      const count = keysToRemove.size;
      const label =
        count === 1
          ? `"${[...keysToRemove][0]}" node`
          : `${count} nodes`;

      const yes = await confirm({
        title: `Delete ${label}?`,
        description: "Connected edges will also be removed. This can be undone with Ctrl+Z.",
        confirmLabel: "Delete",
        variant: "destructive",
      });
      if (!yes) return;

      const remaining = builderNodes.filter((n) => !keysToRemove.has(n.node_key));
      const cleaned = remaining.map((n) => {
        const cfg = JSON.parse(JSON.stringify(n.config)) as Record<string, unknown>;
        function clearRef(obj: Record<string, unknown>) {
          for (const k of Object.keys(obj)) {
            if (typeof obj[k] === "string" && keysToRemove.has(obj[k] as string)) {
              obj[k] = "";
            } else if (Array.isArray(obj[k])) {
              for (const item of obj[k] as unknown[]) {
                if (typeof item === "object" && item !== null)
                  clearRef(item as Record<string, unknown>);
              }
            } else if (typeof obj[k] === "object" && obj[k] !== null) {
              clearRef(obj[k] as Record<string, unknown>);
            }
          }
        }
        clearRef(cfg);
        return { ...n, config: cfg };
      });

      onChange(cleaned);
      if (sheetKey && keysToRemove.has(sheetKey)) setSheetKey(null);
    },
    [builderNodes, onChange, sheetKey, confirm],
  );

  // ── Keyboard: Delete / Backspace ─────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      // Don't intercept when focus is in an input inside the sheet
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      const selected = rfNodes.filter((n) => n.selected);
      if (selected.length === 0) return;
      e.preventDefault();

      const keysToRemove = new Set(selected.map((n) => n.id));
      // Don't allow deleting the start node
      keysToRemove.delete("start");
      if (keysToRemove.size === 0) return;

      void deleteNodes(keysToRemove);
    },
    [rfNodes, deleteNodes],
  );

  // ── Drop node from palette ───────────────────────────────────
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData("chatbot/node_type") as ChatbotNodeType;
      if (!type) return;

      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const key = genKey(type);
      const newNode: ChatbotBuilderNode = {
        node_key: key,
        node_type: type,
        config: defaultConfigFor(type),
        position_x: Math.round(pos.x),
        position_y: Math.round(pos.y),
      };
      onChange([...builderNodes, newNode]);
    },
    [builderNodes, onChange, screenToFlowPosition],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  // ── Node click → open sheet ──────────────────────────────────
  const onNodeClick = useCallback(
    (_: React.MouseEvent, rfNode: Node) => {
      setSheetKey(rfNode.id);
    },
    [],
  );

  // ── Config update from sheet form ────────────────────────────
  const handleConfigChange = useCallback(
    (key: string, cfg: Record<string, unknown>) => {
      const updated = builderNodes.map((n) =>
        n.node_key === key ? { ...n, config: cfg } : n,
      );
      onChange(updated);
      setRfEdges(deriveEdges(updated));
    },
    [builderNodes, onChange, setRfEdges],
  );

  // ── Delete from sheet button ─────────────────────────────────
  const handleSheetDelete = useCallback(
    (key: string) => {
      void deleteNodes(new Set([key]));
    },
    [deleteNodes],
  );

  return (
    <div
      className="relative h-full w-full outline-none"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
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
        fitViewOptions={{ padding: 0.2 }}
        deleteKeyCode={null}
        // Pan vs select mode
        panOnDrag={interactionMode === "pan"}
        selectionOnDrag={interactionMode === "select"}
        // Ctrl/Cmd+click always adds to selection regardless of mode
        multiSelectionKeyCode="Meta"
        selectionKeyCode="Shift"
        className="bg-[#F8F9FA]"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#d1d5db" />
        <Controls className="!border-border !bg-card !shadow-sm" />
        <MiniMap
          nodeStrokeWidth={2}
          className="!border-border !bg-card"
          nodeColor={(n) => {
            const nd = n.data as { node_type?: string };
            const meta = nd.node_type ? NODE_META[nd.node_type as ChatbotNodeType] : null;
            return meta ? "var(--primary)" : "#94a3b8";
          }}
        />

        {/* Top-right panel: interaction mode + fit */}
        <Panel position="top-right" className="flex items-center gap-2">
          {/* Pan / Select toggle */}
          <div className="flex gap-0.5 rounded-lg border border-border bg-card p-0.5 shadow-sm">
            <button
              onClick={() => setInteractionMode("pan")}
              title="Pan mode — drag canvas to pan"
              className={cn(
                "flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors",
                interactionMode === "pan"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Hand className="h-3 w-3" />
              Pan
            </button>
            <button
              onClick={() => setInteractionMode("select")}
              title="Select mode — drag to select multiple nodes"
              className={cn(
                "flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors",
                interactionMode === "select"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <MousePointer2 className="h-3 w-3" />
              Select
            </button>
          </div>

          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs shadow-sm"
            onClick={() => fitView({ padding: 0.2, duration: 300 })}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Fit
          </Button>
        </Panel>

        {/* Bottom hint when in select mode */}
        {interactionMode === "select" && (
          <Panel position="bottom-center">
            <div className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-[10px] text-primary shadow-sm">
              Drag to box-select nodes · Ctrl+click to add to selection · Delete to remove selected
            </div>
          </Panel>
        )}
      </ReactFlow>

      {/* Config side-sheet */}
      <Sheet open={!!sheetNode} onOpenChange={(open) => { if (!open) setSheetKey(null); }}>
        <SheetContent
          side="right"
          className="w-[380px] overflow-y-auto p-0 sm:max-w-[380px]"
        >
          {sheetNode && (
            <>
              <SheetHeader
                className={cn(
                  "border-b border-border px-5 py-4",
                  NODE_META[sheetNode.node_type].bg,
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {(() => {
                      const Icon = NODE_META[sheetNode.node_type].icon;
                      return (
                        <Icon
                          className={cn("h-5 w-5", NODE_META[sheetNode.node_type].color)}
                        />
                      );
                    })()}
                    <SheetTitle className="text-base">
                      {NODE_META[sheetNode.node_type].label}
                    </SheetTitle>
                  </div>
                  <div className="flex items-center gap-1">
                    {sheetNode.node_type !== "start" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => handleSheetDelete(sheetNode.node_key)}
                        title="Delete node"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                    {sheetNode.node_key !== entryNodeId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 text-xs text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                        onClick={() => {
                          onEntryChange(sheetNode.node_key);
                          setSheetKey(null);
                        }}
                      >
                        <Flag className="h-3.5 w-3.5" />
                        Set entry
                      </Button>
                    )}
                  </div>
                </div>
                <SheetDescription className="text-xs text-muted-foreground">
                  {NODE_META[sheetNode.node_type].description}
                </SheetDescription>
              </SheetHeader>

              <div className="px-5 py-4">
                <NodeForm
                  node={sheetNode}
                  allNodes={builderNodes}
                  onChange={(cfg) => handleConfigChange(sheetNode.node_key, cfg)}
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Node palette sidebar ────────────────────────────────────────

function NodePalette() {
  const grouped = useMemo(() => {
    const map = new Map<string, typeof PALETTE_NODES>(
      PALETTE_GROUPS.map((g) => [g, []]),
    );
    for (const type of PALETTE_NODES) {
      const g = NODE_META[type].group;
      map.get(g)?.push(type);
    }
    return Array.from(map.entries()).filter(([, items]) => items.length > 0);
  }, []);

  const onDragStart = (e: React.DragEvent, type: ChatbotNodeType) => {
    e.dataTransfer.setData("chatbot/node_type", type);
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div className="flex h-full w-52 shrink-0 flex-col border-r border-border bg-card">
      <div className="border-b border-border px-3 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Nodes
        </p>
        <p className="text-[10px] text-muted-foreground/70">Drag onto canvas</p>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {grouped.map(([group, types]) => (
          <div key={group} className="mb-3">
            <p
              className={cn(
                "mb-1.5 px-1 text-[10px] font-bold uppercase tracking-widest",
                PALETTE_GROUP_COLORS[group as keyof typeof PALETTE_GROUP_COLORS],
              )}
            >
              {group}
            </p>
            {types.map((type) => {
              const meta = NODE_META[type];
              const Icon = meta.icon;
              return (
                <div
                  key={type}
                  draggable
                  onDragStart={(e) => onDragStart(e, type)}
                  className={cn(
                    "mb-1 flex cursor-grab items-center gap-2 rounded-lg border border-transparent px-2 py-1.5",
                    "hover:border-border hover:bg-muted active:cursor-grabbing",
                    "transition-colors select-none",
                  )}
                  title={meta.description}
                >
                  <div
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                      meta.bg,
                    )}
                  >
                    <Icon className={cn("h-3.5 w-3.5", meta.color)} />
                  </div>
                  <span className="text-xs font-medium text-foreground">
                    {meta.label}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Public export ───────────────────────────────────────────────

interface ChatbotCanvasProps {
  nodes: ChatbotBuilderNode[];
  entryNodeId: string | null;
  onChange: (nodes: ChatbotBuilderNode[]) => void;
  onEntryChange: (key: string) => void;
}

export function ChatbotCanvas(props: ChatbotCanvasProps) {
  return (
    <div className="flex h-full w-full overflow-hidden">
      <NodePalette />
      <ReactFlowProvider>
        <CanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
