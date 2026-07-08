"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { Loader2, AlertCircle, ArrowLeft, KeyRound } from "lucide-react"
import { toast } from "sonner"
import { MetaFlowBuilder } from "@/components/flows/meta-flow-builder"
import { KeysDialog } from "@/components/flows/keys-dialog"
import { blankFlow, type MetaFlowDefinition } from "@/lib/flows/meta-flow-types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface Flow {
  id: string
  name: string
  status: string
  trigger_config: Record<string, unknown> | null
  flow_type?: string | null
}

export default function FlowDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [flow, setFlow] = useState<Flow | null>(null)
  const [definition, setDefinition] = useState<MetaFlowDefinition>(blankFlow())
  const [name, setName] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [keysOpen, setKeysOpen] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    fetch(`/api/flows/${id}`)
      .then((r) => r.json())
      .then((d) => {
        const f: Flow = d.flow ?? d
        setFlow(f)
        setName(f.name ?? "")
        const cfg = f.trigger_config
        if (cfg && Array.isArray(cfg.screens) && (cfg.screens as unknown[]).length > 0) {
          setDefinition(cfg as unknown as MetaFlowDefinition)
        } else {
          setDefinition(blankFlow())
        }
      })
      .catch(() => toast.error("Failed to load flow"))
      .finally(() => setLoading(false))
  }, [id])

  const handleChange = useCallback((def: MetaFlowDefinition) => {
    setDefinition(def)
    setDirty(true)
  }, [])

  const handleSave = useCallback(async () => {
    if (!flow) return
    setSaving(true)
    try {
      const res = await fetch(`/api/flows/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, trigger_config: definition }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? "Save failed"); return }
      setFlow(data.flow ?? data)
      setDirty(false)
      toast.success("Saved")
    } catch {
      toast.error("Save failed")
    } finally {
      setSaving(false)
    }
  }, [flow, id, name, definition])

  const handleUpload = useCallback(async () => {
    setUploading(true)
    try {
      // Save first so Meta gets the latest screens
      await fetch(`/api/flows/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, trigger_config: definition }),
      })
      const res = await fetch(`/api/flows/${id}/upload`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? "Upload failed"); return }
      toast.success(data.updated ? "Flow updated on Meta" : "Flow uploaded to Meta")
      // Re-fetch so meta_flow_id is reflected in state
      const refreshed = await fetch(`/api/flows/${id}`).then((r) => r.json())
      const f: Flow = refreshed.flow ?? refreshed
      setFlow(f)
      const cfg = f.trigger_config
      if (cfg && Array.isArray(cfg.screens)) setDefinition(cfg as unknown as MetaFlowDefinition)
      setDirty(false)
    } catch {
      toast.error("Upload failed")
    } finally {
      setUploading(false)
    }
  }, [id, name, definition])

  const handlePublish = useCallback(async () => {
    setPublishing(true)
    try {
      const res = await fetch(`/api/flows/${id}/publish`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? "Publish failed"); return }
      toast.success("Published to Meta")
      setFlow((f) => f ? { ...f, status: "active" } : f)
    } catch {
      toast.error("Publish failed")
    } finally {
      setPublishing(false)
    }
  }, [id])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
      </div>
    )
  }

  if (!flow) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <AlertCircle className="mb-2 h-8 w-8 text-slate-300" />
        <p className="text-[14px] text-slate-400">Flow not found</p>
        <button
          onClick={() => router.push("/flows")}
          className="mt-3 text-[13px] text-indigo-600 hover:underline"
        >
          Back to Flows
        </button>
      </div>
    )
  }

  const metaFlowId =
    (definition as unknown as Record<string, unknown>).meta_flow_id as string | undefined

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Top header bar */}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-100 bg-white px-3 shadow-sm">
        <button
          type="button"
          onClick={() => router.push("/flows")}
          title="Back to Flows"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <div className="h-5 w-px shrink-0 bg-slate-200" />

        <Input
          value={name}
          onChange={(e) => { setName(e.target.value); setDirty(true) }}
          placeholder="Flow name"
          className="h-8 max-w-xs border-transparent bg-transparent px-2 text-[14px] font-semibold text-slate-900 shadow-none focus-visible:border-slate-200 focus-visible:bg-slate-50 focus-visible:ring-0"
        />

        <StatusBadge status={flow.status} metaFlowId={metaFlowId} />

        {dirty && (
          <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" title="Unsaved changes" />
        )}

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => setKeysOpen(true)}
          title="Encryption keys"
          className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <KeyRound className="h-3.5 w-3.5" />
          Keys
        </button>

        <div className="h-5 w-px shrink-0 bg-slate-200" />

        <Button
          onClick={handleSave}
          disabled={saving}
          size="sm"
          className="h-8 gap-1.5 bg-indigo-600 text-[12px] hover:bg-indigo-700"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save
        </Button>
      </div>

      {/* WhatsApp Flows builder */}
      <div className="flex-1 overflow-hidden">
        <MetaFlowBuilder
          value={definition}
          onChange={handleChange}
          flowId={flow.id}
          onSave={handleSave}
          onUpload={handleUpload}
          onPublish={handlePublish}
          saving={saving}
          uploading={uploading}
          publishing={publishing}
          metaFlowId={metaFlowId ?? null}
          flowStatus={flow.status}
        />
      </div>

      <KeysDialog open={keysOpen} onOpenChange={setKeysOpen} />
    </div>
  )
}

function StatusBadge({
  status,
  metaFlowId,
}: {
  status: string
  metaFlowId?: string
}) {
  if (status === "active") {
    return (
      <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
        Live on Meta
      </span>
    )
  }
  if (metaFlowId) {
    return (
      <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
        On Meta · Draft
      </span>
    )
  }
  return (
    <span className={cn(
      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
      "bg-slate-100 text-slate-500",
    )}>
      Draft
    </span>
  )
}
