"use client"

/**
 * Which ad this lead came from, and every ad its customer arrived through
 * (GET /api/leads/[id]/ad-journey). Shows nothing for a lead that did not
 * come from an ad.
 */

import { useEffect, useState } from "react"
import { Megaphone } from "lucide-react"
import { apiFetch } from "@/lib/api-fetch"

interface Names { adName: string | null; adsetName: string | null; campaignName: string | null; thumbnailUrl: string | null; status: string | null }
interface Touch extends Names { channel: string; seenOn: "facebook" | "instagram" | null; adId: string | null; postId: string | null; headline: string | null; at: string; day: string }
interface Journey {
  ad: (Names & { adId: string; headline: string | null; channel: string | null; seenOn: "facebook" | "instagram" | null; namesMissing: string | null }) | null
  touches: Touch[]
}

/** Where they wrote to us. */
const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", messenger: "Messenger", instagram: "Instagram Direct", lead_form: "Lead form" }
/** Where they saw the ad; unknown is said plainly, never guessed. */
const SEEN = (s: "facebook" | "instagram" | null) => (s === "facebook" ? "Facebook" : s === "instagram" ? "Instagram" : "Facebook or Instagram")

function title(n: { adName: string | null; headline: string | null; adId?: string | null; postId?: string | null }) {
  return n.adName ?? n.headline ?? (n.adId ? `Ad ${n.adId}` : n.postId ? "Boosted post" : "Ad")
}

export function LeadAdCard({ leadId }: { leadId: string }) {
  const [data, setData] = useState<Journey | null>(null)

  useEffect(() => {
    let live = true
    apiFetch(`/api/leads/${leadId}/ad-journey`)
      .then((r) => r.json())
      .then((j: Journey) => { if (live) setData(j) })
      // Optional card: a failed read leaves the rest of the page working.
      .catch((err) => console.error("[lead ad] load failed:", err))
    return () => { live = false }
  }, [leadId])

  const touches = data?.touches ?? []
  if (!data || (!data.ad && touches.length === 0)) return null
  const first = data.ad
  const later = first ? touches.filter((t) => t.adId !== first.adId) : touches

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <Megaphone className="h-3.5 w-3.5" aria-hidden="true" /> Came from an ad
      </p>
      {first && (
        <div className="flex items-start gap-3">
          {first.thumbnailUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={first.thumbnailUrl} alt="" width={48} height={48} loading="lazy" referrerPolicy="no-referrer" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
          )}
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-slate-900 [overflow-wrap:anywhere]">{title(first)}</p>
            {first.campaignName && <p className="text-[12.5px] text-slate-600 [overflow-wrap:anywhere]">Campaign: {first.campaignName}{first.adsetName ? ` · ${first.adsetName}` : ""}</p>}
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12.5px]">
              <dt className="text-slate-500">Ad seen on</dt>
              <dd className="font-medium text-slate-800">{SEEN(first.seenOn)}</dd>
              <dt className="text-slate-500">Came in on</dt>
              <dd className="font-medium text-slate-800">{first.channel ? CHANNEL[first.channel] ?? first.channel : "—"}</dd>
            </dl>
            {first.status && first.status !== "ACTIVE" && <p className="mt-0.5 text-[12px] text-slate-500">Ad is {first.status.toLowerCase().replace(/_/g, " ")}</p>}
            {first.namesMissing && !first.adName && <p className="mt-1 text-[12px] text-slate-500">{first.namesMissing}</p>}
          </div>
        </div>
      )}
      {later.length > 0 && (
        <div className={first ? "mt-4 border-t border-slate-100 pt-3" : ""}>
          <p className="mb-1.5 text-[12px] font-medium text-slate-600">{first ? "Came back through" : "Arrived through"}</p>
          <ul className="space-y-1.5">
            {later.slice(0, 5).map((t, i) => (
              <li key={`${t.at}-${i}`} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                <span className="min-w-0 text-slate-700 [overflow-wrap:anywhere]">{title(t)}{t.campaignName ? ` · ${t.campaignName}` : ""}</span>
                <span className="shrink-0 text-slate-500">{SEEN(t.seenOn)} → {CHANNEL[t.channel] ?? t.channel} · {t.day}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
