"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Save, Play, Pause, ChevronLeft,
  SplitSquareHorizontal, Maximize2, Smartphone,
  Loader2, CheckCircle2, AlertCircle,
  Undo2, Redo2, Timer, Settings2, Bot,
} from "lucide-react";
import { ChatbotCanvas } from "./chatbot-canvas";
import { ChatbotPlayground } from "./chatbot-playground";
import type { ChatbotBuilderNode } from "@/lib/chatbot/types";

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

type ViewMode = "canvas" | "split" | "playground";
type SaveStatus = "idle" | "saving" | "saved" | "error";

const MAX_HISTORY = 50;

interface ChatbotShellProps {
  chatbotId: string;
  initialName: string;
  initialStatus: string;
  initialNodes: ChatbotBuilderNode[];
  initialEntryNodeKey: string;
  initialNoReplyEnabled?: boolean;
  initialNoReplyMinutes?: number;
  initialNoReplyMessage?: string;
  channel?: string;
}

export function ChatbotShell({
  chatbotId,
  initialName,
  initialStatus,
  initialNodes,
  initialEntryNodeKey,
  initialNoReplyEnabled = false,
  initialNoReplyMinutes = 30,
  initialNoReplyMessage = '',
  channel = 'whatsapp',
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
  const [noReplyEnabled, setNoReplyEnabled] = useState(initialNoReplyEnabled);
  const [noReplyMinutes, setNoReplyMinutes] = useState(initialNoReplyMinutes);
  const [noReplyMessage, setNoReplyMessage] = useState(initialNoReplyMessage);
  const [noReplyPanelOpen, setNoReplyPanelOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<NodeJS.Timeout | null>(null);

  const nodesRef = useRef(nodes);
  const nameRef = useRef(name);
  const entryRef = useRef(entryNodeId);
  const noReplyEnabledRef = useRef(noReplyEnabled);
  const noReplyMinutesRef = useRef(noReplyMinutes);
  const noReplyMessageRef = useRef(noReplyMessage);
  nodesRef.current = nodes;
  nameRef.current = name;
  entryRef.current = entryNodeId;
  noReplyEnabledRef.current = noReplyEnabled;
  noReplyMinutesRef.current = noReplyMinutes;
  noReplyMessageRef.current = noReplyMessage;

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

  const save = useCallback(async () => {
    setSaveStatus("saving");
    try {
      const startNode = nodesRef.current.find((n) => n.node_type === "start");
      const startCfg = startNode?.config as { trigger_keyword?: string; trigger_match?: string } | undefined;
      const keyword = startCfg?.trigger_keyword?.trim() ?? "";
      const keywords = keyword
        ? keyword.split("|").map((k) => k.trim()).filter(Boolean)
        : [];
      const triggerType = keywords.length > 0 ? "keyword" : "always";
      const triggerConfig = {
        ...(keywords.length > 0 ? { keywords, match_type: startCfg?.trigger_match ?? "exact" } : {}),
        no_reply_delay_enabled: noReplyEnabledRef.current,
        no_reply_delay_minutes: noReplyMinutesRef.current,
        no_reply_message: noReplyMessageRef.current,
      };

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

  const toggleStatus = async () => {
    const next = status === "active" ? "draft" : "active";
    const res = await fetch(`/api/chatbot/${chatbotId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (res.ok) setStatus(next);
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isText = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !isText) { e.preventDefault(); undo(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "r" || e.key === "y") && !isText) { e.preventDefault(); redo(); return; }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [save, undo, redo]);

  const onNodesChange = useCallback((updated: ChatbotBuilderNode[]) => {
    pushHistory(); setNodes(updated); scheduleSave();
  }, [pushHistory, scheduleSave]);

  const onEntryChange = useCallback((key: string) => {
    setEntryNodeId(key); scheduleSave();
  }, [scheduleSave]);

  const isActive = status === "active";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white overflow-hidden">

      {/* ── Top toolbar ── */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 shadow-sm">

        {/* Back */}
        <button
          onClick={() => router.push("/chatbot")}
          title="Back to chatbots"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {/* Bot icon */}
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600">
          <Bot className="h-3.5 w-3.5 text-white" />
        </div>

        {/* Name */}
        {editingName ? (
          <input
            ref={nameInputRef}
            className="h-8 max-w-[180px] rounded-lg border border-indigo-300 bg-white px-2.5 text-[13px] font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { setEditingName(false); scheduleSave(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { setEditingName(false); scheduleSave(); } }}
            autoFocus
          />
        ) : (
          <button
            className="max-w-[180px] truncate text-[13px] font-bold text-slate-800 hover:text-indigo-600 transition-colors"
            onClick={() => { setEditingName(true); setTimeout(() => nameInputRef.current?.select(), 10); }}
            title="Click to rename"
          >
            {name}
          </button>
        )}

        {/* Status badge */}
        <span className={cn(
          "shrink-0 flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
          isActive
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-slate-200 bg-slate-100 text-slate-500"
        )}>
          <span className={cn("h-1.5 w-1.5 rounded-full", isActive ? "bg-emerald-500" : "bg-slate-400")} />
          {status}
        </span>

        {/* Dirty dot */}
        {isDirty && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" title="Unsaved changes" />}

        <div className="flex-1" />

        {/* Undo / Redo */}
        <div className="flex items-center gap-0.5">
          <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)"
            className={cn("flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
              canUndo ? "text-slate-600 hover:bg-slate-100" : "text-slate-300 cursor-not-allowed")}>
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)"
            className={cn("flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
              canRedo ? "text-slate-600 hover:bg-slate-100" : "text-slate-300 cursor-not-allowed")}>
            <Redo2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="h-5 w-px bg-slate-200" />

        {/* No-reply toggle */}
        <div className="relative flex items-center gap-1.5">
          <Timer className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <span className="text-[11px] text-slate-500 hidden sm:inline font-medium">No reply</span>
          <button
            role="switch"
            aria-checked={noReplyEnabled}
            onClick={() => { setNoReplyEnabled((v) => !v); scheduleSave(); }}
            className={cn(
              "relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
              noReplyEnabled ? "bg-indigo-600" : "bg-slate-200"
            )}
          >
            <span className={cn(
              "pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow transition-transform",
              noReplyEnabled ? "translate-x-3" : "translate-x-0"
            )} />
          </button>
          {noReplyEnabled && (
            <div className="flex items-center gap-1">
              <input
                type="number" min={1} max={1440} value={noReplyMinutes}
                onChange={(e) => { setNoReplyMinutes(Math.max(1, parseInt(e.target.value, 10) || 1)); scheduleSave(); }}
                className="h-6 w-12 rounded-lg border border-slate-200 bg-slate-50 px-1.5 text-center text-[11px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
              <span className="text-[11px] text-slate-400">min</span>
              <button
                onClick={() => setNoReplyPanelOpen((v) => !v)}
                title="Configure auto-end message"
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded transition-colors",
                  noReplyPanelOpen ? "text-indigo-600 bg-indigo-50" : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                )}
              >
                <Settings2 className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* No-reply settings panel */}
          {noReplyEnabled && noReplyPanelOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setNoReplyPanelOpen(false)} />
              <div className="absolute top-full right-0 mt-2 z-50 w-72 rounded-xl border border-slate-200 bg-white shadow-xl p-4 space-y-3">
                <div>
                  <p className="text-[12px] font-semibold text-slate-800">Auto-end settings</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    If the user doesn&apos;t reply within {noReplyMinutes} min, the chat ends automatically.
                  </p>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Timeout (minutes)
                  </label>
                  <input
                    type="number" min={1} max={1440} value={noReplyMinutes}
                    onChange={(e) => { setNoReplyMinutes(Math.max(1, parseInt(e.target.value, 10) || 1)); scheduleSave(); }}
                    className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[12px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Message to send when ending <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <textarea
                    rows={3}
                    value={noReplyMessage}
                    onChange={(e) => { setNoReplyMessage(e.target.value); scheduleSave(); }}
                    placeholder={`e.g. "Your session has ended due to inactivity. Reply anytime to start again."`}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[12px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 resize-none"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Leave empty to end silently without a message.</p>
                </div>
                <button
                  onClick={() => setNoReplyPanelOpen(false)}
                  className="w-full rounded-lg bg-indigo-600 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-700 transition-colors"
                >
                  Done
                </button>
              </div>
            </>
          )}
        </div>

        <div className="h-5 w-px bg-slate-200" />

        {/* View mode */}
        <div className="flex gap-0.5 rounded-lg border border-slate-200 bg-slate-100 p-0.5">
          {([
            { id: "canvas" as const,     icon: Maximize2,            label: "Canvas only" },
            { id: "split" as const,      icon: SplitSquareHorizontal, label: "Split view" },
            { id: "playground" as const, icon: Smartphone,            label: "Playground only" },
          ]).map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setViewMode(id)}
              title={label}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded transition-all text-[13px]",
                viewMode === id
                  ? "bg-white shadow-sm text-slate-800"
                  : "text-slate-400 hover:text-slate-600"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>

        <div className="h-5 w-px bg-slate-200" />

        {/* Activate / Deactivate */}
        <button
          onClick={toggleStatus}
          title={isActive ? "Deactivate this chatbot" : "Make this chatbot live"}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-semibold transition-colors",
            isActive
              ? "border-slate-200 text-slate-600 hover:bg-slate-50"
              : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          )}
        >
          {isActive ? <><Pause className="h-3.5 w-3.5" /> Deactivate</> : <><Play className="h-3.5 w-3.5" /> Activate</>}
        </button>

        {/* Save */}
        <button
          onClick={save}
          disabled={saveStatus === "saving"}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold text-white transition-colors disabled:opacity-60",
            saveStatus === "saved"  ? "bg-emerald-600 hover:bg-emerald-700" :
            saveStatus === "error"  ? "bg-rose-600 hover:bg-rose-700" :
                                      "bg-indigo-600 hover:bg-indigo-700"
          )}
        >
          {saveStatus === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
           saveStatus === "saved"  ? <CheckCircle2 className="h-3.5 w-3.5" /> :
           saveStatus === "error"  ? <AlertCircle className="h-3.5 w-3.5" /> :
                                     <Save className="h-3.5 w-3.5" />}
          {saveStatus === "saving" ? "Saving…" :
           saveStatus === "saved"  ? "Saved" :
           saveStatus === "error"  ? "Error" : "Save"}
        </button>

        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          title="Settings"
        >
          <Settings2 className="h-4 w-4" />
        </button>
      </header>

      {/* ── Canvas / Playground ── */}
      <div className="flex flex-1 overflow-hidden">
        {(viewMode === "canvas" || viewMode === "split") && (
          <div className={cn(
            "flex flex-col overflow-hidden",
            viewMode === "split" ? "flex-1 border-r border-slate-200" : "w-full"
          )}>
            <ChatbotCanvas
              nodes={nodes}
              entryNodeId={entryNodeId}
              onChange={onNodesChange}
              onEntryChange={onEntryChange}
              channel={channel}
            />
          </div>
        )}
        {(viewMode === "playground" || viewMode === "split") && (
          <div className={cn(
            "flex flex-col overflow-hidden bg-slate-50",
            viewMode === "split" ? "w-[340px] shrink-0" : "w-full"
          )}>
            <ChatbotPlayground nodes={nodes} entryNodeKey={entryNodeId ?? ""} />
          </div>
        )}
      </div>
    </div>
  );
}
