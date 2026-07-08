"use client";

import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  History,
  LayoutGrid,
  ListTree,
  Loader2,
  PauseCircle,
  PlayCircle,
  Save,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useFlowEditor, type BuilderState } from "./flow-editor-state";

type View = "canvas" | "list";

interface EditorHeaderProps {
  view: View;
  isMobile: boolean;
  onViewChange: (v: View) => void;
}

export function EditorHeader({ view, isMobile, onViewChange }: EditorHeaderProps) {
  const router = useRouter();
  const {
    flow,
    state,
    setState,
    dirty,
    saving,
    activating,
    canActivate,
    save,
    setStatus,
    deleteFlow,
  } = useFlowEditor();

  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-100 bg-white px-3 shadow-sm">
      {/* Back */}
      <button
        type="button"
        onClick={() => router.push("/flows")}
        title="Back to Flows"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>

      <div className="h-5 w-px shrink-0 bg-slate-200" />

      {/* Name + status */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Input
          value={state.name}
          onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
          placeholder="Flow name"
          className="h-8 max-w-xs border-transparent bg-transparent px-2 text-[14px] font-semibold text-slate-900 shadow-none focus-visible:border-slate-200 focus-visible:bg-slate-50 focus-visible:ring-0"
        />
        <StatusChip status={state.status} />
        {dirty && (
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-amber-400"
            title="Unsaved changes"
          />
        )}
      </div>

      {/* View toggle */}
      {!isMobile && (
        <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-200 p-0.5">
          <ViewButton
            active={view === "canvas"}
            onClick={() => onViewChange("canvas")}
            icon={<LayoutGrid className="h-3.5 w-3.5" />}
            label="Canvas"
          />
          <ViewButton
            active={view === "list"}
            onClick={() => onViewChange("list")}
            icon={<ListTree className="h-3.5 w-3.5" />}
            label="List"
          />
        </div>
      )}

      <div className="h-5 w-px shrink-0 bg-slate-200" />

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/flows/${flow.id}/runs`)}
          className="h-8 gap-1.5 text-[12px] text-slate-600"
        >
          <History className="h-3.5 w-3.5" />
          Runs
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => void deleteFlow()}
          className="h-8 w-8 p-0 text-slate-400 hover:bg-rose-50 hover:text-rose-500"
          title="Delete flow"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>

        {state.status === "active" ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void setStatus("draft")}
            disabled={activating}
            className="h-8 gap-1.5 text-[12px]"
          >
            {activating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PauseCircle className="h-3.5 w-3.5" />
            )}
            Pause
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void setStatus("active")}
            disabled={activating || !canActivate}
            className="h-8 gap-1.5 text-[12px]"
            title={!canActivate ? "Fix issues before activating" : undefined}
          >
            {activating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlayCircle className="h-3.5 w-3.5" />
            )}
            Activate
          </Button>
        )}

        <Button
          onClick={() => void save()}
          disabled={saving}
          size="sm"
          className="h-8 gap-1.5 bg-indigo-600 text-[12px] hover:bg-indigo-700"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save
        </Button>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: BuilderState["status"] }) {
  const styles = {
    draft: "bg-slate-100 text-slate-500",
    active: "bg-emerald-50 text-emerald-700",
    archived: "bg-slate-100 text-slate-400",
  }[status];
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        styles,
      )}
    >
      {status}
    </span>
  );
}

function ViewButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
        active
          ? "bg-slate-100 text-slate-800"
          : "text-slate-500 hover:bg-slate-50 hover:text-slate-700",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
