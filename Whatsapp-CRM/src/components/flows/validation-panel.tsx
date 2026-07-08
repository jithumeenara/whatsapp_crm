"use client";

import { useState } from "react";
import { CircleAlert, CircleCheck, ChevronUp, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ValidationIssue } from "@/lib/flows/validate";
import { useFlowEditor } from "./flow-editor-state";

export function ValidationPanel() {
  const { issues, requestFlash } = useFlowEditor();
  const [open, setOpen] = useState(false);

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const hasErrors = errors.length > 0;
  const hasIssues = issues.length > 0;

  return (
    <div className="absolute bottom-4 right-4 z-20 flex flex-col items-end gap-2">
      {/* Expanded issues list */}
      {open && hasIssues && (
        <div
          className={cn(
            "w-72 overflow-hidden rounded-xl border bg-white shadow-lg",
            hasErrors ? "border-rose-100" : "border-amber-100",
          )}
        >
          <div
            className={cn(
              "flex items-center justify-between border-b px-3 py-2",
              hasErrors
                ? "border-rose-100 bg-rose-50"
                : "border-amber-100 bg-amber-50",
            )}
          >
            <div className="flex items-center gap-2">
              <CircleAlert
                className={cn(
                  "h-3.5 w-3.5",
                  hasErrors ? "text-rose-500" : "text-amber-500",
                )}
              />
              <span
                className={cn(
                  "text-[12px] font-semibold",
                  hasErrors ? "text-rose-700" : "text-amber-700",
                )}
              >
                {errors.length} error{errors.length !== 1 ? "s" : ""}
                {warnings.length > 0 &&
                  `, ${warnings.length} warning${warnings.length !== 1 ? "s" : ""}`}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-0.5 text-slate-400 hover:bg-black/5 hover:text-slate-600"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto p-2">
            {issues.map((issue, i) => (
              <IssueLine key={i} issue={issue} onJump={requestFlash} />
            ))}
          </div>
        </div>
      )}

      {/* Toggle pill */}
      <button
        type="button"
        onClick={() => hasIssues && setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium shadow-md transition-all",
          !hasIssues
            ? "cursor-default bg-emerald-500 text-white"
            : hasErrors
              ? "bg-rose-500 text-white hover:bg-rose-600"
              : "bg-amber-500 text-white hover:bg-amber-600",
        )}
      >
        {!hasIssues ? (
          <CircleCheck className="h-3.5 w-3.5" />
        ) : (
          <CircleAlert className="h-3.5 w-3.5" />
        )}
        {!hasIssues
          ? "Ready to activate"
          : `${issues.length} issue${issues.length !== 1 ? "s" : ""}`}
        {hasIssues &&
          (open ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronUp className="h-3 w-3" />
          ))}
      </button>
    </div>
  );
}

export function IssueLine({
  issue,
  onJump,
}: {
  issue: ValidationIssue;
  onJump?: (key: string) => void;
}) {
  const tone =
    issue.severity === "error" ? "text-rose-600" : "text-amber-600";
  const iconTone =
    issue.severity === "error" ? "text-rose-400" : "text-amber-400";

  const body = (
    <>
      <CircleAlert className={cn("mt-0.5 h-3 w-3 shrink-0", iconTone)} />
      <span className="min-w-0 flex-1 text-[11px] leading-snug">
        {issue.node_key && (
          <code className="mr-1 rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-500">
            {issue.node_key}
          </code>
        )}
        {issue.message}
      </span>
    </>
  );

  if (issue.node_key && onJump) {
    return (
      <button
        type="button"
        onClick={() => onJump(issue.node_key!)}
        className={cn(
          "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-slate-50",
          tone,
        )}
        aria-label={`Jump to node ${issue.node_key}`}
      >
        {body}
      </button>
    );
  }
  return (
    <div className={cn("flex items-start gap-2 rounded-lg px-2 py-1.5", tone)}>
      {body}
    </div>
  );
}
