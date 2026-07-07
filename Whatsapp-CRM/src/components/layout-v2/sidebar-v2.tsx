"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import {
  BarChart2,
  Bot,
  ChevronLeft,
  ChevronRight,
  Crown,
  FileText,
  HardDrive,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  MessageSquare,
  Radio,
  Settings,
  Shield,
  TrendingUp,
  User,
  UserCheck,
  UserCog,
  Users,
  Workflow,
  Zap,
  Globe,
  Plug,
  Kanban,
} from "lucide-react";
import type { AccountRole } from "@/lib/auth/roles";

// ---- types ----

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  agentAllowed?: boolean;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

// ---- navigation ----

const NAV_SECTIONS: NavSection[] = [
  {
    label: "CRM",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, agentAllowed: true },
      { href: "/leads",     label: "Leads",     icon: TrendingUp,      agentAllowed: true },
      { href: "/pipelines", label: "Pipelines", icon: Kanban,          agentAllowed: false },
      { href: "/contacts",  label: "Contacts",  icon: Users,           agentAllowed: true },
      { href: "/reports",   label: "Reports",   icon: BarChart2,       agentAllowed: false },
    ],
  },
  {
    label: "Messaging",
    items: [
      { href: "/inbox",      label: "Inbox",      icon: MessageSquare, agentAllowed: true },
      { href: "/broadcasts", label: "Broadcasts", icon: Radio,         agentAllowed: false },
      { href: "/templates",  label: "Templates",  icon: FileText,      agentAllowed: false },
    ],
  },
  {
    label: "Automation",
    items: [
      { href: "/automations", label: "Automations", icon: Zap,      agentAllowed: false },
      { href: "/chatbot",     label: "Chatbot",     icon: Bot,      agentAllowed: false },
      { href: "/flows",       label: "Flows",       icon: Workflow, agentAllowed: false },
    ],
  },
  {
    label: "Tools",
    items: [
      { href: "/data",         label: "Data Store",   icon: LayoutGrid, agentAllowed: false },
      { href: "/files",        label: "File Manager", icon: HardDrive,  agentAllowed: false },
      { href: "/integrations", label: "Integrations", icon: Plug,       agentAllowed: false },
      { href: "/social",       label: "Social Media", icon: Globe,       agentAllowed: false },
    ],
  },
];

// ---- role chips ----

const ROLE_META: Record<AccountRole, { label: string; color: string }> = {
  owner:      { label: "Admin",      color: "bg-amber-100 text-amber-700 border-amber-200" },
  admin:      { label: "Manager",    color: "bg-blue-100 text-blue-700 border-blue-200" },
  supervisor: { label: "Supervisor", color: "bg-violet-100 text-violet-700 border-violet-200" },
  agent:      { label: "Agent",      color: "bg-slate-100 text-slate-600 border-slate-200" },
  viewer:     { label: "Viewer",     color: "bg-slate-50 text-slate-500 border-slate-200" },
};

const ROLE_ICON: Record<AccountRole, React.ComponentType<{ className?: string }>> = {
  owner:      Crown,
  admin:      Shield,
  supervisor: UserCheck,
  agent:      UserCog,
  viewer:     User,
};

// ---- helpers ----

function cn(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}

// ---- component ----

interface SidebarV2Props {
  open?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function SidebarV2({
  open = false,
  onClose,
  collapsed = false,
  onToggleCollapse,
}: SidebarV2Props) {
  const pathname = usePathname();
  const { profile, account, accountRole, signOut } = useAuth();
  const totalUnread = useTotalUnread();
  const isAgent = accountRole === "agent";

  useEffect(() => {
    onClose?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const initials =
    profile?.full_name?.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2) ||
    profile?.email?.charAt(0).toUpperCase() ||
    "U";

  const showAccountStrip = !!account?.name && account.name !== profile?.full_name;

  return (
    <>
      {/* Mobile backdrop */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-black/20 backdrop-blur-sm transition-opacity lg:hidden",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col bg-white border-r border-slate-200",
          "transition-all duration-200 ease-out",
          open ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:z-0 lg:translate-x-0",
          collapsed ? "lg:w-[60px]" : "w-[240px]",
        )}
        style={{ fontFamily: "Inter, sans-serif" }}
      >
        {/* Logo row */}
        <div
          className={cn(
            "flex h-[56px] shrink-0 items-center border-b border-slate-100",
            collapsed ? "justify-center px-0" : "justify-between px-4",
          )}
        >
          <Link
            href="/dashboard"
            className={cn("flex items-center gap-2.5 min-w-0", collapsed && "justify-center")}
          >
            <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-indigo-600 shadow-sm">
              <MessageSquare className="h-4 w-4 text-white" strokeWidth={2} />
            </div>
            {!collapsed && (
              <span className="text-[14px] font-semibold text-slate-900 tracking-tight truncate">
                WhatsApp CRM
              </span>
            )}
          </Link>

          {!collapsed && (
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label="Collapse sidebar"
              className="hidden lg:flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          {collapsed && (
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label="Expand sidebar"
              className="absolute -right-3 top-[18px] hidden lg:flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm hover:bg-slate-50 hover:text-slate-700"
            >
              <ChevronRight className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto scroll-styled px-2 py-3 space-y-5">
          {NAV_SECTIONS.map((section) => {
            const visibleItems = section.items.filter(
              (item) => !isAgent || item.agentAllowed,
            );
            if (visibleItems.length === 0) return null;

            return (
              <div key={section.label}>
                {!collapsed && (
                  <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                    {section.label}
                  </p>
                )}
                <ul className="space-y-0.5">
                  {visibleItems.map((item) => {
                    const isActive =
                      pathname === item.href ||
                      (item.href !== "/dashboard" && pathname.startsWith(item.href));
                    const isInbox = item.href === "/inbox";
                    const showBadge = isInbox && totalUnread > 0;

                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          title={collapsed ? item.label : undefined}
                          className={cn(
                            "flex items-center rounded-lg transition-all duration-100",
                            collapsed
                              ? "justify-center h-9 w-full"
                              : "gap-2.5 px-3 py-2 text-[13.5px]",
                            isActive
                              ? "bg-indigo-50 text-indigo-600 font-medium"
                              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                          )}
                        >
                          <div className="relative shrink-0">
                            <item.icon
                              className={cn(
                                "h-[16px] w-[16px]",
                                isActive ? "text-indigo-600" : "text-slate-400",
                              )}
                              strokeWidth={isActive ? 2 : 1.75}
                            />
                            {collapsed && showBadge && (
                              <span className="absolute -top-1.5 -right-1.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-indigo-600 text-[8px] font-bold text-white px-0.5">
                                {totalUnread > 9 ? "9+" : totalUnread}
                              </span>
                            )}
                          </div>
                          {!collapsed && (
                            <>
                              <span className="flex-1 truncate">{item.label}</span>
                              {showBadge && (
                                <span className="flex h-5 min-w-[22px] items-center justify-center rounded-full bg-indigo-600 px-1.5 text-[10px] font-semibold text-white">
                                  {totalUnread > 99 ? "99+" : totalUnread}
                                </span>
                              )}
                            </>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}

          {/* Settings (non-agents only) */}
          {!isAgent && (
            <div>
              {!collapsed && (
                <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                  Account
                </p>
              )}
              <ul className="space-y-0.5">
                <li>
                  {(() => {
                    const isActive = pathname.startsWith("/settings");
                    return (
                      <Link
                        href="/settings"
                        title={collapsed ? "Settings" : undefined}
                        className={cn(
                          "flex items-center rounded-lg transition-all duration-100",
                          collapsed
                            ? "justify-center h-9 w-full"
                            : "gap-2.5 px-3 py-2 text-[13.5px]",
                          isActive
                            ? "bg-indigo-50 text-indigo-600 font-medium"
                            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                        )}
                      >
                        <Settings
                          className={cn(
                            "h-[16px] w-[16px] shrink-0",
                            isActive ? "text-indigo-600" : "text-slate-400",
                          )}
                          strokeWidth={isActive ? 2 : 1.75}
                        />
                        {!collapsed && <span>Settings</span>}
                      </Link>
                    );
                  })()}
                </li>
              </ul>
            </div>
          )}
        </nav>

        {/* User footer */}
        <div className="shrink-0 border-t border-slate-100 p-3">
          {/* Workspace + role chip */}
          {!collapsed && showAccountStrip && account?.name && (
            <div className="mb-2 flex items-center gap-2 px-1 text-[11px] text-slate-500">
              <Users className="size-3 shrink-0 text-slate-400" />
              <span className="truncate font-medium text-slate-700" title={account.name}>
                {account.name}
              </span>
              {accountRole && (() => {
                const meta = ROLE_META[accountRole];
                const Icon = ROLE_ICON[accountRole];
                return (
                  <span className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${meta.color}`}>
                    <Icon className="size-2.5" />
                    {meta.label}
                  </span>
                );
              })()}
            </div>
          )}

          {/* Avatar row */}
          <div
            className={cn(
              "flex items-center rounded-xl px-2 py-1.5 transition-colors hover:bg-slate-50",
              collapsed ? "justify-center" : "gap-3",
            )}
          >
            {/* Avatar */}
            <div className="relative shrink-0">
              {profile?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatar_url}
                  alt={profile.full_name ?? "Avatar"}
                  className="h-8 w-8 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-[12px] font-semibold text-indigo-700">
                  {initials}
                </div>
              )}
              <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />
            </div>

            {!collapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-slate-900">
                    {profile?.full_name ?? "User"}
                  </p>
                  <p className="truncate text-[11px] text-slate-500">{profile?.email ?? ""}</p>
                </div>
                <button
                  type="button"
                  onClick={signOut}
                  title="Sign out"
                  className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
