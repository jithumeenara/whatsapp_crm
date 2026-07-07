"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import {
  BarChart2,
  Bot,
  CalendarCheck,
  CheckSquare,
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
  UsersRound,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import type { AccountRole } from "@/lib/auth/roles";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; label: string; className: string }
> = {
  owner: {
    icon: Crown,
    label: "Admin",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-700",
  },
  admin: {
    icon: Shield,
    label: "Manager",
    className: "border-primary/40 bg-primary/10 text-primary",
  },
  supervisor: {
    icon: UserCheck,
    label: "Supervisor",
    className: "border-violet-500/40 bg-violet-500/10 text-violet-600",
  },
  agent: {
    icon: UserCog,
    label: "Agent",
    className: "border-slate-200 bg-slate-100 text-slate-500",
  },
  viewer: {
    icon: User,
    label: "Viewer",
    className: "border-slate-200/50 bg-white text-slate-400",
  },
};

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  beta?: boolean;
  agentAllowed?: boolean;
}

// Flat nav — dividers (null) separate visual sections, no labels
const NAV_ITEMS: (NavItem | null)[] = [
  { href: "/dashboard",  label: "Dashboard",    icon: LayoutDashboard, agentAllowed: true },
  { href: "/inbox",      label: "Inbox",        icon: MessageSquare,   agentAllowed: true },
  null,
  { href: "/contacts",   label: "Contacts",     icon: Users,           agentAllowed: true },
  { href: "/leads",      label: "Leads",        icon: TrendingUp,      agentAllowed: true },
  { href: "/follow-ups", label: "Follow-ups",   icon: CalendarCheck,   agentAllowed: true },
  { href: "/tasks",      label: "Tasks",        icon: CheckSquare,     agentAllowed: true },
  { href: "/reports",    label: "Reports",      icon: BarChart2,       agentAllowed: false },
  null,
  { href: "/broadcasts", label: "Broadcasts",   icon: Radio,           agentAllowed: false },
  { href: "/templates",  label: "Templates",    icon: FileText,        agentAllowed: false },
  null,
  { href: "/automations", label: "Automations", icon: Zap,             agentAllowed: false },
  { href: "/chatbot",    label: "Chatbot",      icon: Bot,             agentAllowed: false },
  { href: "/flows",      label: "Flows",        icon: Workflow,        agentAllowed: false },
  null,
  { href: "/data",       label: "Data Store",   icon: LayoutGrid,      agentAllowed: false },
  { href: "/files",      label: "File Manager", icon: HardDrive,       agentAllowed: false },
];

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Sidebar({ open = false, onClose, collapsed = false, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();
  const { profile, profileLoading, account, accountRole, signOut } = useAuth();
  const totalUnread = useTotalUnread();

  const isAgent = accountRole === "agent";

  const visibleItems = isAgent
    ? NAV_ITEMS.map((item) =>
        item === null ? null : item.agentAllowed ? item : null,
      )
    : NAV_ITEMS;

  // Collapse consecutive nulls into one after filtering
  const dedupedItems = visibleItems.reduce<(NavItem | null)[]>((acc, item) => {
    if (item === null && (acc.length === 0 || acc[acc.length - 1] === null)) return acc;
    acc.push(item);
    return acc;
  }, []);
  // Remove trailing divider
  while (dedupedItems.length > 0 && dedupedItems[dedupedItems.length - 1] === null) {
    dedupedItems.pop();
  }

  const showAccountStrip =
    !profileLoading &&
    !!account?.name &&
    account.name !== profile?.full_name;

  useEffect(() => {
    onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <>
      {/* Mobile backdrop */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-black/30 backdrop-blur-sm transition-opacity lg:hidden",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-full flex-col border-r border-slate-200 bg-white",
          "relative transition-all duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:z-0 lg:translate-x-0",
          collapsed ? "lg:w-[64px]" : "w-60",
        )}
        aria-label="Primary"
      >
        {/* Logo */}
        <div className={cn("flex h-14 shrink-0 items-center gap-2 border-b border-slate-200/50", collapsed ? "justify-center px-0" : "justify-between px-4")}>
          <Link href="/dashboard" className={cn("flex items-center gap-2.5", collapsed && "justify-center")}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <MessageSquare className="h-[18px] w-[18px]" />
            </div>
            {!collapsed && (
              <span className="text-[15px] font-semibold text-slate-800 tracking-tight">
                WhatsApp CRM
              </span>
            )}
          </Link>
          {!collapsed && (
            <>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close menu"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 lg:hidden"
              >
                <X className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onToggleCollapse}
                aria-label="Collapse sidebar"
                className="hidden h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 lg:flex"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </>
          )}
          {collapsed && (
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label="Expand sidebar"
              className="absolute -right-3 top-5 hidden h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-100 hover:text-slate-800 lg:flex"
            >
              <ChevronRight className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Flat navigation */}
        <nav className="sidebar-nav flex-1 overflow-y-auto px-2 py-2">
          <ul className="flex flex-col">
            {dedupedItems.map((item, idx) => {
              if (item === null) {
                if (collapsed) return null;
                return (
                  <li key={`divider-${idx}`} className="my-2 px-3">
                    <div className="h-px bg-border/50" />
                  </li>
                );
              }

              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));
              const showBadge = item.href === "/inbox" && totalUnread > 0;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "flex items-center rounded-lg transition-colors duration-100 text-[#2b2d42]",
                      collapsed ? "justify-center px-0 py-2.5" : "gap-3.5 px-3 py-3 text-[15px] font-normal",
                      isActive
                        ? "bg-primary/10 text-primary font-medium"
                        : "hover:bg-slate-100/70",
                    )}
                  >
                    <div className="relative">
                      <item.icon
                        className={cn(
                          "h-[18px] w-[18px] shrink-0",
                          isActive ? "text-primary" : "text-[#2b2d42]/50",
                        )}
                        strokeWidth={1.75}
                      />
                      {collapsed && showBadge && (
                        <span className="absolute -top-1.5 -right-1.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-emerald-500 text-[8px] font-bold text-white px-0.5">
                          {totalUnread > 9 ? "9+" : totalUnread}
                        </span>
                      )}
                    </div>
                    {!collapsed && (
                      <>
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.beta && (
                          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700">
                            Beta
                          </span>
                        )}
                        {showBadge && (
                          <span className="flex h-5 min-w-[22px] items-center justify-center rounded-full bg-foreground px-1.5 text-[10px] font-semibold text-background">
                            {totalUnread > 99 ? "99+" : totalUnread}
                          </span>
                        )}
                      </>
                    )}
                  </Link>
                </li>
              );
            })}

            {/* Settings */}
            {!isAgent && (
              <>
                {!collapsed && (
                  <li className="my-2 px-3">
                    <div className="h-px bg-border/50" />
                  </li>
                )}
                <li>
                  {(() => {
                    const isActive = pathname.startsWith("/settings");
                    return (
                      <Link
                        href="/settings"
                        title={collapsed ? "Settings" : undefined}
                        className={cn(
                          "flex items-center rounded-lg transition-colors duration-100",
                          collapsed ? "justify-center px-0 py-2.5" : "gap-3.5 px-3 py-3 text-[15px] font-normal",
                          isActive
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-[#2b2d42] hover:bg-slate-100/70",
                        )}
                      >
                        <Settings
                          className={cn(
                            "h-[18px] w-[18px] shrink-0",
                            isActive ? "text-primary" : "text-slate-800/50",
                          )}
                          strokeWidth={1.75}
                        />
                        {!collapsed && <span>Settings</span>}
                      </Link>
                    );
                  })()}
                </li>
              </>
            )}
          </ul>
        </nav>

        {/* User footer */}
        <div className="shrink-0 border-t border-slate-200 p-3">
          {!collapsed && showAccountStrip && account?.name && (
            <div className="mb-2 flex items-center gap-2 px-3 text-xs text-slate-500">
              <UsersRound className="size-3.5 shrink-0" />
              <span className="truncate" title={account.name}>
                {account.name}
              </span>
              {accountRole && (() => {
                const meta = ROLE_CHIP[accountRole];
                const Icon = meta.icon;
                return (
                  <span className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.className}`}>
                    <Icon className="size-3" />
                    {meta.label}
                  </span>
                );
              })()}
            </div>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              title={collapsed ? (profile?.full_name ?? profile?.email ?? "User") : undefined}
              className={cn(
                "flex w-full items-center rounded-xl px-3 py-2 text-left transition-colors hover:bg-slate-100 focus:bg-slate-100 focus:outline-none data-popup-open:bg-slate-100",
                collapsed ? "justify-center gap-0" : "gap-3",
              )}
            >
              <Avatar className="size-8 shrink-0">
                {profile?.avatar_url && (
                  <AvatarImage src={profile.avatar_url} alt={profile.full_name ?? "Avatar"} />
                )}
                <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                  {profile?.full_name?.charAt(0)?.toUpperCase() ??
                    profile?.email?.charAt(0)?.toUpperCase() ??
                    "U"}
                </AvatarFallback>
              </Avatar>
              {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">
                  {profile?.full_name ?? "User"}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {profile?.email ?? ""}
                </p>
              </div>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              sideOffset={6}
              className="min-w-56 bg-white text-slate-800 ring-slate-200 shadow-card-md"
            >
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    onClick={onClose}
                    className="text-slate-800/80 focus:bg-slate-100 focus:text-slate-800"
                  />
                }
              >
                <User className="size-4" />
                Profile
              </DropdownMenuItem>
              {!isAgent && (
                <DropdownMenuItem
                  render={
                    <Link
                      href="/settings?tab=whatsapp"
                      onClick={onClose}
                      className="text-slate-800/80 focus:bg-slate-100 focus:text-slate-800"
                    />
                  }
                >
                  <Settings className="size-4" />
                  Settings
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-slate-800/80 focus:bg-slate-100 focus:text-slate-800"
              >
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}
