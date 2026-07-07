"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Loader2, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import { FlowEditorShell } from "@/components/flows/flow-editor-shell"
import type { FlowRow, FlowNodeRow } from "@/lib/flows/types"

export default function FlowDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [flow, setFlow] = useState<FlowRow | null>(null)
  const [nodes, setNodes] = useState<FlowNodeRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/flows/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setFlow(d.flow ?? d)
        setNodes(d.nodes ?? [])
      })
      .catch(() => toast.error("Failed to load flow"))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return (
    <div className="flex items-center justify-center h-full bg-[#F4F6FA]">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
    </div>
  )

  if (!flow) return (
    <div className="flex flex-col items-center justify-center h-full bg-[#F4F6FA]">
      <AlertCircle className="h-8 w-8 text-slate-300 mb-2" />
      <p className="text-[14px] text-slate-400">Flow not found</p>
      <button onClick={() => router.push("/flows")} className="mt-3 text-[13px] text-indigo-600 hover:underline">Back</button>
    </div>
  )

  return <FlowEditorShell initialFlow={flow} initialNodes={nodes} />
}
