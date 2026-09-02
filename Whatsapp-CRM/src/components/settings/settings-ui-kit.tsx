'use client'

import type { ElementType, ReactNode } from 'react'

/**
 * Shared visual language for Settings, built from a proper design pass
 * (5 reference screenshots: HR-dashboard app-launcher tiles, a profile
 * dashboard, a stepped account-creation wizard) instead of another
 * incremental color tweak — the same rotating soft-accent tile now backs
 * BOTH the quick-access launcher below AND every config-section card
 * across Settings, which is what makes it "one common pattern" rather
 * than a one-off.
 */
export const TILE_ACCENTS = [
  { bg: '#EEF0FF', ring: '#5B6CF9', icon: '#5B6CF9' }, // violet (brand)
  { bg: '#E9FBF5', ring: '#0D9488', icon: '#0D9488' }, // teal
  { bg: '#FFF6E6', ring: '#D97706', icon: '#D97706' }, // amber
  { bg: '#FFF0F3', ring: '#E11D48', icon: '#E11D48' }, // rose
  { bg: '#EEF8FF', ring: '#0284C7', icon: '#0284C7' }, // sky
] as const

export function tileAccent(index: number) {
  return TILE_ACCENTS[index % TILE_ACCENTS.length]
}

/**
 * One launcher tile — icon in a soft rotating-accent rounded square, label
 * below. This exact shape is reused as the header icon on every config
 * section card (see SectionTile below), so a user sees the same visual
 * "unit" whether they're picking a Settings area or reading what's inside it.
 */
export function IconTile({
  icon: Icon, label, active, accentIndex, onClick,
}: {
  icon: ElementType
  label: string
  active?: boolean
  accentIndex: number
  onClick?: () => void
}) {
  const accent = tileAccent(accentIndex)
  return (
    <button
      type="button"
      onClick={onClick}
      style={active ? { boxShadow: `0 0 0 1.5px ${accent.ring}` } : undefined}
      className={`group flex flex-col items-center gap-2 rounded-2xl border p-3.5 text-center transition-all duration-150 ${
        active
          ? 'border-transparent bg-white shadow-md'
          : 'border-slate-100 bg-white shadow-sm hover:-translate-y-0.5 hover:shadow-md'
      }`}
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform duration-150 group-hover:scale-105"
        style={{ background: accent.bg }}
      >
        <Icon className="h-[18px] w-[18px]" style={{ color: accent.icon }} />
      </span>
      <span className={`text-[11.5px] font-medium leading-tight ${active ? 'text-slate-900' : 'text-slate-600'}`}>
        {label}
      </span>
    </button>
  )
}

/**
 * The config-section "tile" — same rotating-accent icon-square as IconTile,
 * now heading a full content card. Replaces the plain-white,
 * plain-indigo-icon SectionCard pattern that had drifted slightly
 * different from file to file; this is the one shape every Settings panel
 * should build its cards from.
 */
export function SectionTile({
  icon: Icon, accentIndex, title, description, statusPill, footer, children,
}: {
  icon: ElementType
  accentIndex: number
  title: string
  description?: ReactNode
  statusPill?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  const accent = tileAccent(accentIndex)
  return (
    <div className="rounded-[20px] border border-slate-100 bg-white shadow-sm overflow-hidden">
      <div className="flex items-start gap-3 px-6 py-4 border-b border-slate-100">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: accent.bg }}>
          <Icon className="h-4.5 w-4.5" style={{ color: accent.icon }} />
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-semibold text-slate-800">{title}</h3>
          {description && <p className="text-[12px] text-slate-500 mt-0.5 leading-relaxed">{description}</p>}
        </div>
        {statusPill && <div className="shrink-0">{statusPill}</div>}
      </div>
      <div className="px-6 py-5 space-y-4">{children}</div>
      {footer && (
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/70">
          {footer}
        </div>
      )}
    </div>
  )
}

/**
 * Vertical numbered stepper with a connecting line — the "Create account"
 * wizard pattern from the reference set, reused here for any ordered
 * how-to (Setup Guides, onboarding checklists). `done`/`active` steps get
 * the brand-filled circle; the rest stay outline.
 */
export function Stepper({ steps }: {
  steps: { title: string; children: ReactNode; state?: 'done' | 'active' | 'pending' }[]
}) {
  return (
    <div>
      {steps.map((step, i) => {
        const state = step.state ?? 'pending'
        const isLast = i === steps.length - 1
        return (
          <div key={i} className="flex gap-3.5">
            <div className="flex flex-col items-center">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  state === 'pending'
                    ? 'bg-slate-100 text-slate-400'
                    : 'bg-[#5B6CF9] text-white'
                }`}
              >
                {i + 1}
              </span>
              {!isLast && <span className="w-px flex-1 bg-slate-200 my-1" />}
            </div>
            <div className={`min-w-0 flex-1 ${isLast ? 'pb-0' : 'pb-5'}`}>
              <p className="text-[13px] font-semibold text-slate-800">{step.title}</p>
              <div className="text-[12px] text-slate-500 mt-1 leading-relaxed">{step.children}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
