"use client"

import { BuildBadge } from "@/components/settings/build-badge"
import { Suspense, useMemo, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { motion, AnimatePresence, useReducedMotion } from "motion/react"
import {
  User, Contact, MessageSquare,
  Users, Bot, Database, Bell, Key, Webhook, Settings,
  Search, ShieldCheck, X, ChevronLeft, ChevronRight, Megaphone, ShoppingBag, IndianRupee,
  Phone,
} from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useSidebarCollapse } from "@/components/layout-v2/dashboard-shell-v2"
import { ProfileForm } from "@/components/settings/profile-form"
import { ContactSettingsTab } from "@/components/settings/contact-settings-tab"
import { MembersTab } from "@/components/settings/members-tab"
import { AiConfig } from "@/components/settings/ai-config"
import { DatabasePanel } from "@/components/settings/database-panel"
import { NotificationsPanel } from "@/components/settings/notifications-panel"
import { ApiKeysPanel } from "@/components/settings/api-keys-panel"
import { WebhooksPanel } from "@/components/settings/webhooks-panel"
import { ChannelsTab } from "@/components/settings/channels-tab"
import { PlatformMetaTab } from "@/components/settings/platform-meta-tab"
import { AdsTab } from "@/components/settings/ads-tab"
import { CatalogTab } from "@/components/settings/catalog-tab"
import { PaymentsTab } from "@/components/settings/payments-tab"
import { CallsTab } from "@/components/settings/calls-tab"

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
      { key: "platform",     label: "Embedded Signup",icon: ShieldCheck, ownerOnly: true, aliases: ["Meta App", "Tech Provider", "Quick Connect"] },
    ],
  },
  {
    label: "Business",
    tabs: [
      { key: "channels",  label: "Channels",        icon: MessageSquare, ownerOnly: true, aliases: ["WhatsApp", "Instagram", "Facebook", "Messenger", "SMS", "Email", "RCS", "Business Profile"] },
      { key: "ads",       label: "Ads",             icon: Megaphone,     ownerOnly: true, aliases: ["Meta Ads", "Google Ads", "Facebook Ads", "Advertising", "Pixel", "Conversions API", "Lead Ads"] },
      { key: "catalog",   label: "Catalog",         icon: ShoppingBag,   ownerOnly: true, aliases: ["Products", "Commerce", "Meta Catalog", "WhatsApp Shop", "Orders"] },
      { key: "payments",  label: "Payments",        icon: IndianRupee,   ownerOnly: true, aliases: ["UPI", "Razorpay", "In-chat Payments", "India"] },
      { key: "calls",     label: "Calls",           icon: Phone,         ownerOnly: false, aliases: ["Voice", "Call", "SIP", "Ring", "Missed calls"] },
      // Capture/Tags/Custom Fields/Leads used to be four separate
      // sidebar entries (then a standalone "Configuration" group of one)
      // — collapsed into a single "Contact" entry with an inner tab bar
      // (contact-settings-tab.tsx), since they're all facets of the same
      // thing. Leads itself is still supervisor-gated inside that tab
      // bar; this outer entry stays visible to everyone so Capture/Tags/
      // Custom Fields aren't hidden from non-supervisors.
      { key: "contact",   label: "Contact",         icon: Contact,       aliases: ["Capture", "Tags", "Custom Fields", "Custom Field", "Leads", "Lead Scoring", "Call Outcomes"] },
    ],
  },
  {
    label: "Team",
    tabs: [
      { key: "members",      label: "Members",       icon: Users,    adminOnly: true },
      { key: "ai",           label: "AI Config",     icon: Bot,      adminOnly: true },
    ],
  },
  {
    label: "Developer",
    tabs: [
      { key: "database",     label: "Database",      icon: Database, adminOnly: true },
      { key: "api-keys",     label: "API Keys",      icon: Key,     ownerOnly: true },
      { key: "webhooks",     label: "Webhooks",      icon: Webhook, ownerOnly: true },
    ],
  },
]

const TAB_TITLES: Record<string, string> = {
  profile: "Profile",
  channels: "Channels",
  ads: "Ads",
  catalog: "Catalog",
  payments: "Payments",
  calls: "Calls",
  platform: "Embedded Signup",
  contact: "Contact",
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
  ads: "Connect your ad platforms to track leads and ROI without leaving this CRM",
  catalog: "Connect a Meta product catalog to sell through WhatsApp — products, carts, and orders",
  payments: "Collect UPI payments in-chat — requires Meta's explicit per-number approval",
  calls: "Who answers a call, how long it rings, and what the assistant does with it",
  platform: "One Meta App for the whole platform — set up once, every tenant gets one-click Facebook Connect",
  contact: "How contacts get captured, tagged, enriched with custom fields, and converted into leads",
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
  //
  // Was useId() — a real bug: React's useId() is deliberately
  // deterministic (it must match server and client output for
  // hydration), so it returns the SAME string on every page load for
  // this same component tree, not a random one. That gave every visit
  // the identical field name/id, which is exactly what a browser's
  // "remembered value for this field" history keys off — so the very
  // thing this comment claimed to defend against was never actually
  // happening. Found live (Sept 2026): the search box kept getting
  // autofilled with the signed-in account's own email despite every
  // other anti-autofill attribute already being set below. A value
  // generated once per mount with Math.random() actually changes every
  // time, which useId() never did.
  const [searchFieldId] = useState(() => Math.random().toString(36).slice(2))
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
  const requestedTab = searchParams.get("tab")
  const activeTab = requestedTab ?? firstTab

  // Mobile is a drill-down, not a squeezed copy of the desktop two-pane
  // layout: /settings with no ?tab= is the index list, ?tab=x is that
  // panel full-width with a back header. Desktop ignores this entirely —
  // it always has a panel showing (falling back to the first tab), since
  // the sidebar is always there to navigate from.
  const showMobileIndex = !requestedTab

  function setTab(key: string) {
    router.push(`/settings?tab=${key}`, { scroll: false })
  }

  function backToIndex() {
    router.push("/settings", { scroll: false })
  }

  function renderPanel() {
    switch (activeTab) {
      case "profile":          return <ProfileForm />
      case "channels":         return isOwner ? <ChannelsTab /> : null
      case "ads":              return isOwner ? <AdsTab /> : null
      case "catalog":          return isOwner ? <CatalogTab /> : null
      case "payments":         return isOwner ? <PaymentsTab /> : null
      case "calls":            return <CallsTab />
      case "platform":         return isOwner ? <PlatformMetaTab /> : null
      case "contact":          return <ContactSettingsTab />
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
    // Column on mobile (drill-down), row on desktop (sidebar + panel).
    // This was `flex` at every breakpoint, which laid the mobile search
    // bar, mobile nav and the panel out as three side-by-side columns —
    // the panel ended up off-screen, so no setting was reachable at all
    // on a phone. Height is only pinned from md up: on mobile the page
    // flows naturally and the shell's <main> does the scrolling, which
    // avoids a nested scroll container inside a scroll container.
    <div className="flex min-h-full flex-col md:h-full md:flex-row bg-[#F7F8FB]">
      {/* ── Sidebar (desktop) ── */}
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

        {/* Pinned to the foot of the sidebar: which build is actually
            serving this page. Silent when the build matches the code,
            loud when it does not. */}
        <div className="border-t border-slate-100 px-3 py-2">
          <BuildBadge />
        </div>
      </aside>

      {/* ── Mobile: index list ──────────────────────────────────────
          A grouped, full-width list of every settings entry — the phone
          equivalent of the desktop sidebar. Replaces a horizontal pill
          scroller that could only ever show two or three of the
          thirteen entries at once and dropped the group headings. */}
      <div className={cn("md:hidden", !showMobileIndex && "hidden")}>
        <div className="px-4 pt-5 pb-3">
          <h1 className="text-[24px] font-bold tracking-tight text-slate-900">Settings</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            {profile?.account_role ? `Signed in as ${profile.account_role}` : "Manage your workspace"}
          </p>

          <div className="relative mt-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
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
              data-form-type="other"
              data-form-type-ignore="true"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-9 text-[14px] text-slate-700 placeholder:text-slate-400 outline-none transition-all focus:border-[#5B6CF9]/40 focus:ring-2 focus:ring-[#5B6CF9]/10 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 active:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div className="space-y-5 px-4 pb-8">
          {filteredSections.length === 0 && (
            <p className="py-10 text-center text-[13px] text-slate-400">No settings match &quot;{query}&quot;</p>
          )}
          {filteredSections.map((section) => (
            <div key={section.label}>
              <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                {section.label}
              </p>
              <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
                {section.tabs.map((t, i) => {
                  const Icon = t.icon
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setTab(t.key)}
                      className={cn(
                        "flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors active:bg-slate-50",
                        i > 0 && "border-t border-slate-100",
                      )}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#EEF0FF]">
                        <Icon className="h-4 w-4 text-[#5B6CF9]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14.5px] font-semibold leading-tight text-slate-800">{t.label}</span>
                        {TAB_DESCRIPTIONS[t.key] && (
                          <span className="mt-0.5 block truncate text-[11.5px] leading-tight text-slate-400">
                            {TAB_DESCRIPTIONS[t.key]}
                          </span>
                        )}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Panel area ──
          On mobile this is the drill-down "detail" screen (hidden while
          the index is showing); on desktop it's the right-hand pane. */}
      <div
        className={cn(
          "flex-1 min-w-0 flex flex-col md:overflow-hidden",
          showMobileIndex && "hidden md:flex",
        )}
      >
        {/* Mobile detail header — sticks to the top of the shell's own
            scroll container while the panel scrolls under it. */}
        <div className="sticky top-0 z-20 flex items-center gap-1 border-b border-slate-200 bg-white/95 px-2 py-2 backdrop-blur-sm md:hidden">
          <button
            type="button"
            onClick={backToIndex}
            aria-label="Back to settings"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 active:bg-slate-100"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-slate-900">
            {TAB_TITLES[activeTab] ?? activeTab}
          </p>
        </div>

        <div className="flex-1 px-4 py-5 md:overflow-y-auto md:p-6 lg:p-8">
          <div className="mb-5">
            <h1 className="hidden text-[19px] font-bold text-slate-900 md:block">{TAB_TITLES[activeTab] ?? activeTab}</h1>
            <p className="text-[13px] leading-relaxed text-slate-500 md:mt-0.5">{TAB_DESCRIPTIONS[activeTab] ?? ""}</p>
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
