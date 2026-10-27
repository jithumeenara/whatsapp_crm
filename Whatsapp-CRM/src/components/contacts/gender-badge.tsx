import { Mars, Transgender, Venus } from "lucide-react"

const LOOK: Record<string, { label: string; icon: typeof Mars; cls: string }> = {
  male: { label: "Male", icon: Mars, cls: "bg-sky-50 text-sky-700" },
  female: { label: "Female", icon: Venus, cls: "bg-pink-50 text-pink-700" },
  trans: { label: "Trans", icon: Transgender, cls: "bg-violet-50 text-violet-700" },
}

/** A contact's gender, small, with its sign. Nothing when not given. */
export function GenderBadge({ gender }: { gender?: string | null }) {
  const look = gender ? LOOK[gender] : undefined
  if (!look) return null
  const Icon = look.icon
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${look.cls}`}>
      <Icon className="h-3 w-3" aria-hidden="true" /> {look.label}
    </span>
  )
}
