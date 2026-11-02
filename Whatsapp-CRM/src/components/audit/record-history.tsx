"use client"

import { useEffect, useState } from "react"
import { History } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useAuth } from "@/hooks/use-auth"
import { apiFetch } from "@/lib/api-fetch"
import { AuditEventList } from "./audit-event-list"
import { AuditEventDrawer } from "./audit-event-drawer"

const FALLBACK_TZ = "Asia/Kolkata"

/**
 * "History" for one record: the audit log filtered to it. Shown to admins
 * and owners only; the API refuses everyone else whatever the screen shows.
 * Covers the last 92 days, the longest period one query may span.
 */
export function RecordHistoryButton({
  targetType, targetId, label, className, iconOnlyOnPhone,
}: { targetType: string; targetId: string; label?: string; className?: string; iconOnlyOnPhone?: boolean }) {
  const { accountRole } = useAuth()
  const canSee = accountRole === "owner" || accountRole === "admin"
  const [open, setOpen] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [timeZone, setTimeZone] = useState(FALLBACK_TZ)
  const [since] = useState(() => new Date(Date.now() - 92 * 86_400_000 + 60_000).toISOString())

  useEffect(() => {
    if (!open) return
    apiFetch("/api/audit/summary")
      .then((r) => r.json() as Promise<{ timezone?: string }>)
      .then((s) => { if (s?.timezone) setTimeZone(s.timezone) })
      .catch((err) => console.error("[audit] zone lookup failed:", err))
  }, [open])

  if (!canSee) return null
  const query = new URLSearchParams({ target_type: targetType, target_id: targetId, from: since, limit: "50" }).toString()

  return (
    <>
      <Button type="button" variant="outline" size="sm" className={className} onClick={() => setOpen(true)} title="History of changes" aria-label={label ? `History of ${label}` : "History"}>
        <History className="h-3.5 w-3.5" aria-hidden="true" />
        <span className={iconOnlyOnPhone ? "max-sm:sr-only" : undefined}>History</span>
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto overscroll-contain data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>History</SheetTitle>
            <SheetDescription>{label ? `Everything recorded about ${label} in the last 92 days` : "Everything recorded about this record in the last 92 days"}</SheetDescription>
          </SheetHeader>
          <div className="mx-4 mb-6 overflow-hidden rounded-xl border border-slate-200">
            {open && <AuditEventList query={query} timeZone={timeZone} onOpen={setOpenId} emptyText="Nothing recorded for this record yet" />}
          </div>
        </SheetContent>
      </Sheet>
      <AuditEventDrawer eventId={openId} timeZone={timeZone} onClose={() => setOpenId(null)} onOpen={setOpenId} />
    </>
  )
}
