"use client"

import { Suspense, useMemo, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { motion, AnimatePresence, useReducedMotion } from "motion/react"
import {
  User, MousePointerClick, Tag, LayoutGrid, MessageSquare,
  Layers, Palette, Users, Bot, Database, Bell, Key, Webhook, Settings,
  Search, ShieldCheck, X,
} from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { ProfileForm } from "@/components/settings/profile-form"
import { CapturePanel } from "@/components/settings/capture-panel"
import { TagManager } from "@/components/settings/tag-manager"
import { AppearancePanel } from "@/components/settings/appearance-panel"
import { MembersTab } from "@/components/settings/members-tab"
import { AiConfig } from "@/components/settings/ai-config"
import { DatabasePanel } from "@/components/settings/database-panel"
import { NotificationsPanel } from "@/components/settings/notifications-panel"
import { ApiKeysPanel } from "@/components/settings/api-keys-panel"
import { WebhooksPanel } from "@/components/settings/webhooks-panel"
import { LeadsSettingsV2 } from "@/components/settings/leads-settings-v2"
import { CustomFieldsPanel } from "@/components/settings/custom-fields-panel"
import { ChannelsTab } from "@/components/settings/channels-tab"
import { PlatformMetaTab } from "@/components/settings/platform-meta-tab"

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

interface TabDef {
  key: string
  label: string
  icon: React.ElementType
  ownerOnly?: boolean
  adminOnly?: boolean
  supervisorOnly?: boolean
}

const NAV_SECTIONS: { label: string; tabs: TabDef[] }[] = [
  {
    label: "Account",
    tabs: [
      { key: "profile",      label: "Profile",       icon: User },
      { key: "appearance",   label: "Appearance",    icon: Palette },
      { key: "notifications",label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Business",
    tabs: [
      { key: "platform",  label: "Embedded Signup", icon: ShieldCheck,   ownerOnly: true },
      { key: "channels",  label: "Channels",        icon: MessageSquare, ownerOnly: true },
    ],
  },
  {
    label: "Configuration",
    tabs: [
      { key: "capture",      label: "Capture",       icon: MousePointerClick },
      { key: "tags",         label: "Tags",           icon: Tag },
      { key: "custom-fields",label: "Custom Fields", icon: LayoutGrid },
      { key: "leads",        label: "Leads",          icon: Layers, supervisorOnly: true },
    ],
  },
  {
    label: "Team",
    tabs: [
      { key: "members",      label: "Members",       icon: Users,    adminOnly: true },
      { key: "ai",           label: "AI Config",     icon: Bot,      adminOnly: true },
      { key: "database",     label: "Database",      icon: Database, adminOnly: true },
    ],
  },
  {
    label: "Developer",
    tabs: [
      { key: "api-keys",     label: "API Keys",      icon: Key,     ownerOnly: true },
      { key: "webhooks",     label: "Webhooks",      icon: Webhook, ownerOnly: true },
    ],
  },
]

const TAB_TITLES: Record<string, string> = {
  profile: "Profile",
  channels: "Channels",
  platform: "Embedded Signup",
  capture: "Capture",
  tags: "Tags",
  "custom-fields": "Custom Fields",
  leads: "Leads",
  appearance: "Appearance",
  members: "Members",
  ai: "AI Config",
  database: "Database",
  notifications: "Notifications",
  "api-keys": "API Keys",
  webhooks: "Webhooks",
}

function SettingsContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { accountRole, profile } = useAuth()
  const [query, setQuery] = useState("")
  const reduceMotion = useReducedMotion()

  const isOwner = accountRole === "owner"
  const isAdmin = isOwner || accountRole === "admin"
  const isSupervisor = isAdmin || accountRole === "supervisor"

  const visibleSections = useMemo(() => NAV_SECTIONS.map((section) => ({
    ...section,
    tabs: section.tabs.filter((t) => {
      if (t.ownerOnly && !isOwner) return false
      if (t.adminOnly && !isAdmin) return false
      if (t.supervisorOnly && !isSupervisor) return false
      return true
    }),
  })).filter((s) => s.tabs.length > 0), [isOwner, isAdmin, isSupervisor])

  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return visibleSections
    return visibleSections
      .map((section) => ({ ...section, tabs: section.tabs.filter((t) => t.label.toLowerCase().includes(q)) }))
      .filter((s) => s.tabs.length > 0)
  }, [visibleSections, query])

  const firstTab = visibleSections[0]?.tabs[0]?.key ?? "profile"
  const activeTab = searchParams.get("tab") ?? firstTab

  function setTab(key: string) {
    router.push(`/settings?tab=${key}`, { scroll: false })
  }

  function renderPanel() {
    switch (activeTab) {
      case "profile":          return <ProfileForm />
      case "channels":         return isOwner ? <ChannelsTab /> : null
      case "platform":         return isOwner ? <PlatformMetaTab /> : null
      case "capture":          return <CapturePanel />
      case "tags":             return <TagManager />
      case "custom-fields":    return <CustomFieldsPanel />
      case "leads":            return isSupervisor ? <LeadsSettingsV2 /> : null
      case "appearance":       return <AppearancePanel />
      case "members":          return isAdmin ? <MembersTab /> : null
      case "ai":               return isAdmin ? <AiConfig /> : null
      case "database":         return isAdmin ? <DatabasePanel /> : null
      case "notifications":    return <NotificationsPanel />
      case "api-keys":         return isOwner ? <ApiKeysPanel /> : null
      case "webhooks":         return isOwner ? <WebhooksPanel /> : null
      default:                 return <ProfileForm />
    }
  }

  return (
    <div className="flex h-full bg-[#F7F8FB]">
      {/* ── Sidebar ── */}
      <aside className="hidden md:flex md:w-[264px] shrink-0 flex-col bg-white border-r border-slate-200/80">
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#5B6CF9] shadow-sm shadow-[#5B6CF9]/30">
              <Settings className="h-4.5 w-4.5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-slate-800 leading-tight">Settings</p>
              <p className="truncate text-[11px] text-slate-400 leading-tight mt-0.5">{profile?.account_role ? `Signed in as ${profile.account_role}` : "Manage your workspace"}</p>
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search settings…"
              className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-7 text-[12.5px] text-slate-700 placeholder:text-slate-400 outline-none transition-all focus:border-[#5B6CF9]/40 focus:bg-white focus:ring-2 focus:ring-[#5B6CF9]/10"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-3 space-y-4">
          {filteredSections.length === 0 && (
            <p className="px-2 py-6 text-center text-[12.5px] text-slate-400">No settings match &quot;{query}&quot;</p>
          )}
          {filteredSections.map((section) => (
            <div key={section.label}>
              <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.tabs.map((t) => {
                  const Icon = t.icon
                  const isActive = activeTab === t.key
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setTab(t.key)}
                      className={cn(
                        "group w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-all text-left",
                        isActive
                          ? "bg-[#EEF0FF] text-[#5B6CF9]"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                      )}
                    >
                      <span className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors",
                        isActive ? "bg-white" : "bg-slate-100 group-hover:bg-slate-200/70",
                      )}>
                        <Icon className={cn("h-3.5 w-3.5", isActive ? "text-[#5B6CF9]" : "text-slate-500")} />
                      </span>
                      {t.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* ── Mobile nav ── */}
      <div className="md:hidden border-b border-slate-200 bg-white">
        <div className="flex gap-1.5 overflow-x-auto px-3 py-2.5">
          {visibleSections.flatMap((s) => s.tabs).map((t) => {
            const Icon = t.icon
            const isActive = activeTab === t.key
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "shrink-0 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium whitespace-nowrap transition-colors",
                  isActive ? "bg-[#EEF0FF] text-[#5B6CF9]" : "bg-slate-100 text-slate-600",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Panel area ── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="hidden md:flex items-center gap-1.5 border-b border-slate-200/80 bg-white/60 backdrop-blur px-6 py-3">
          <Settings className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-[12px] text-slate-300">/</span>
          <span className="text-[12px] font-medium text-slate-600">{TAB_TITLES[activeTab] ?? activeTab}</span>
        </div>

        <div className="flex-1 overflow-y-auto p-6 lg:p-8">
          <div className="max-w-2xl">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={reduceMotion ? undefined : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              >
                {renderPanel()}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SettingsV2() {
  return (
    <Suspense fallback={
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-[2.5px] border-[#5B6CF9] border-t-transparent" />
      </div>
    }>
      <SettingsContent />
    </Suspense>
  )
}
