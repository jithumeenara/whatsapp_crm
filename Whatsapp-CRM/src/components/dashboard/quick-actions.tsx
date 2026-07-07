"use client"

import Link from 'next/link'
import { UserPlus, Radio, Zap, TrendingUp } from 'lucide-react'
import type { ComponentType } from 'react'

interface Action {
  label: string
  href: string
  icon: ComponentType<{ className?: string }>
  tint: string
}

const ACTIONS: Action[] = [
  { label: 'New Contact', href: '/contacts', icon: UserPlus, tint: 'text-primary' },
  { label: 'New Lead', href: '/leads', icon: TrendingUp, tint: 'text-orange-400' },
  { label: 'New Broadcast', href: '/broadcasts/new', icon: Radio, tint: 'text-amber-400' },
  { label: 'New Automation', href: '/automations/new', icon: Zap, tint: 'text-primary' },
]

export function QuickActions() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {ACTIONS.map((a) => {
        const Icon = a.icon
        return (
          <Link
            key={a.href}
            href={a.href}
            className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 transition-colors hover:border-slate-200 hover:bg-slate-100"
          >
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 ${a.tint}`}>
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-sm font-medium text-slate-800">{a.label}</span>
          </Link>
        )
      })}
    </div>
  )
}
