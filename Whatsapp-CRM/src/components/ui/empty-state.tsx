import * as React from "react"

import { cn } from "@/lib/utils"

interface EmptyStateProps {
  /** A lucide icon element; decorative, so it is hidden from screen readers. */
  icon?: React.ReactNode
  title: string
  /** One plain sentence. */
  description?: string
  /** Optional button or link. */
  action?: React.ReactNode
  className?: string
}

function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn("flex flex-col items-center gap-1.5 px-4 py-8 text-center", className)}
    >
      {icon ? (
        <div aria-hidden="true" className="mb-1 flex size-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 [&_svg]:size-4">
          {icon}
        </div>
      ) : null}
      <p className="text-[14px] font-semibold text-slate-800">{title}</p>
      {description ? <p className="max-w-xs text-[12.5px] text-slate-600">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export { EmptyState }
