"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { ConfirmProvider } from "@/hooks/use-confirm";
import { SidebarV2 } from "./sidebar-v2";
import { Menu } from "lucide-react";
import type React from "react";

/**
 * Lets child pages hide the mobile shell top bar (e.g. inbox thread view)
 * and close the mobile nav drawer. The drawer close is needed because the
 * drawer's own auto-close effect only watches the route's pathname —
 * navigating within the same page (e.g. inbox switching `?c=<id>` between
 * conversations) doesn't change the pathname, so a drawer left open before
 * that switch would otherwise stay open, floating over the new content.
 */
const MobileBarCtx = createContext<{ hide: () => void; show: () => void; closeSidebar: () => void }>({
  hide: () => {},
  show: () => {},
  closeSidebar: () => {},
});
export function useMobileBar() { return useContext(MobileBarCtx); }

/**
 * The main app sidebar's collapsed state + manual toggle, exposed so a
 * page (Settings, which has its own inner sidebar) can render its own
 * collapse/expand control instead of only the one inside SidebarV2 itself
 * — useful since SidebarV2 shrinks to icon-only right when Settings makes
 * it auto-collapse (see the effect in ShellInner below), so its own
 * toggle becomes a small target right when it's most wanted.
 */
const SidebarCollapseCtx = createContext<{ collapsed: boolean; toggle: () => void }>({
  collapsed: false,
  toggle: () => {},
});
export function useSidebarCollapse() { return useContext(SidebarCollapseCtx); }

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
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Starts pre-collapsed if the user's first load IS Settings (direct nav
  // or a refresh) — otherwise the auto-collapse effect below only fires on
  // an actual route change, so a fresh mount wouldn't catch it.
  const [collapsed, setCollapsed] = useState(() => pathname.startsWith("/settings"));
  const [mobileBarHidden, setMobileBarHidden] = useState(false);
  const prevPathRef = useRef(pathname);

  // Auto-collapse the main sidebar the moment the user enters Settings
  // (it has its own inner sidebar — two full-width sidebars at once wastes
  // space), and auto-expand it back the moment they leave. Only fires on
  // an actual Settings-boundary crossing, not on every route change, so a
  // manual collapse/expand elsewhere in the app isn't fought or reset by
  // navigating between two non-Settings pages. This is a real side effect
  // (reacting to a route change from outside this component), so it
  // belongs in an effect — not in render, where an early return above a
  // render-phase state adjustment could skip it on some renders.
  useEffect(() => {
    const prev = prevPathRef.current;
    if (prev !== pathname) {
      const wasSettings = prev.startsWith("/settings");
      const isSettings = pathname.startsWith("/settings");
      // These two setState calls react to an external route change (not
      // this component's own last render), and the boundary check above
      // already limits them to real Settings-in/out crossings — not every
      // render — so the cascading-render concern the lint rule guards
      // against doesn't apply here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (isSettings && !wasSettings) setCollapsed(true);
      else if (!isSettings && wasSettings) setCollapsed(false);
      prevPathRef.current = pathname;
    }
  }, [pathname]);

  const toggleCollapsed = useCallback(() => setCollapsed((v) => !v), []);
  const sidebarCollapseCtx = useMemo(() => ({ collapsed, toggle: toggleCollapsed }), [collapsed, toggleCollapsed]);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const hideBar = useCallback(() => setMobileBarHidden(true), []);
  const showBar = useCallback(() => setMobileBarHidden(false), []);
  const mobileBarCtx = useMemo(
    () => ({ hide: hideBar, show: showBar, closeSidebar }),
    [hideBar, showBar, closeSidebar],
  );

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
      <div className="flex h-dvh items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-[2.5px] border-indigo-600 border-t-transparent" />
          <p className="text-[13px] text-slate-500">Loading…</p>
        </div>
      </div>
    );
  }

  if (!userId) return null;

  return (
    <SidebarCollapseCtx.Provider value={sidebarCollapseCtx}>
    <MobileBarCtx.Provider value={mobileBarCtx}>
      <div className="flex h-dvh overflow-hidden bg-slate-50 text-slate-900" style={{ fontFamily: "Inter, sans-serif", ...LIGHT_VARS }}>
        <SidebarV2
          open={sidebarOpen}
          onClose={closeSidebar}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
        />

        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          {/* Mobile top bar — hidden when a page requests it (e.g. inbox thread) */}
          {!mobileBarHidden && (
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
          )}

          <main className="flex-1 overflow-y-auto scroll-styled">{children}</main>
        </div>
      </div>
    </MobileBarCtx.Provider>
    </SidebarCollapseCtx.Provider>
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
