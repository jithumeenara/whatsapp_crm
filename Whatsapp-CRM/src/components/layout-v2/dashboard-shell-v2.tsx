"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { ConfirmProvider } from "@/hooks/use-confirm";
import { SidebarV2 } from "./sidebar-v2";
import { Menu } from "lucide-react";
import type React from "react";

// Force all shadcn CSS-var tokens to light values inside the V2 shell,
// regardless of the global data-theme (which may be a dark palette).
const LIGHT_VARS: React.CSSProperties = {
  "--background":           "oklch(1 0 0)",
  "--foreground":           "oklch(0.145 0 0)",
  "--card":                 "oklch(1 0 0)",
  "--card-foreground":      "oklch(0.145 0 0)",
  "--muted":                "oklch(0.961 0 0)",
  "--muted-foreground":     "oklch(0.556 0 0)",
  "--border":               "oklch(0.922 0 0)",
  "--input":                "oklch(0.922 0 0)",
  "--primary":              "oklch(0.519 0.235 264.13)",
  "--primary-foreground":   "oklch(0.985 0 0)",
  "--popover":              "oklch(1 0 0)",
  "--popover-foreground":   "oklch(0.145 0 0)",
  "--secondary":            "oklch(0.961 0 0)",
  "--secondary-foreground": "oklch(0.205 0 0)",
  "--accent":               "oklch(0.961 0 0)",
  "--accent-foreground":    "oklch(0.205 0 0)",
  "--destructive":          "oklch(0.577 0.245 27.325)",
  "--ring":                 "oklch(0.519 0.235 264.13)",
} as React.CSSProperties;

function ShellInner({ children }: { children: React.ReactNode }) {
  const { userId, loading } = useAuth();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  // Apply light CSS vars to document.body so portal-rendered elements
  // (Dialog, Popover, DropdownMenu, etc.) also get the light palette.
  useEffect(() => {
    const body = document.body;
    Object.entries(LIGHT_VARS).forEach(([k, v]) => body.style.setProperty(k, v as string));
    return () => {
      Object.keys(LIGHT_VARS).forEach((k) => body.style.removeProperty(k));
    };
  }, []);

  useEffect(() => {
    if (!loading && !userId) {
      router.push("/login");
    }
  }, [userId, loading, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-[2.5px] border-indigo-600 border-t-transparent" />
          <p className="text-[13px] text-slate-500">Loading…</p>
        </div>
      </div>
    );
  }

  if (!userId) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 text-slate-900" style={{ fontFamily: "Inter, sans-serif", ...LIGHT_VARS }}>
      <SidebarV2
        open={sidebarOpen}
        onClose={closeSidebar}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
      />

      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Mobile top bar — visible only on sm */}
        <div className="flex h-[48px] shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-[14px] font-semibold text-slate-900">WhatsApp CRM</span>
        </div>

        <main className="flex-1 overflow-y-auto scroll-styled">{children}</main>
      </div>
    </div>
  );
}

export function DashboardShellV2({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ConfirmProvider>
        <ShellInner>{children}</ShellInner>
      </ConfirmProvider>
    </AuthProvider>
  );
}
