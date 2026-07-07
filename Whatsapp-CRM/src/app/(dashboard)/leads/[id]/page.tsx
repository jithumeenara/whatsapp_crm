"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Phone, Mail, MapPin, Tag, Clock, Edit2, Trash2, Plus, CheckCircle2, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import type { Lead } from "@/types"

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

const SCORE_COLOR: Record<string, string> = {
  hot: "bg-rose-100 text-rose-700",
  warm: "bg-amber-100 text-amber-700",
  cold: "bg-sky-100 text-sky-700",
}

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [lead, setLead] = useState<Lead | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/leads/${id}`)
      .then((r) => r.json())
      .then((d) => setLead(d.lead ?? d))
      .catch(() => toast.error("Failed to load lead"))
      .finally(() => setLoading(false))
  }, [id])

  async function deleteLead() {
    if (!confirm("Delete this lead?")) return
    await fetch(`/api/leads/${id}`, { method: "DELETE" })
    toast.success("Lead deleted")
    router.push("/leads")
  }

  if (loading) return (
    <div className="flex flex-col h-full bg-[#F4F6FA]">
      <div className="flex items-center gap-3 px-6 py-4 bg-white border-b border-slate-100">
        <div className="h-8 w-8 bg-slate-100 rounded-lg animate-pulse" />
        <div className="h-5 w-48 bg-slate-100 rounded animate-pulse" />
      </div>
      <div className="p-6 space-y-3">
        {[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-white rounded-xl animate-pulse" />)}
      </div>
    </div>
  )

  if (!lead) return (
    <div className="flex flex-col h-full bg-[#F4F6FA] items-center justify-center">
      <AlertCircle className="h-8 w-8 text-slate-300 mb-2" />
      <p className="text-[14px] text-slate-400">Lead not found</p>
      <button onClick={() => router.push("/leads")} className="mt-3 text-[13px] text-indigo-600 hover:underline">Back to Leads</button>
    </div>
  )

  return (
    <div className="flex flex-col h-full bg-[#F4F6FA]">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 bg-white border-b border-slate-100">
        <button onClick={() => router.push("/leads")} className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-slate-100">
          <ArrowLeft className="h-4 w-4 text-slate-500" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-[16px] font-bold text-slate-800">{lead.title}</h1>
            {lead.score && (
              <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize", SCORE_COLOR[lead.score] ?? "bg-slate-100 text-slate-600")}>
                {lead.score}
              </span>
            )}
          </div>
          <p className="text-[12px] text-slate-400">Lead · {lead.status ?? "New"}</p>
        </div>
        <button onClick={deleteLead} className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-rose-200 text-rose-500 text-[12px] font-medium hover:bg-rose-50">
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 max-w-4xl">
          {/* Main info */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-3">Lead Details</p>
              <div className="space-y-3 text-[13px]">
                {lead.description && <p className="text-slate-600">{lead.description}</p>}
                <div className="grid grid-cols-2 gap-3">
                  <div><span className="text-slate-400">Status</span><p className="font-medium text-slate-700 capitalize">{lead.status ?? "—"}</p></div>
                  <div><span className="text-slate-400">Score</span><p className="font-medium text-slate-700 capitalize">{lead.score ?? "—"}</p></div>
                  <div><span className="text-slate-400">District</span><p className="font-medium text-slate-700">{lead.district ?? "—"}</p></div>
                  <div><span className="text-slate-400">Language</span><p className="font-medium text-slate-700">{lead.language ?? "—"}</p></div>
                </div>
              </div>
            </div>

            {/* Contact info */}
            {lead.contact && (
              <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-3">Contact</p>
                <div className="space-y-2 text-[13px]">
                  <div className="flex items-center gap-2 text-slate-700">
                    <Phone className="h-3.5 w-3.5 text-slate-400" />
                    {lead.contact.phone ?? "—"}
                  </div>
                  {lead.contact.email && (
                    <div className="flex items-center gap-2 text-slate-700">
                      <Mail className="h-3.5 w-3.5 text-slate-400" />
                      {lead.contact.email}
                    </div>
                  )}
                  {lead.contact.name && (
                    <div className="flex items-center gap-2 text-slate-700">
                      <CheckCircle2 className="h-3.5 w-3.5 text-slate-400" />
                      {lead.contact.name}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Timeline</p>
              <div className="text-[12px] text-slate-500 space-y-1">
                <div className="flex items-center gap-1.5"><Clock className="h-3 w-3" /> Created {new Date(lead.created_at).toLocaleDateString()}</div>
              </div>
            </div>
            <button onClick={() => router.push("/follow-ups")}
              className="w-full flex items-center gap-2 justify-center h-9 rounded-xl bg-indigo-600 text-white text-[13px] font-semibold hover:bg-indigo-700">
              <Plus className="h-3.5 w-3.5" /> Add Follow-up
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
