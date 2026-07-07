"use client"

import { Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import {
  User, MessageCircle, Camera, MousePointerClick, Tag, LayoutGrid,
  Layers, Palette, Users, Bot, Database, Bell, Key, Webhook, Settings,
  ChevronRight,
} from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { WhatsAppConfig } from "@/components/settings/whatsapp-config"
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
import { InstagramConfig } from "@/components/settings/instagram-config"
import { FacebookConfig } from "@/components/settings/facebook-config"

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
    label: "Integrations",
    tabs: [
      { key: "whatsapp",     label: "WhatsApp",      icon: MessageCircle, ownerOnly: true },
      { key: "instagram",    label: "Instagram",     icon: Camera,        ownerOnly: true },
      { key: "facebook",     label: "Facebook",      icon: Settings,      ownerOnly: true },
    ],
  },
  {
    label: "Configuration",
    tabs: [
      { key: "capture",      label: "Capture",       icon: MousePointerClick },
      { key: "tags",         label: "Tags",           icon: Tag },
      { key: "custom-fields",label: "Custom Fields", icon: LayoutGrid },
      { key: "leads",        label: "Leads",          icon: Layers },
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
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
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

  const isOwner = accountRole === "owner"
  const isAdmin = isOwner || accountRole === "admin"
  const isSupervisor = isAdmin || accountRole === "supervisor"

  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    tabs: section.tabs.filter((t) => {
      if (t.ownerOnly && !isOwner) return false
      if (t.adminOnly && !isAdmin) return false
      return true
    }),
  })).filter((s) => s.tabs.length > 0)

  const firstTab = visibleSections[0]?.tabs[0]?.key ?? "profile"
  const activeTab = searchParams.get("tab") ?? firstTab

  function setTab(key: string) {
    router.push(`/settings?tab=${key}`, { scroll: false })
  }

  function renderPanel() {
    switch (activeTab) {
      case "profile":        return <ProfileForm />
      case "whatsapp":       return isOwner ? <WhatsAppConfig /> : null
      case "instagram":      return isOwner ? <InstagramConfig /> : null
      case "facebook":       return isOwner ? <FacebookConfig /> : null
      case "capture":        return <CapturePanel />
      case "tags":           return <TagManager />
      case "custom-fields":  return <CustomFieldsPanel />
      case "leads":          return isSupervisor ? <LeadsSettingsV2 /> : null
      case "appearance":     return <AppearancePanel />
      case "members":        return isAdmin ? <MembersTab /> : null
      case "ai":             return isAdmin ? <AiConfig /> : null
      case "database":       return isAdmin ? <DatabasePanel /> : null
      case "notifications":  return <NotificationsPanel />
      case "api-keys":       return isOwner ? <ApiKeysPanel /> : null
      case "webhooks":       return isOwner ? <WebhooksPanel /> : null
      default:               return <ProfileForm />
    }
  }

  return (
    <div className="flex h-full bg-[#F4F6FA]">
      {/* â”€â”€ Sidebar â”€â”€ */}
      <aside className="hidden md:flex md:w-[240px] shrink-0 flex-col bg-white border-r border-slate-200">
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#5B6CF9]/10">
              <Settings className="h-4 w-4 text-[#5B6CF9]" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-slate-800 leading-tight">Settings</p>
              <p className="text-[11px] text-slate-400 leading-tight mt-0.5">Manage your workspace</p>
            </div>
          </div>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {visibleSections.map((section) => (
            <div key={section.label}>
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
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
                        "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-all text-left",
                        isActive
                          ? "bg-[#EEF0FF] text-[#5B6CF9]"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                      )}
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-[#5B6CF9]" : "text-slate-400")} />
                      {t.label}
                      {isActive && <ChevronRight className="ml-auto h-3.5 w-3.5 text-[#5B6CF9]/60" />}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

      </aside>

      {/* â”€â”€ Mobile tab bar â”€â”€ */}
      <div className="md:hidden border-b border-slate-200 bg-white">
        <div className="flex gap-0.5 overflow-x-auto px-3 py-2">
          {visibleSections.flatMap((s) => s.tabs).map((t) => {
            const Icon = t.icon
            const isActive = activeTab === t.key
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium whitespace-nowrap transition-colors",
                  isActive ? "bg-[#EEF0FF] text-[#5B6CF9]" : "text-slate-600 hover:bg-slate-50",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* â”€â”€ Panel area â”€â”€ */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Breadcrumb */}
        <div className="hidden md:flex items-center gap-1.5 border-b border-slate-200 bg-white px-6 py-3">
          <Settings className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-[12px] text-slate-400">/</span>
          <span className="text-[12px] font-medium text-slate-600">{TAB_TITLES[activeTab] ?? activeTab}</span>
        </div>

        <div className="flex-1 overflow-y-auto p-6 lg:p-8">
          <div className="max-w-2xl">
            {renderPanel()}
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
