"use client";

import { useEffect, useState } from "react";

import { FlowBuilder } from "./flow-builder";
import { FlowCanvas } from "./flow-canvas";
import { FlowEditorProvider } from "./flow-editor-state";
import { EditorHeader } from "./header";
import { ValidationPanel } from "./validation-panel";
import type { FlowRow, FlowNodeRow } from "@/lib/flows/types";

const MOBILE_BREAKPOINT = "(max-width: 767px)";
type View = "canvas" | "list";
const STORAGE_KEY = "wacrm.flowEditor.view";

interface Props {
  initialFlow: FlowRow;
  initialNodes: FlowNodeRow[];
}

export function FlowEditorShell({ initialFlow, initialNodes }: Props) {
  const [view, setView] = useState<View>(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "canvas" || saved === "list") return saved;
    } catch {}
    return "canvas";
  });

  const isMobile = useMatchMedia(MOBILE_BREAKPOINT);
  const effectiveView: View = isMobile ? "list" : view;

  const choose = (next: View) => {
    setView(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch {}
  };

  return (
    <FlowEditorProvider initialFlow={initialFlow} initialNodes={initialNodes}>
      <div className="flex h-full flex-col overflow-hidden bg-white">
        <EditorHeader
          view={effectiveView}
          isMobile={isMobile}
          onViewChange={choose}
        />
        <div className="relative flex-1 overflow-hidden">
          {effectiveView === "canvas" ? (
            <FlowCanvas />
          ) : (
            <div className="h-full overflow-y-auto bg-[#F4F6FA] p-6">
              <FlowBuilder />
            </div>
          )}
          <ValidationPanel />
        </div>
      </div>
    </FlowEditorProvider>
  );
}

function useMatchMedia(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);
  return matches;
}
