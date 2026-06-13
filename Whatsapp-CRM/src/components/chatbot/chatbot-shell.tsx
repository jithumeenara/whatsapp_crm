"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Save,
  Play,
  Pause,
  ChevronLeft,
  SplitSquareHorizontal,
  Maximize2,
  Smartphone,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Settings2,
  Undo2,
  Redo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ChatbotCanvas } from "./chatbot-canvas";
import { ChatbotPlayground } from "./chatbot-playground";
import type { ChatbotBuilderNode } from "@/lib/chatbot/types";

type ViewMode = "canvas" | "split" | "playground";
type SaveStatus = "idle" | "saving" | "saved" | "error";

const MAX_HISTORY = 50;

interface ChatbotShellProps {
  chatbotId: string;
  initialName: string;
  initialStatus: string;
  initialNodes: ChatbotBuilderNode[];
  initialEntryNodeKey: string;
}

export function ChatbotShell({
  chatbotId,
  initialName,
  initialStatus,
  initialNodes,
  initialEntryNodeKey,
}: ChatbotShellProps) {
  const router = useRouter();

  const [name, setName] = useState(initialName);
  const [status, setStatus] = useState(initialStatus);
  const [nodes, setNodes] = useState<ChatbotBuilderNode[]>(initialNodes);
  const [entryNodeId, setEntryNodeId] = useState<string | null>(initialEntryNodeKey || null);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [isDirty, setIsDirty] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<NodeJS.Timeout | null>(null);

  // Stable refs for save callback
  const nodesRef = useRef(nodes);
  const nameRef = useRef(name);
  const entryRef = useRef(entryNodeId);
  nodesRef.current = nodes;
  nameRef.current = name;
  entryRef.current = entryNodeId;

  // ── Undo / redo history ─────────────────────────────────────
  const historyRef = useRef<ChatbotBuilderNode[][]>([]);
  const futureRef = useRef<ChatbotBuilderNode[][]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const pushHistory = useCallback(() => {
    historyRef.current = [...historyRef.current.slice(-(MAX_HISTORY - 1)), nodesRef.current];
    futureRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  // ── Save ────────────────────────────────────────────────────
  const save = useCallback(async () => {
    setSaveStatus("saving");
    try {
      // Derive trigger_type / trigger_config from the start node's keyword cfg.
      const startNode = nodesRef.current.find((n) => n.node_type === "start");
      const startCfg = startNode?.config as { trigger_keyword?: string; trigger_match?: string } | undefined;
      const keyword = startCfg?.trigger_keyword?.trim() ?? "";
      const triggerType = keyword ? "keyword" : "always";
      const triggerConfig = keyword
        ? { keywords: [keyword], match_type: startCfg?.trigger_match ?? "exact" }
        : {};

      const res = await fetch(`/api/chatbot/${chatbotId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nameRef.current,
          entry_node_id: entryRef.current || null,
          trigger_type: triggerType,
          trigger_config: triggerConfig,
          nodes: nodesRef.current.map((n) => ({
            node_key: n.node_key,
            node_type: n.node_type,
            config: n.config,
            position_x: n.position_x,
            position_y: n.position_y,
          })),
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaveStatus("saved");
      setIsDirty(false);
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  }, [chatbotId]);

  const scheduleSave = useCallback(() => {
    setIsDirty(true);
    if (pendingRef.current) clearTimeout(pendingRef.current);
    pendingRef.current = setTimeout(save, 3000);
  }, [save]);

  // ── Undo ────────────────────────────────────────────────────
  const undo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const prev = historyRef.current[historyRef.current.length - 1];
    futureRef.current = [nodesRef.current, ...futureRef.current].slice(0, MAX_HISTORY);
    historyRef.current = historyRef.current.slice(0, -1);
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(true);
    setNodes(prev);
    scheduleSave();
  }, [scheduleSave]);

  // ── Redo ────────────────────────────────────────────────────
  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const next = futureRef.current[0];
    historyRef.current = [...historyRef.current, nodesRef.current].slice(-MAX_HISTORY);
    futureRef.current = futureRef.current.slice(1);
    setCanUndo(true);
    setCanRedo(futureRef.current.length > 0);
    setNodes(next);
    scheduleSave();
  }, [scheduleSave]);

  // ── Toggle chatbot status ───────────────────────────────────
  const toggleStatus = async () => {
    const next = status === "active" ? "draft" : "active";
    const res = await fetch(`/api/chatbot/${chatbotId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (res.ok) setStatus(next);
  };

  // ── Global keyboard shortcuts ───────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isEditingText =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        save();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !isEditingText) {
        e.preventDefault();
        undo();
        return;
      }
      // Ctrl+R (redo) and Ctrl+Y (redo — standard Windows)
      if ((e.ctrlKey || e.metaKey) && (e.key === "r" || e.key === "y") && !isEditingText) {
        e.preventDefault();
        redo();
        return;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [save, undo, redo]);

  // ── Canvas callbacks ────────────────────────────────────────
  const onNodesChange = useCallback(
    (updated: ChatbotBuilderNode[]) => {
      pushHistory();
      setNodes(updated);
      scheduleSave();
    },
    [pushHistory, scheduleSave],
  );

  const onEntryChange = useCallback(
    (key: string) => {
      setEntryNodeId(key);
      scheduleSave();
    },
    [scheduleSave],
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background overflow-hidden">
      {/* ── Top toolbar ─────────────────────────────────────── */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
        {/* Back */}
        <button
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-muted transition-colors"
          onClick={() => router.push("/chatbot")}
          title="Back to chatbots"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {/* Name */}
        {editingName ? (
          <Input
            ref={nameInputRef}
            className="h-8 max-w-[200px] text-sm font-semibold"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setEditingName(false);
              scheduleSave();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setEditingName(false);
                scheduleSave();
              }
            }}
          />
        ) : (
          <button
            className="max-w-[200px] truncate text-sm font-semibold text-foreground hover:text-primary transition-colors"
            onClick={() => {
              setEditingName(true);
              setTimeout(() => nameInputRef.current?.select(), 10);
            }}
            title="Click to rename"
          >
            {name}
          </button>
        )}

        {/* Status badge */}
        <Badge
          variant="outline"
          className={cn(
            "h-5 shrink-0 text-[10px] font-semibold uppercase",
            status === "active"
              ? "border-emerald-400 bg-emerald-50 text-emerald-700"
              : "border-border bg-muted text-muted-foreground",
          )}
        >
          {status}
        </Badge>

        {/* Dirty indicator */}
        {isDirty && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
            title="Unsaved changes"
          />
        )}

        <div className="flex-1" />

        {/* Undo / Redo */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={undo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded transition-colors",
              canUndo
                ? "text-foreground hover:bg-muted"
                : "text-muted-foreground/40 cursor-not-allowed",
            )}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            title="Redo (Ctrl+R)"
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded transition-colors",
              canRedo
                ? "text-foreground hover:bg-muted"
                : "text-muted-foreground/40 cursor-not-allowed",
            )}
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mx-1 h-5 w-px bg-border" />

        {/* View mode toggles */}
        <div className="flex gap-0.5 rounded-lg border border-border bg-muted p-0.5">
          {(
            [
              { id: "canvas" as const, icon: Maximize2, label: "Canvas only" },
              { id: "split" as const, icon: SplitSquareHorizontal, label: "Split view" },
              { id: "playground" as const, icon: Smartphone, label: "Playground only" },
            ]
          ).map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setViewMode(id)}
              title={label}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded transition-colors",
                viewMode === id
                  ? "bg-card shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>

        <div className="mx-1 h-5 w-px bg-border" />

        {/* Activate/Deactivate */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={toggleStatus}
          title={status === "active" ? "Deactivate this chatbot" : "Make this chatbot live"}
        >
          {status === "active" ? (
            <>
              <Pause className="h-3.5 w-3.5" /> Deactivate
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5" /> Activate
            </>
          )}
        </Button>

        {/* Save */}
        <Button
          size="sm"
          className={cn(
            "h-8 gap-1.5 text-xs",
            saveStatus === "saved" && "bg-emerald-600 hover:bg-emerald-700",
            saveStatus === "error" && "bg-destructive hover:bg-destructive/90",
          )}
          onClick={save}
          disabled={saveStatus === "saving"}
        >
          {saveStatus === "saving" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : saveStatus === "saved" ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : saveStatus === "error" ? (
            <AlertCircle className="h-3.5 w-3.5" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {saveStatus === "saving"
            ? "Saving…"
            : saveStatus === "saved"
              ? "Saved"
              : saveStatus === "error"
                ? "Error"
                : "Save"}
        </Button>

        <button
          className="flex h-8 w-8 items-center justify-center rounded hover:bg-muted transition-colors"
          title="Chatbot settings"
        >
          <Settings2 className="h-4 w-4" />
        </button>
      </header>

      {/* ── Main content area ────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Canvas pane */}
        {(viewMode === "canvas" || viewMode === "split") && (
          <div
            className={cn(
              "flex flex-col overflow-hidden",
              viewMode === "split" ? "flex-1 border-r border-border" : "w-full",
            )}
          >
            <ChatbotCanvas
              nodes={nodes}
              entryNodeId={entryNodeId}
              onChange={onNodesChange}
              onEntryChange={onEntryChange}
            />
          </div>
        )}

        {/* Playground pane */}
        {(viewMode === "playground" || viewMode === "split") && (
          <div
            className={cn(
              "flex flex-col overflow-hidden",
              viewMode === "split" ? "w-[340px] shrink-0" : "w-full",
            )}
          >
            <ChatbotPlayground nodes={nodes} entryNodeKey={entryNodeId ?? ""} />
          </div>
        )}
      </div>
    </div>
  );
}
