'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { MousePointerClick, Tag, LayoutGrid, Layers } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { CapturePanel } from '@/components/settings/capture-panel'
import { TagManager } from '@/components/settings/tag-manager'
import { CustomFieldsPanel } from '@/components/settings/custom-fields-panel'
import { LeadsSettingsV2 } from '@/components/settings/leads-settings-v2'

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(' ')
}

// `short` is the phone label — the four full labels together overflow a
// 390px screen, which left the last tab clipped behind the edge. The page
// is already titled "Contact", so "Fields" reads unambiguously there.
const SUB_TABS = [
  { key: 'capture', label: 'Capture', short: 'Capture', icon: MousePointerClick, supervisorOnly: false },
  { key: 'tags', label: 'Tags', short: 'Tags', icon: Tag, supervisorOnly: false },
  { key: 'custom-fields', label: 'Custom Fields', short: 'Fields', icon: LayoutGrid, supervisorOnly: false },
  { key: 'leads', label: 'Leads', short: 'Leads', icon: Layers, supervisorOnly: true },
] as const

/**
 * The four contact-related settings pages (Capture, Tags, Custom Fields,
 * Leads) used to be four separate top-level sidebar entries under a
 * "Configuration" section. Consolidated into one "Contact" entry with an
 * inner tab bar — they're all facets of the same thing (how a contact
 * enters, gets organized, and gets converted into a lead), and grouping
 * them cuts the sidebar down without hiding anything.
 *
 * Sub-tab selection lives in the URL (?tab=contact&sub=capture) so it
 * survives a refresh/back-button/shared link the same way the outer
 * settings tab does.
 */
export function ContactSettingsTab() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { accountRole, profileLoading } = useAuth()
  // Hierarchy check, deliberately not useAuth's `isSupervisor` — that flag
  // is an exact role match (role === "supervisor"), so it is false for an
  // owner or admin and would hide this tab from the very people who most
  // need it. The settings page's own nav gating computes it the same way.
  const isSupervisor = accountRole === 'owner' || accountRole === 'admin' || accountRole === 'supervisor'

  const visibleTabs = SUB_TABS.filter((t) => !t.supervisorOnly || isSupervisor)
  const requested = searchParams.get('sub')
  // The account role arrives a moment after mount. Resolving against the
  // role-filtered list during that window silently bounced a ?sub=leads
  // deep link to Capture (and left it there), so while the role is still
  // unknown a requested sub-tab is honoured as-is — the panel itself and
  // its API stay gated regardless of what the tab bar shows.
  const resolvableTabs = profileLoading ? SUB_TABS : visibleTabs
  const activeSub = resolvableTabs.some((t) => t.key === requested) ? requested! : visibleTabs[0].key

  function setSub(key: string) {
    router.push(`/settings?tab=contact&sub=${key}`, { scroll: false })
  }

  function renderSubPanel() {
    switch (activeSub) {
      case 'capture':       return <CapturePanel />
      case 'tags':           return <TagManager />
      case 'custom-fields':  return <CustomFieldsPanel />
      case 'leads':           return isSupervisor ? <LeadsSettingsV2 /> : null
      default:                return <CapturePanel />
    }
  }

  return (
    <div>
      {/* Evenly-divided segmented control on phones so every tab is
          reachable without a sideways scroll (the last one used to sit
          clipped past the right edge); natural-width row from sm up. */}
      <div
        role="tablist"
        aria-label="Contact settings"
        className="mb-6 grid auto-cols-fr grid-flow-col border-b border-slate-200 sm:flex sm:gap-1"
      >
        {visibleTabs.map((t) => {
          const Icon = t.icon
          const isActive = activeSub === t.key
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setSub(t.key)}
              className={cn(
                '-mb-px flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-1 py-2.5 text-[12.5px] font-medium transition-colors sm:shrink-0 sm:justify-start sm:px-3.5 sm:text-[13px]',
                isActive
                  ? 'border-[#5B6CF9] text-[#5B6CF9]'
                  : 'border-transparent text-slate-500 hover:border-slate-200 hover:text-slate-800',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate sm:hidden">{t.short}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          )
        })}
      </div>

      {renderSubPanel()}
    </div>
  )
}
