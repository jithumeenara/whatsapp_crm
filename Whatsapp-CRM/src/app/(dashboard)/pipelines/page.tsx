"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  closestCorners, type DragStartEvent, type DragEndEvent, type DragOverEvent,
} from "@dnd-kit/core"
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  Plus, MoreHorizontal, Trash2, Edit2, X, Check, ChevronRight,
  Kanban, DollarSign, User, Calendar, Flame, Thermometer, Snowflake,
  GripVertical, Target, TrendingUp, CheckCircle2, AlertCircle, Loader2,
} from "lucide-react"
import { toast } from "sonner"

// ── types ──────────────────────────────────────────────────────────────────────

interface Stage {
  id: string; name: string; position: number; color: string
}

interface Deal {
  id: string
  title: string
  value: number
  currency: string
  notes?: string | null
  status: string
  expected_close_date?: string | null
  stage_id: string
  pipeline_id: string
  created_at: string
  contact?: { id: string; name?: string | null; phone?: string | null } | null
  lead?:    { id: string; title: string; score?: string | null; status?: string | null } | null
}

interface Pipeline {
  id: string; name: string; created_at: string
  stages: Stage[]
  _count: { deals: number }
}

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

function fmt(v: number, currency = "USD") {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(v)
}

function ScoreDot({ score }: { score?: string | null }) {
  if (score === "hot")  return <Flame className="h-3 w-3 text-rose-500" />
  if (score === "warm") return <Thermometer className="h-3 w-3 text-amber-500" />
  if (score === "cold") return <Snowflake className="h-3 w-3 text-sky-500" />
  return null
}

// ── Confirm Dialog ─────────────────────────────────────────────────────────────

function ConfirmDialog({ message, confirmLabel = "Delete", onConfirm, onClose }: {
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-80 rounded-2xl bg-white shadow-2xl border border-slate-100 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-50">
            <AlertCircle className="h-5 w-5 text-rose-500" />
          </div>
          <p className="text-[13px] text-slate-700 leading-relaxed mt-1">{message}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={() => { onConfirm(); onClose() }}
            className="flex-1 rounded-xl bg-rose-500 py-2 text-[13px] font-semibold text-white hover:bg-rose-600">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Deal Card ──────────────────────────────────────────────────────────────────

function DealCard({
  deal, onEdit, onDelete, dragging,
}: {
  deal: Deal
  onEdit: (d: Deal) => void
  onDelete: (id: string) => void
  dragging?: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [menuOpen])

  return (
    <div
      className={cn(
        "group relative rounded-xl border bg-white p-3 shadow-sm transition-shadow",
        dragging ? "opacity-50 rotate-1 shadow-lg" : "hover:shadow-md border-slate-100",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-semibold text-slate-800 leading-snug line-clamp-2">{deal.title}</p>
        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
            className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-7 z-20 w-36 rounded-xl border border-slate-100 bg-white shadow-xl py-1">
              <button onClick={() => { setMenuOpen(false); onEdit(deal) }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50">
                <Edit2 className="h-3 w-3" /> Edit
              </button>
              <button onClick={() => { setMenuOpen(false); onDelete(deal.id) }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-rose-600 hover:bg-rose-50">
                <Trash2 className="h-3 w-3" /> Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {deal.value > 0 && (
        <div className="mt-1.5 flex items-center gap-1 text-[12px] font-semibold text-emerald-600">
          <DollarSign className="h-3 w-3" />{fmt(deal.value, deal.currency)}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {deal.contact && (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
            <User className="h-2.5 w-2.5" />{deal.contact.name ?? deal.contact.phone}
          </span>
        )}
        {deal.lead && (
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700">
            <ScoreDot score={deal.lead.score} />{deal.lead.title}
          </span>
        )}
        {deal.expected_close_date && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
            <Calendar className="h-2.5 w-2.5" />
            {new Date(deal.expected_close_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Sortable Deal Card ─────────────────────────────────────────────────────────

function SortableDealCard({ deal, onEdit, onDelete }: { deal: Deal; onEdit: (d: Deal) => void; onDelete: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: deal.id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div {...listeners} className="cursor-grab active:cursor-grabbing">
        <DealCard deal={deal} onEdit={onEdit} onDelete={onDelete} dragging={isDragging} />
      </div>
    </div>
  )
}

// ── Stage Column ───────────────────────────────────────────────────────────────

function StageColumn({
  stage, deals, onAddDeal, onEditStage, onDeleteStage, onEditDeal, onDeleteDeal,
}: {
  stage: Stage
  deals: Deal[]
  onAddDeal: (stageId: string) => void
  onEditStage: (stage: Stage) => void
  onDeleteStage: (stage: Stage) => void
  onEditDeal: (d: Deal) => void
  onDeleteDeal: (id: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const total = deals.reduce((s, d) => s + Number(d.value), 0)

  const { setNodeRef } = useSortable({ id: stage.id, data: { type: "stage" } })

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [menuOpen])

  return (
    <div className="flex w-[280px] shrink-0 flex-col rounded-2xl bg-slate-50 border border-slate-200">
      {/* Stage header */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: stage.color }} />
        <span className="flex-1 text-[13px] font-semibold text-slate-800 truncate">{stage.name}</span>
        <span className="rounded-full bg-white border border-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">
          {deals.length}
        </span>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-7 z-20 w-40 rounded-xl border border-slate-100 bg-white shadow-xl py-1">
              <button onClick={() => { setMenuOpen(false); onAddDeal(stage.id) }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50">
                <Plus className="h-3 w-3" /> Add Deal
              </button>
              <button onClick={() => { setMenuOpen(false); onEditStage(stage) }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50">
                <Edit2 className="h-3 w-3" /> Rename Stage
              </button>
              <button onClick={() => { setMenuOpen(false); onDeleteStage(stage) }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-rose-600 hover:bg-rose-50">
                <Trash2 className="h-3 w-3" /> Delete Stage
              </button>
            </div>
          )}
        </div>
      </div>

      {total > 0 && (
        <div className="px-3 pb-2 text-[11px] font-semibold text-slate-500">
          {fmt(total)} total
        </div>
      )}

      {/* Deals list */}
      <div ref={setNodeRef} className="flex flex-col gap-2 px-3 pb-3 min-h-[80px] flex-1">
        <SortableContext items={deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
          {deals.map((deal) => (
            <SortableDealCard key={deal.id} deal={deal} onEdit={onEditDeal} onDelete={onDeleteDeal} />
          ))}
        </SortableContext>
      </div>

      <button
        onClick={() => onAddDeal(stage.id)}
        className="flex items-center gap-1.5 px-3 pb-3 text-[12px] text-slate-400 hover:text-indigo-600 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" /> Add deal
      </button>
    </div>
  )
}

// ── Deal Modal ─────────────────────────────────────────────────────────────────

function DealModal({
  stages,
  initialStageId,
  deal,
  onSave,
  onClose,
}: {
  stages: Stage[]
  initialStageId?: string
  deal?: Deal | null
  onSave: (data: Partial<Deal>) => Promise<void>
  onClose: () => void
}) {
  const [title, setTitle] = useState(deal?.title ?? "")
  const [value, setValue] = useState(deal?.value ? String(deal.value) : "")
  const [notes, setNotes] = useState(deal?.notes ?? "")
  const [stageId, setStageId] = useState(deal?.stage_id ?? initialStageId ?? stages[0]?.id ?? "")
  const [closeDate, setCloseDate] = useState(deal?.expected_close_date?.slice(0, 10) ?? "")
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) { toast.error("Title is required"); return }
    setSaving(true)
    try {
      await onSave({ title: title.trim(), value: parseFloat(value) || 0, notes: notes || null, stage_id: stageId, expected_close_date: closeDate || null })
      onClose()
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-100">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
          <h3 className="text-[15px] font-bold text-slate-900">{deal ? "Edit Deal" : "New Deal"}</h3>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-[12px] font-semibold text-slate-600 mb-1">Deal Title *</label>
            <input
              value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus
              placeholder="e.g. Website Redesign Project"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Stage</label>
              <select
                value={stageId} onChange={(e) => setStageId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Value (₹)</label>
              <input
                type="number" min="0" step="any" value={value} onChange={(e) => setValue(e.target.value)}
                placeholder="0"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-slate-600 mb-1">Expected Close Date</label>
            <input
              type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-slate-600 mb-1">Notes</label>
            <textarea
              rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any relevant notes..."
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-xl border border-slate-200 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 rounded-xl bg-indigo-600 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center gap-2">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {deal ? "Save Changes" : "Add Deal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── New Pipeline Modal ─────────────────────────────────────────────────────────

const PIPELINE_TEMPLATES = [
  { name: "Sales Pipeline",          stages: ["New Lead", "Contacted", "Proposal", "Negotiation", "Won", "Lost"] },
  { name: "Real Estate",             stages: ["Inquiry", "Site Visit", "Negotiation", "Agreement", "Registration", "Closed"] },
  { name: "Education / Admissions",  stages: ["Enquiry", "Application", "Interview", "Offer", "Enrolled", "Dropped"] },
  { name: "Healthcare",              stages: ["Lead", "Consultation", "Diagnosis", "Treatment", "Follow-up", "Discharged"] },
  { name: "Recruitment / HR",        stages: ["Applied", "Screened", "Interview", "Offer", "Accepted", "Rejected"] },
  { name: "Support / Service",       stages: ["Open", "Assigned", "In Progress", "Pending Customer", "Resolved", "Closed"] },
  { name: "E-commerce / Orders",     stages: ["Order Placed", "Confirmed", "Packed", "Shipped", "Delivered", "Returned"] },
  { name: "Insurance / Finance",     stages: ["Prospect", "Quote", "Underwriting", "Approved", "Policy Issued", "Renewal"] },
  { name: "Custom",                  stages: ["New", "In Progress", "Review", "Won", "Lost"] },
]

function NewPipelineModal({ onSave, onClose }: { onSave: (name: string, stages: string[]) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("")
  const [selected, setSelected] = useState(PIPELINE_TEMPLATES[0])
  const [customStages, setCustomStages] = useState<string[]>(PIPELINE_TEMPLATES[0].stages)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const handleTemplate = (t: typeof PIPELINE_TEMPLATES[0]) => {
    setSelected(t)
    setCustomStages([...t.stages])
    if (!name || PIPELINE_TEMPLATES.some((p) => p.name === name)) setName(t.name)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) { toast.error("Pipeline name required"); return }
    setSaving(true)
    try { await onSave(n, customStages.filter(Boolean)) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
          <h3 className="text-[15px] font-bold text-slate-900">New Pipeline</h3>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          <div>
            <label className="block text-[12px] font-semibold text-slate-600 mb-1">Pipeline Name *</label>
            <input
              ref={inputRef} value={name} onChange={(e) => setName(e.target.value)} required
              placeholder="Enter pipeline name"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-slate-600 mb-2">Choose a Template</label>
            <div className="grid grid-cols-3 gap-2">
              {PIPELINE_TEMPLATES.map((t) => (
                <button
                  key={t.name} type="button"
                  onClick={() => handleTemplate(t)}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-left text-[12px] font-semibold transition-colors",
                    selected.name === t.name
                      ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 text-slate-600 hover:border-indigo-300 hover:bg-slate-50",
                  )}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-slate-600 mb-2">Stages</label>
            <div className="space-y-2">
              {customStages.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <GripVertical className="h-4 w-4 text-slate-300 shrink-0" />
                  <input
                    value={s}
                    onChange={(e) => {
                      const updated = [...customStages]
                      updated[i] = e.target.value
                      setCustomStages(updated)
                    }}
                    className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  <button type="button" onClick={() => setCustomStages(customStages.filter((_, j) => j !== i))}
                    className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setCustomStages([...customStages, ""])}
                className="flex items-center gap-1.5 text-[12px] text-indigo-600 hover:text-indigo-800">
                <Plus className="h-3.5 w-3.5" /> Add Stage
              </button>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-xl border border-slate-200 py-2.5 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-[13px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center gap-2">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create Pipeline
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function PipelinesPage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [activePipelineId, setActivePipelineId] = useState<string | null>(null)
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [dealsLoading, setDealsLoading] = useState(false)
  const [showNewPipeline, setShowNewPipeline] = useState(false)
  const [dealModal, setDealModal] = useState<{ stageId?: string; deal?: Deal } | null>(null)
  const [editingStage, setEditingStage] = useState<Stage | null>(null)
  const [editStageName, setEditStageName] = useState("")
  const [addingStage, setAddingStage] = useState(false)
  const [newStageName, setNewStageName] = useState("")
  const [renamingPipelineId, setRenamingPipelineId] = useState<string | null>(null)
  const [renamePipelineName, setRenamePipelineName] = useState("")
  const [activeDragDeal, setActiveDragDeal] = useState<Deal | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null)

  const activePipeline = pipelines.find((p) => p.id === activePipelineId) ?? null

  // ── Load pipelines ──
  const loadPipelines = useCallback(async () => {
    try {
      const res = await fetch("/api/pipelines")
      const data = await res.json()
      const list: Pipeline[] = data.pipelines ?? []
      setPipelines(list)
      if (list.length > 0 && !activePipelineId) setActivePipelineId(list[0].id)
    } catch { toast.error("Failed to load pipelines") }
    finally { setLoading(false) }
  }, [activePipelineId])

  useEffect(() => { loadPipelines() }, [])

  // ── Load deals for active pipeline ──
  const loadDeals = useCallback(async (pipelineId: string) => {
    setDealsLoading(true)
    try {
      const res = await fetch(`/api/deals?pipeline_id=${pipelineId}`)
      const data = await res.json()
      setDeals(data.deals ?? [])
    } catch { toast.error("Failed to load deals") }
    finally { setDealsLoading(false) }
  }, [])

  useEffect(() => {
    if (activePipelineId) loadDeals(activePipelineId)
  }, [activePipelineId, loadDeals])

  // ── Create pipeline ──
  const handleCreatePipeline = async (name: string, stages: string[]) => {
    const res = await fetch("/api/pipelines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, stages }),
    })
    if (!res.ok) { toast.error("Failed to create pipeline"); return }
    const { pipeline } = await res.json()
    setPipelines((prev) => [...prev, pipeline])
    setActivePipelineId(pipeline.id)
    setShowNewPipeline(false)
    toast.success("Pipeline created")
  }

  // ── Delete pipeline ──
  const handleDeletePipeline = (id: string) => {
    setConfirmDialog({
      message: "Delete this pipeline and all its deals? This cannot be undone.",
      onConfirm: async () => {
        const res = await fetch(`/api/pipelines/${id}`, { method: "DELETE" })
        if (!res.ok) { toast.error("Failed to delete"); return }
        setPipelines((prev) => {
          const filtered = prev.filter((p) => p.id !== id)
          if (activePipelineId === id) setActivePipelineId(filtered[0]?.id ?? null)
          return filtered
        })
        toast.success("Pipeline deleted")
      },
    })
  }

  // ── Rename pipeline ──
  const handleRenamePipeline = async (id: string, name: string) => {
    const res = await fetch(`/api/pipelines/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) { toast.error("Failed to rename"); return }
    setPipelines((prev) => prev.map((p) => p.id === id ? { ...p, name } : p))
    setRenamingPipelineId(null)
    toast.success("Pipeline renamed")
  }

  // ── Add stage ──
  const handleAddStage = async () => {
    if (!activePipelineId) return
    const name = newStageName.trim()
    if (!name) { toast.error("Stage name required"); return }
    const res = await fetch(`/api/pipelines/${activePipelineId}/stages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) { toast.error("Failed to add stage"); return }
    const { stage } = await res.json()
    setPipelines((prev) => prev.map((p) =>
      p.id === activePipelineId ? { ...p, stages: [...p.stages, stage] } : p
    ))
    setAddingStage(false)
    setNewStageName("")
  }

  // ── Edit stage ──
  const handleEditStage = async () => {
    if (!editingStage || !activePipelineId) return
    const name = editStageName.trim()
    if (!name) return
    const res = await fetch(`/api/pipelines/${activePipelineId}/stages/${editingStage.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) { toast.error("Failed to rename stage"); return }
    setPipelines((prev) => prev.map((p) =>
      p.id === activePipelineId
        ? { ...p, stages: p.stages.map((s) => s.id === editingStage.id ? { ...s, name } : s) }
        : p
    ))
    setEditingStage(null)
  }

  // ── Delete stage ──
  const handleDeleteStage = (stage: Stage) => {
    if (!activePipelineId) return
    const stageDeals = deals.filter((d) => d.stage_id === stage.id)
    const msg = stageDeals.length > 0
      ? `Delete "${stage.name}"? ${stageDeals.length} deal(s) will move to another stage.`
      : `Delete stage "${stage.name}"?`
    setConfirmDialog({
      message: msg,
      onConfirm: async () => {
        const res = await fetch(`/api/pipelines/${activePipelineId}/stages/${stage.id}`, { method: "DELETE" })
        if (!res.ok) { toast.error("Failed to delete stage"); return }
        setPipelines((prev) => prev.map((p) =>
          p.id === activePipelineId ? { ...p, stages: p.stages.filter((s) => s.id !== stage.id) } : p
        ))
        await loadDeals(activePipelineId)
        toast.success("Stage deleted")
      },
    })
  }

  // ── Create / Edit deal ──
  const handleSaveDeal = async (data: Partial<Deal>) => {
    if (dealModal?.deal) {
      // Edit
      const res = await fetch(`/api/deals/${dealModal.deal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error("Failed to update deal")
      const { deal } = await res.json()
      setDeals((prev) => prev.map((d) => d.id === deal.id ? deal : d))
      toast.success("Deal updated")
    } else {
      // Create
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, pipeline_id: activePipelineId }),
      })
      if (!res.ok) throw new Error("Failed to create deal")
      const { deal } = await res.json()
      setDeals((prev) => [...prev, deal])
      setPipelines((prev) => prev.map((p) =>
        p.id === activePipelineId ? { ...p, _count: { deals: p._count.deals + 1 } } : p
      ))
      toast.success("Deal added")
    }
  }

  // ── Delete deal ──
  const handleDeleteDeal = (id: string) => {
    setConfirmDialog({
      message: "Delete this deal? This cannot be undone.",
      onConfirm: async () => {
        const res = await fetch(`/api/deals/${id}`, { method: "DELETE" })
        if (!res.ok) { toast.error("Failed to delete deal"); return }
        setDeals((prev) => prev.filter((d) => d.id !== id))
        toast.success("Deal deleted")
      },
    })
  }

  // ── DnD ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleDragStart = (event: DragStartEvent) => {
    const deal = deals.find((d) => d.id === event.active.id)
    if (deal) setActiveDragDeal(deal)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over) return

    const activeId = String(active.id)
    const overId   = String(over.id)
    if (activeId === overId) return

    const activeDeal = deals.find((d) => d.id === activeId)
    if (!activeDeal) return

    // Determine target stage
    const overIsStage = activePipeline?.stages.some((s) => s.id === overId)
    const targetStageId = overIsStage
      ? overId
      : deals.find((d) => d.id === overId)?.stage_id

    if (!targetStageId || targetStageId === activeDeal.stage_id) return

    setDeals((prev) => prev.map((d) => d.id === activeId ? { ...d, stage_id: targetStageId } : d))
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDragDeal(null)
    const { active, over } = event
    if (!over) return

    const activeId = String(active.id)
    const overId   = String(over.id)
    if (activeId === overId) return

    const deal = deals.find((d) => d.id === activeId)
    if (!deal) return

    const overIsStage = activePipeline?.stages.some((s) => s.id === overId)
    const targetStageId = overIsStage
      ? overId
      : deals.find((d) => d.id === overId)?.stage_id

    if (!targetStageId || targetStageId === deal.stage_id) return

    // Persist
    await fetch(`/api/deals/${activeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage_id: targetStageId }),
    })
  }

  // ── Stats ──
  const totalValue = deals.filter((d) => d.status === "open").reduce((s, d) => s + Number(d.value), 0)
  const openCount  = deals.filter((d) => d.status === "open").length

  // ── Render ──

  if (loading) return (
    <div className="flex h-full items-center justify-center bg-[#F4F6FA]">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
    </div>
  )

  return (
    <div className="flex h-full bg-[#F4F6FA]">
      {/* ── Left Sidebar: Pipeline list ── */}
      <div className="flex w-[220px] shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <span className="text-[12px] font-bold uppercase tracking-widest text-slate-400">Pipelines</span>
          <button onClick={() => setShowNewPipeline(true)}
            className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {pipelines.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 px-4 text-center">
              <Kanban className="h-8 w-8 text-slate-200" />
              <p className="text-[12px] text-slate-400">No pipelines yet</p>
              <button onClick={() => setShowNewPipeline(true)}
                className="text-[12px] font-semibold text-indigo-600 hover:underline">
                Create one
              </button>
            </div>
          ) : (
            pipelines.map((p) => (
              <div key={p.id} className="group relative">
                {renamingPipelineId === p.id ? (
                  <div className="flex items-center gap-1 px-3 py-1.5">
                    <input
                      value={renamePipelineName}
                      onChange={(e) => setRenamePipelineName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenamePipeline(p.id, renamePipelineName)
                        if (e.key === "Escape") setRenamingPipelineId(null)
                      }}
                      autoFocus
                      className="flex-1 rounded-lg border border-indigo-300 bg-white px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                    <button onClick={() => handleRenamePipeline(p.id, renamePipelineName)}
                      className="flex h-5 w-5 items-center justify-center rounded text-emerald-600 hover:bg-emerald-50">
                      <Check className="h-3 w-3" />
                    </button>
                    <button onClick={() => setRenamingPipelineId(null)}
                      className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setActivePipelineId(p.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setActivePipelineId(p.id) }}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors",
                      activePipelineId === p.id
                        ? "bg-indigo-50 text-indigo-700"
                        : "text-slate-700 hover:bg-slate-50",
                    )}
                  >
                    <Target className="h-3.5 w-3.5 shrink-0" />
                    <span className="flex-1 truncate text-[13px] font-semibold">{p.name}</span>
                    <span className={cn(
                      "rounded-full px-1.5 text-[10px] font-bold",
                      activePipelineId === p.id ? "bg-indigo-100 text-indigo-600" : "bg-slate-100 text-slate-500"
                    )}>
                      {p._count.deals}
                    </span>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={(e) => { e.stopPropagation(); setRenamePipelineName(p.name); setRenamingPipelineId(p.id) }}
                        className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-200">
                        <Edit2 className="h-2.5 w-2.5" />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleDeletePipeline(p.id) }}
                        className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-500">
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <button onClick={() => setShowNewPipeline(true)}
          className="flex items-center gap-2 border-t border-slate-100 px-4 py-3 text-[12px] font-semibold text-indigo-600 hover:bg-indigo-50 transition-colors">
          <Plus className="h-3.5 w-3.5" /> New Pipeline
        </button>
      </div>

      {/* ── Main content ── */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {!activePipeline ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <Kanban className="h-16 w-16 text-slate-200" />
            <p className="text-[15px] font-semibold text-slate-400">Select or create a pipeline</p>
            <button onClick={() => setShowNewPipeline(true)}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-indigo-700">
              <Plus className="h-4 w-4" /> Create Pipeline
            </button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3 shrink-0">
              <div className="flex items-center gap-3">
                <Kanban className="h-5 w-5 text-indigo-600" />
                <div>
                  <h1 className="text-[15px] font-bold text-slate-900">{activePipeline.name}</h1>
                  <div className="flex items-center gap-3 text-[12px] text-slate-500">
                    <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" />{openCount} open deals</span>
                    {totalValue > 0 && <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3 text-indigo-500" />{fmt(totalValue)} pipeline value</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDealModal({ stageId: activePipeline.stages[0]?.id })}
                  className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700">
                  <Plus className="h-4 w-4" /> Add Deal
                </button>
                <button
                  onClick={() => setAddingStage(true)}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">
                  <Plus className="h-4 w-4" /> Stage
                </button>
              </div>
            </div>

            {/* Kanban board */}
            <div className="flex-1 overflow-x-auto overflow-y-auto p-4">
              {dealsLoading ? (
                <div className="flex items-center justify-center h-48">
                  <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCorners}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragEnd={handleDragEnd}
                >
                  <div className="flex gap-4 items-start min-w-max pb-4">
                    {activePipeline.stages.map((stage) => {
                      const stageDeals = deals.filter((d) => d.stage_id === stage.id)
                      return (
                        <StageColumn
                          key={stage.id}
                          stage={stage}
                          deals={stageDeals}
                          onAddDeal={(stageId) => setDealModal({ stageId })}
                          onEditStage={(s) => { setEditingStage(s); setEditStageName(s.name) }}
                          onDeleteStage={handleDeleteStage}
                          onEditDeal={(d) => setDealModal({ deal: d })}
                          onDeleteDeal={handleDeleteDeal}
                        />
                      )
                    })}

                    {/* Add Stage column */}
                    <button
                      onClick={() => setAddingStage(true)}
                      className="flex w-[280px] shrink-0 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 py-10 text-slate-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors"
                    >
                      <Plus className="h-5 w-5" />
                      <span className="text-[12px] font-semibold">Add Stage</span>
                    </button>
                  </div>

                  <DragOverlay>
                    {activeDragDeal && (
                      <div className="rotate-2 opacity-90">
                        <DealCard deal={activeDragDeal} onEdit={() => {}} onDelete={() => {}} />
                      </div>
                    )}
                  </DragOverlay>
                </DndContext>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Modals ── */}
      {showNewPipeline && (
        <NewPipelineModal onSave={handleCreatePipeline} onClose={() => setShowNewPipeline(false)} />
      )}

      {dealModal && activePipeline && (
        <DealModal
          stages={activePipeline.stages}
          initialStageId={dealModal.stageId}
          deal={dealModal.deal}
          onSave={handleSaveDeal}
          onClose={() => setDealModal(null)}
        />
      )}

      {/* Add stage modal */}
      {addingStage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => { setAddingStage(false); setNewStageName("") }} />
          <div className="relative z-10 w-80 rounded-2xl bg-white shadow-2xl border border-slate-100 p-5 space-y-3">
            <h3 className="text-[14px] font-bold text-slate-900">Add Stage</h3>
            <input
              value={newStageName} onChange={(e) => setNewStageName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddStage()
                if (e.key === "Escape") { setAddingStage(false); setNewStageName("") }
              }}
              autoFocus
              placeholder="Stage name..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <div className="flex gap-2">
              <button onClick={() => { setAddingStage(false); setNewStageName("") }}
                className="flex-1 rounded-xl border border-slate-200 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={handleAddStage}
                className="flex-1 rounded-xl bg-indigo-600 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700">
                Add Stage
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      {confirmDialog && (
        <ConfirmDialog
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onClose={() => setConfirmDialog(null)}
        />
      )}

      {/* Edit stage name inline modal */}
      {editingStage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setEditingStage(null)} />
          <div className="relative z-10 w-80 rounded-2xl bg-white shadow-2xl border border-slate-100 p-5 space-y-3">
            <h3 className="text-[14px] font-bold text-slate-900">Rename Stage</h3>
            <input
              value={editStageName} onChange={(e) => setEditStageName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleEditStage(); if (e.key === "Escape") setEditingStage(null) }}
              autoFocus
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <div className="flex gap-2">
              <button onClick={() => setEditingStage(null)}
                className="flex-1 rounded-xl border border-slate-200 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={handleEditStage}
                className="flex-1 rounded-xl bg-indigo-600 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
