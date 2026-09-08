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

const SUB_TABS = [
  { key: 'capture', label: 'Capture', icon: MousePointerClick, supervisorOnly: false },
  { key: 'tags', label: 'Tags', icon: Tag, supervisorOnly: false },
  { key: 'custom-fields', label: 'Custom Fields', icon: LayoutGrid, supervisorOnly: false },
  { key: 'leads', label: 'Leads', icon: Layers, supervisorOnly: true },
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
  const { accountRole } = useAuth()
  const isSupervisor = accountRole === 'owner' || accountRole === 'admin' || accountRole === 'supervisor'

  const visibleTabs = SUB_TABS.filter((t) => !t.supervisorOnly || isSupervisor)
  const requested = searchParams.get('sub')
  const activeSub = visibleTabs.some((t) => t.key === requested) ? requested! : visibleTabs[0].key

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
      <div role="tablist" aria-label="Contact settings" className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200">
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
                '-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors',
                isActive
                  ? 'border-[#5B6CF9] text-[#5B6CF9]'
                  : 'border-transparent text-slate-500 hover:border-slate-200 hover:text-slate-800',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          )
        })}
      </div>

      {renderSubPanel()}
    </div>
  )
}
