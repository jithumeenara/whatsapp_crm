"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Loader2,
  ChevronLeft,
  Save,
  Play,
  Pause,
  CheckCircle2,
  AlertCircle,
  Upload,
  Send,
  PlayCircle,
  XCircle,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { MetaFlowBuilder } from "@/components/flows/meta-flow-builder";
import {
  blankFlow,
  type MetaFlowDefinition,
} from "@/lib/flows/meta-flow-types";
import {
  validateMetaFlow,
  type FlowValidationError,
} from "@/lib/flows/meta-flow-validate";

interface FlowRow {
  id: string;
  name: string;
  status: string;
  trigger_config: Record<string, unknown> | null;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function FlowEditorPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();

  const [flow, setFlow] = useState<FlowRow | null>(null);
  const [flowDef, setFlowDef] = useState<MetaFlowDefinition>(blankFlow());
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [validationErrors, setValidationErrors] = useState<FlowValidationError[] | null>(null);
  const [validationOpen, setValidationOpen] = useState(false);

  // Stable refs for save callback
  const flowDefRef = useRef(flowDef);
  flowDefRef.current = flowDef;
  const flowRef = useRef(flow);

  useEffect(() => {
    if (!params.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/flows/${params.id}`);
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const json = (await res.json()) as { flow: FlowRow };
        if (!cancelled) {
          setFlow(json.flow);
          const cfg = json.flow.trigger_config;
          if (cfg && Array.isArray((cfg as unknown as MetaFlowDefinition).screens)) {
            setFlowDef(cfg as unknown as MetaFlowDefinition);
          } else {
            setFlowDef(blankFlow());
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          toast.error("Couldn't load flow.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [params.id]);

  const save = useCallback(async () => {
    if (!flowRef.current) return;
    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/flows/${flowRef.current.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trigger_config: flowDefRef.current,
          trigger_type: "whatsapp_flow",
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  }, []);

  const handleChange = useCallback(
    (def: MetaFlowDefinition) => {
      setFlowDef(def);
      // Clear stale validation badge when flow changes
      if (validationErrors !== null) setValidationErrors(null);
    },
    [validationErrors],
  );

  const handleRunValidation = useCallback(() => {
    const errors = validateMetaFlow(flowDef);
    setValidationErrors(errors);
    setValidationOpen(true);
  }, [flowDef]);

  const handleUpload = async () => {
    if (!flow) return;
    setUploading(true);
    try {
      await save();
      const res = await fetch(`/api/flows/${flow.id}/upload`, { method: "POST" });
      const json = await res.json() as { ok?: boolean; meta_flow_id?: string; updated?: boolean; error?: string };
      if (!res.ok) { toast.error(json.error ?? "Upload failed."); return; }
      setFlow((f) => f ? { ...f, trigger_config: { ...f.trigger_config, meta_flow_id: json.meta_flow_id } } : f);
      toast.success(json.updated ? "Flow updated on Meta successfully." : "Uploaded to Meta. Use Publish to make it live.");
    } catch {
      toast.error("Couldn't upload to Meta.");
    } finally {
      setUploading(false);
    }
  };

  const handlePublish = async () => {
    if (!flow) return;
    setPublishing(true);
    try {
      const res = await fetch(`/api/flows/${flow.id}/publish`, { method: "POST" });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) { toast.error(json.error ?? "Publish failed."); return; }
      setFlow((f) => f ? { ...f, status: "active" } : f);
      toast.success(`"${flow.name}" published to Meta.`);
    } catch {
      toast.error("Couldn't publish to Meta.");
    } finally {
      setPublishing(false);
    }
  };

  const toggleStatus = async () => {
    if (!flow) return;
    const next = flow.status === "active" ? "draft" : "active";
    const res = await fetch(`/api/flows/${flow.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (res.ok) setFlow((f) => f ? { ...f, status: next } : f);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || !flow) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">Flow not found.</p>
        <button
          type="button"
          onClick={() => router.push("/flows")}
          className="text-sm text-primary hover:underline"
        >
          ← Back to flows
        </button>
      </div>
    );
  }

  const errorCount = validationErrors?.filter((e) => e.severity === "error").length ?? 0;
  const warnCount  = validationErrors?.filter((e) => e.severity === "warning").length ?? 0;
  const totalCount = errorCount + warnCount;

  return (
    <div className="flex h-screen flex-col bg-background overflow-hidden">
      {/* ── Toolbar ──────────────────────────────────────────── */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
        <button
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-muted transition-colors"
          onClick={() => router.push("/flows")}
          title="Back"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate text-sm font-semibold text-foreground">{flow.name}</span>
          <Badge
            variant="outline"
            className={cn(
              "h-5 shrink-0 text-[10px] font-semibold uppercase",
              flow.status === "active"
                ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                : "border-border bg-muted text-muted-foreground",
            )}
          >
            {flow.status}
          </Badge>
        </div>

        <div className="flex-1" />

        {/* Run / Validate */}
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 gap-1.5 text-xs",
            validationErrors !== null && errorCount === 0
              ? "border-emerald-600/40 text-emerald-400 hover:bg-emerald-500/10"
              : validationErrors !== null && errorCount > 0
                ? "border-red-600/40 text-red-400 hover:bg-red-500/10"
                : "",
          )}
          onClick={handleRunValidation}
        >
          <PlayCircle className="h-3.5 w-3.5" />
          Run
          {validationErrors !== null && (
            <span className={cn(
              "ml-0.5 rounded-full px-1.5 py-0 text-[10px] font-bold",
              errorCount > 0 ? "bg-red-500/20 text-red-400" : "bg-emerald-500/20 text-emerald-400",
            )}>
              {errorCount > 0 ? totalCount : "✓"}
            </span>
          )}
        </Button>

        {/* Upload / Publish to Meta */}
        {(() => {
          const metaFlowId = flow.trigger_config?.meta_flow_id as string | undefined;
          if (!metaFlowId) return (
            <Button variant="outline" size="sm"
              className="h-8 gap-1.5 text-xs text-sky-400 border-sky-600/40 hover:bg-sky-500/10 hover:text-sky-300"
              onClick={handleUpload} disabled={uploading}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Upload to Meta
            </Button>
          );
          // Flow is already on Meta — show both Update and Publish buttons as needed
          return (
            <>
              <Button variant="outline" size="sm"
                className="h-8 gap-1.5 text-xs text-sky-400 border-sky-600/40 hover:bg-sky-500/10 hover:text-sky-300"
                onClick={handleUpload} disabled={uploading}>
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Update on Meta
              </Button>
              {flow.status !== "active" && (
                <Button variant="outline" size="sm"
                  className="h-8 gap-1.5 text-xs text-emerald-400 border-emerald-600/40 hover:bg-emerald-500/10 hover:text-emerald-300"
                  onClick={handlePublish} disabled={publishing}>
                  {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Publish to Meta
                </Button>
              )}
            </>
          );
        })()}

        {/* Copy Flow JSON */}
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs"
          onClick={() => { navigator.clipboard.writeText(JSON.stringify(flowDef, null, 2)); toast.success("Flow JSON copied!"); }}>
          Copy Flow JSON
        </Button>

        {/* Activate toggle */}
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={toggleStatus}>
          {flow.status === "active"
            ? <><Pause className="h-3.5 w-3.5" /> Deactivate</>
            : <><Play className="h-3.5 w-3.5" /> Activate</>}
        </Button>

        {/* Save */}
        <Button size="sm"
          className={cn("h-8 gap-1.5 text-xs",
            saveStatus === "saved" && "bg-emerald-600 hover:bg-emerald-700",
            saveStatus === "error" && "bg-destructive")}
          onClick={save} disabled={saveStatus === "saving"}>
          {saveStatus === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : saveStatus === "saved" ? <CheckCircle2 className="h-3.5 w-3.5" />
            : saveStatus === "error" ? <AlertCircle className="h-3.5 w-3.5" />
            : <Save className="h-3.5 w-3.5" />}
          {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : saveStatus === "error" ? "Error" : "Save"}
        </Button>
      </header>

      {/* ── Builder ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        <MetaFlowBuilder
          value={flowDef}
          onChange={handleChange}
          flowId={flow.id}
          metaFlowId={flow.trigger_config?.meta_flow_id as string | undefined}
          flowStatus={flow.status}
        />
      </div>

      {/* ── Validation dialog ─────────────────────────────────── */}
      <Dialog open={validationOpen} onOpenChange={setValidationOpen}>
        <DialogContent className="sm:max-w-lg bg-card p-0 gap-0 overflow-hidden">
          {/* Header — Meta-style tab strip */}
          <div className="flex border-b border-border">
            {/* Active tab */}
            <div className={cn(
              "flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 -mb-px",
              errorCount > 0
                ? "border-[#1877F2] text-foreground"
                : "border-emerald-500 text-foreground",
            )}>
              {errorCount > 0 ? (
                <>
                  Flow JSON errors
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#1877F2] px-1.5 text-[11px] font-bold text-white">
                    {totalCount}
                  </span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  No errors
                </>
              )}
            </div>
            {/* Inactive stub tabs — visual parity with Meta's UI */}
            <button className="px-4 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors">
              Actions
            </button>
            <button className="px-4 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors">
              Endpoint
            </button>
          </div>

          {/* Error list */}
          <div className="max-h-[400px] overflow-y-auto">
            {validationErrors?.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                <p className="text-sm font-medium text-foreground">Flow JSON is valid</p>
                <p className="text-xs text-muted-foreground">No errors or warnings — ready to upload to Meta.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {validationErrors?.map((error, i) => (
                  <div key={i} className="px-5 py-4">
                    {/* Error message */}
                    <p className="text-sm text-foreground">{error.message}</p>
                    {/* Path + location — matches Meta's ⊗ path [Line X, column Y] */}
                    <div className="mt-1.5 flex items-center gap-1.5">
                      {error.severity === "error" ? (
                        <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                      ) : (
                        <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                      )}
                      <span className="text-[12px] font-medium text-[#1877F2]">{error.path}</span>
                      <span className="text-[12px] text-muted-foreground">
                        [Line {error.line}, column {error.column}]
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {(errorCount > 0 || warnCount > 0) && (
            <div className="flex items-center justify-between border-t border-border px-5 py-3">
              <p className="text-xs text-muted-foreground">
                {errorCount > 0 && <span className="text-red-400">{errorCount} error{errorCount !== 1 ? "s" : ""}</span>}
                {errorCount > 0 && warnCount > 0 && <span className="mx-1 text-border">·</span>}
                {warnCount > 0 && <span className="text-amber-400">{warnCount} warning{warnCount !== 1 ? "s" : ""}</span>}
              </p>
              <Button size="sm" variant="outline" className="h-7 text-xs"
                onClick={() => setValidationOpen(false)}>
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
