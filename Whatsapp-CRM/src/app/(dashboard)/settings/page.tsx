"use client"

import { Suspense, useId, useMemo, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { motion, AnimatePresence, useReducedMotion } from "motion/react"
import {
  User, MousePointerClick, Tag, LayoutGrid, MessageSquare,
  Layers, Users, Bot, Database, Bell, Key, Webhook, Settings,
  Search, ShieldCheck, X, ChevronLeft, ChevronRight,
} from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useSidebarCollapse } from "@/components/layout-v2/dashboard-shell-v2"
import { ProfileForm } from "@/components/settings/profile-form"
import { CapturePanel } from "@/components/settings/capture-panel"
import { TagManager } from "@/components/settings/tag-manager"
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
  /** Extra search terms that should surface this tab even though they
   *  aren't its label — e.g. "Channels" nests WhatsApp/Instagram/Facebook/
   *  SMS/Email/RCS inside it now, so searching any of those names needs
   *  to still find it. */
  aliases?: string[]
}

const NAV_SECTIONS: { label: string; tabs: TabDef[] }[] = [
  {
    label: "Account",
    tabs: [
      { key: "profile",      label: "Profile",       icon: User, aliases: ["Appearance", "Theme"] },
      { key: "notifications",label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Business",
    tabs: [
      { key: "platform",  label: "Embedded Signup", icon: ShieldCheck,   ownerOnly: true, aliases: ["Meta App", "Tech Provider", "Quick Connect"] },
      { key: "channels",  label: "Channels",        icon: MessageSquare, ownerOnly: true, aliases: ["WhatsApp", "Instagram", "Facebook", "Messenger", "SMS", "Email", "RCS", "Business Profile"] },
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
  members: "Members",
  ai: "AI Config",
  database: "Database",
  notifications: "Notifications",
  "api-keys": "API Keys",
  webhooks: "Webhooks",
}

const TAB_DESCRIPTIONS: Record<string, string> = {
  profile: "Your name, contact details and account security",
  channels: "Connect and configure every messaging channel",
  platform: "One Meta App for the whole platform — set up once, every tenant gets one-click Facebook Connect",
  capture: "How new contacts get captured into the CRM",
  tags: "Organize your contacts with color-coded tags",
  "custom-fields": "Add extra fields to contacts — lead source, budget, or anything your team needs",
  leads: "Configure how leads are created, scored, and what call outcomes agents can record",
  members: "People with access to this account — roles control what each teammate can do",
  ai: "Configure Google Gemini for AI-powered chatbot replies",
  database: "Backup and restore the whole database",
  notifications: "Browser push alerts for new conversations, assignments, follow-ups and tasks — even when this tab is in the background",
  "api-keys": "Secret keys so external apps can read and write Data Store records via the REST API",
  webhooks: "Get an HTTPS POST whenever a Data Store record changes, signed with HMAC-SHA256",
}

function SettingsContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { accountRole, profile } = useAuth()
  const [query, setQuery] = useState("")
  const reduceMotion = useReducedMotion()
  // A fresh, unpredictable field name/id per mount — browser/extension
  // password managers (Chrome's own, LastPass, 1Password, Bitwarden, …)
  // key their "which saved login goes in this field" heuristics off a
  // stable name/id, so a random one each load stops them matching a
  // saved account email into this field (autoComplete="off" alone isn't
  // honored by most of them any more).
  const searchFieldId = useId()
  const { collapsed: sidebarCollapsed, toggle: toggleMainSidebar } = useSidebarCollapse()

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
      .map((section) => ({
        ...section,
        tabs: section.tabs.filter((t) =>
          t.label.toLowerCase().includes(q) || t.aliases?.some((a) => a.toLowerCase().includes(q))
        ),
      }))
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
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold text-slate-800 leading-tight">Settings</p>
              <p className="truncate text-[11px] text-slate-400 leading-tight mt-0.5">{profile?.account_role ? `Signed in as ${profile.account_role}` : "Manage your workspace"}</p>
            </div>
            <button
              type="button"
              onClick={toggleMainSidebar}
              title={sidebarCollapsed ? "Expand main menu" : "Collapse main menu"}
              aria-label={sidebarCollapsed ? "Expand main menu" : "Collapse main menu"}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            >
              {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              id={searchFieldId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search settings…"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              name={searchFieldId}
              aria-autocomplete="none"
              data-lpignore="true"
              data-1p-ignore="true"
              data-bwignore="true"
              data-form-type="other"
              data-form-type-ignore="true"
              className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-7 text-[12.5px] text-slate-700 placeholder:text-slate-400 outline-none transition-all focus:border-[#5B6CF9]/40 focus:bg-white focus:ring-2 focus:ring-[#5B6CF9]/10 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto sidebar-nav px-3 pb-3 space-y-4">
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

      {/* Mobile search — the sidebar (which normally holds it) is
          desktop-only, so search needs its own home here. */}
      <div className="md:hidden border-b border-slate-200 bg-white px-3 py-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings…"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            name={`${searchFieldId}-mobile`}
            aria-autocomplete="none"
            data-lpignore="true"
            data-1p-ignore="true"
            data-bwignore="true"
            className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-7 text-[12.5px] text-slate-700 placeholder:text-slate-400 outline-none transition-all focus:border-[#5B6CF9]/40 focus:bg-white focus:ring-2 focus:ring-[#5B6CF9]/10 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Mobile nav (pill bar, sidebar's list equivalent) ── */}
      <div className="md:hidden border-b border-slate-200 bg-white">
        <div className="flex gap-1.5 overflow-x-auto px-3 py-2.5">
          {filteredSections.flatMap((s) => s.tabs).map((t) => {
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
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 lg:p-8">
          <div className="mb-5">
            <h1 className="text-[19px] font-bold text-slate-900">{TAB_TITLES[activeTab] ?? activeTab}</h1>
            <p className="text-[13px] text-slate-500 mt-0.5">{TAB_DESCRIPTIONS[activeTab] ?? ""}</p>
          </div>

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
