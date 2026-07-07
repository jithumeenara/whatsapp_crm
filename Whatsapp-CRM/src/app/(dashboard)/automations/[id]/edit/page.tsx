"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Save, Play, Pause, AlertCircle, Loader2 } from "lucide-react"
import { toast } from "sonner"

interface Automation {
  id: string; name: string; description?: string; status: string; trigger_type?: string
  trigger_config?: unknown; actions?: unknown[]; created_at: string
}

export default function AutomationEditPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [automation, setAutomation] = useState<Automation | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")

  useEffect(() => {
    fetch(`/api/automations/${id}`)
      .then((r) => r.json())
      .then((d) => {
        const a = d.automation ?? d
        setAutomation(a)
        setName(a.name ?? "")
        setDescription(a.description ?? "")
      })
      .catch(() => toast.error("Failed to load automation"))
      .finally(() => setLoading(false))
  }, [id])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/automations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      })
      if (!res.ok) throw new Error("Save failed")
      toast.success("Automation saved")
      router.push("/automations")
    } catch { toast.error("Save failed") }
    finally { setSaving(false) }
  }

  async function toggleStatus() {
    if (!automation) return
    const newStatus = automation.status === "active" ? "inactive" : "active"
    await fetch(`/api/automations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    })
    setAutomation((p) => p ? { ...p, status: newStatus } : p)
    toast.success(newStatus === "active" ? "Automation activated" : "Automation paused")
  }

  if (loading) return (
    <div className="flex flex-col h-full bg-[#F4F6FA]">
      <div className="px-6 py-4 bg-white border-b border-slate-100">
        <div className="h-5 w-48 bg-slate-100 rounded animate-pulse" />
      </div>
      <div className="p-6 space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-white rounded-xl animate-pulse" />)}</div>
    </div>
  )

  return (
    <div className="flex flex-col h-full bg-[#F4F6FA]">
      <div className="flex items-center gap-3 px-6 py-4 bg-white border-b border-slate-100">
        <button onClick={() => router.push("/automations")} className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-slate-100">
          <ArrowLeft className="h-4 w-4 text-slate-500" />
        </button>
        <h1 className="flex-1 text-[16px] font-bold text-slate-800">Edit Automation</h1>
        {automation && (
          <button onClick={toggleStatus}
            className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium border ${automation.status === "active" ? "border-amber-200 text-amber-700 hover:bg-amber-50" : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"}`}>
            {automation.status === "active" ? <><Pause className="h-3 w-3" /> Pause</> : <><Play className="h-3 w-3" /> Activate</>}
          </button>
        )}
        <button onClick={save} disabled={saving}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-indigo-600 text-white text-[12px] font-semibold hover:bg-indigo-700 disabled:opacity-50">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-xl space-y-4">
          <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm space-y-4">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                className="w-full h-9 px-3 text-[13px] bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-indigo-400" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                className="w-full px-3 py-2 text-[13px] bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-indigo-400 resize-none" />
            </div>
          </div>
          {automation && (
            <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Details</p>
              <div className="grid grid-cols-2 gap-3 text-[13px]">
                <div><span className="text-slate-400">Status</span><p className="font-medium capitalize">{automation.status}</p></div>
                <div><span className="text-slate-400">Trigger</span><p className="font-medium capitalize">{automation.trigger_type ?? "—"}</p></div>
                <div><span className="text-slate-400">Created</span><p className="font-medium">{new Date(automation.created_at).toLocaleDateString()}</p></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
