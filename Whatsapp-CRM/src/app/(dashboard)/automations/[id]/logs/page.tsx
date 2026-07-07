"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle2, XCircle, Clock, RefreshCw } from "lucide-react"
import { toast } from "sonner"

interface AutomationLog {
  id: string; status: string; trigger_event?: string; error_message?: string
  started_at: string; finished_at?: string; contact_id?: string
}

export default function AutomationLogsPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [automationName, setAutomationName] = useState("")
  const [logs, setLogs] = useState<AutomationLog[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const [aRes, lRes] = await Promise.all([
        fetch(`/api/automations/${id}`),
        fetch(`/api/automations/${id}/logs`),
      ])
      const aData = await aRes.json()
      const lData = await lRes.json()
      setAutomationName((aData.automation ?? aData).name ?? "Automation")
      setLogs(lData.logs ?? [])
    } catch { toast.error("Failed to load logs") }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [id])

  return (
    <div className="flex flex-col h-full bg-[#F4F6FA]">
      <div className="flex items-center gap-3 px-6 py-4 bg-white border-b border-slate-100">
        <button onClick={() => router.push("/automations")} className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-slate-100">
          <ArrowLeft className="h-4 w-4 text-slate-500" />
        </button>
        <div className="flex-1">
          <h1 className="text-[16px] font-bold text-slate-800">{automationName} — Logs</h1>
          <p className="text-[12px] text-slate-400">{logs.length} executions</p>
        </div>
        <button onClick={load} className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-slate-100">
          <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="space-y-2">{[...Array(8)].map((_, i) => <div key={i} className="h-14 bg-white rounded-xl animate-pulse" />)}</div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400">
            <Clock className="h-8 w-8 mb-2" />
            <p className="text-[14px]">No logs yet — automation hasn't run</p>
          </div>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <div key={log.id} className="bg-white rounded-xl border border-slate-100 px-4 py-3 flex items-center gap-4 shadow-sm">
                {log.status === "success"
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  : log.status === "error"
                  ? <XCircle className="h-4 w-4 text-rose-500 shrink-0" />
                  : <Clock className="h-4 w-4 text-indigo-500 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-slate-700 capitalize">{log.status}</p>
                  {log.error_message && <p className="text-[11px] text-rose-500 truncate">{log.error_message}</p>}
                  {log.trigger_event && <p className="text-[11px] text-slate-400">{log.trigger_event}</p>}
                </div>
                <p className="text-[12px] text-slate-400 shrink-0">{new Date(log.started_at).toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
