"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Users, CheckCircle2, XCircle, Clock, AlertCircle, Send } from "lucide-react"
import { toast } from "sonner"

interface Broadcast {
  id: string; name: string; status: string; message?: string; template_id?: string
  scheduled_at?: string; sent_at?: string; created_at: string
  recipients_count?: number; sent_count?: number; failed_count?: number
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-slate-100 text-slate-600",
    scheduled: "bg-amber-100 text-amber-700",
    sending: "bg-blue-100 text-blue-700",
    sent: "bg-emerald-100 text-emerald-700",
    failed: "bg-rose-100 text-rose-700",
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${map[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status}
    </span>
  )
}

export default function BroadcastDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [broadcast, setBroadcast] = useState<Broadcast | null>(null)
  const [recipients, setRecipients] = useState<unknown[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch(`/api/broadcasts/${id}`).then((r) => r.json()),
      fetch(`/api/broadcasts/${id}/recipients`).then((r) => r.json()),
    ])
      .then(([b, r]) => { setBroadcast(b.broadcast ?? b); setRecipients(r.recipients ?? []) })
      .catch(() => toast.error("Failed to load broadcast"))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return (
    <div className="flex flex-col h-full bg-[#F4F6FA]">
      <div className="flex items-center gap-3 px-6 py-4 bg-white border-b border-slate-100">
        <div className="h-8 w-48 bg-slate-100 rounded animate-pulse" />
      </div>
      <div className="p-6 space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-white rounded-xl animate-pulse" />)}</div>
    </div>
  )

  if (!broadcast) return (
    <div className="flex items-center justify-center h-full bg-[#F4F6FA]">
      <div className="text-center">
        <AlertCircle className="h-8 w-8 text-slate-300 mx-auto mb-2" />
        <p className="text-[14px] text-slate-400">Broadcast not found</p>
        <button onClick={() => router.push("/broadcasts")} className="mt-2 text-[13px] text-indigo-600 hover:underline">Back</button>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col h-full bg-[#F4F6FA]">
      <div className="flex items-center gap-3 px-6 py-4 bg-white border-b border-slate-100">
        <button onClick={() => router.push("/broadcasts")} className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-slate-100">
          <ArrowLeft className="h-4 w-4 text-slate-500" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-[16px] font-bold text-slate-800">{broadcast.name}</h1>
            <StatusBadge status={broadcast.status} />
          </div>
          <p className="text-[12px] text-slate-400">Created {new Date(broadcast.created_at).toLocaleString()}</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-4 max-w-3xl">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: Users, label: "Recipients", value: broadcast.recipients_count ?? recipients.length, color: "text-indigo-600 bg-indigo-50" },
            { icon: CheckCircle2, label: "Sent", value: broadcast.sent_count ?? 0, color: "text-emerald-600 bg-emerald-50" },
            { icon: XCircle, label: "Failed", value: broadcast.failed_count ?? 0, color: "text-rose-600 bg-rose-50" },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm flex items-center gap-3">
              <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${color}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[20px] font-bold text-slate-800">{value}</p>
                <p className="text-[11px] text-slate-400">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Message */}
        {broadcast.message && (
          <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Message</p>
            <p className="text-[13px] text-slate-700 whitespace-pre-wrap">{broadcast.message}</p>
          </div>
        )}

        {/* Schedule info */}
        <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-3">Schedule</p>
          <div className="grid grid-cols-2 gap-3 text-[13px]">
            <div><span className="text-slate-400">Status</span><p className="font-medium text-slate-700 capitalize">{broadcast.status}</p></div>
            {broadcast.scheduled_at && <div><span className="text-slate-400">Scheduled</span><p className="font-medium text-slate-700">{new Date(broadcast.scheduled_at).toLocaleString()}</p></div>}
            {broadcast.sent_at && <div><span className="text-slate-400">Sent At</span><p className="font-medium text-slate-700">{new Date(broadcast.sent_at).toLocaleString()}</p></div>}
          </div>
        </div>
      </div>
    </div>
  )
}
