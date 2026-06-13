'use client'

import { useEffect, useState, useCallback } from 'react'
import { Tag, Plus, MoreHorizontal, Loader2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'

interface Segment {
  id: string
  name: string
  description: string | null
  color: string
  filter_config: unknown
  created_at: string
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']

function SegmentFormDialog({
  open, onOpenChange, onSave,
}: { open: boolean; onOpenChange: (v: boolean) => void; onSave: () => void }) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', color: '#3b82f6' })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, filter_config: {} }),
      })
      if (!res.ok) throw new Error((await res.json() as { error?: string }).error ?? 'Failed')
      toast.success('Segment created')
      onOpenChange(false)
      onSave()
      setForm({ name: '', description: '', color: '#3b82f6' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="size-4 text-primary" /> New Segment
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1">
            <label className="text-sm font-medium">Name *</label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Hospital Leads, Wedding Enquiries" required />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Description</label>
            <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="What does this segment represent?" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Color</label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, color: c }))}
                  className={`size-7 rounded-full border-2 transition-all ${form.color === c ? 'border-foreground scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving} className="gap-2">
              {saving && <Loader2 className="size-4 animate-spin" />} Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function SegmentsPage() {
  const [segments, setSegments] = useState<Segment[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [previewSegment, setPreviewSegment] = useState<{ id: string; name: string } | null>(null)
  const [previewContacts, setPreviewContacts] = useState<{ id: string; name: string | null; phone: string }[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)

  const fetchSegments = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/segments')
      const data = await res.json() as { segments: Segment[] }
      setSegments(data.segments ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchSegments() }, [fetchSegments])

  const openPreview = async (seg: Segment) => {
    setPreviewSegment({ id: seg.id, name: seg.name })
    setPreviewLoading(true)
    try {
      const res = await fetch(`/api/segments/${seg.id}?contacts=1`)
      const data = await res.json() as { contacts: { id: string; name: string | null; phone: string }[] }
      setPreviewContacts(data.contacts ?? [])
    } finally {
      setPreviewLoading(false)
    }
  }

  const deleteSegment = async (id: string) => {
    if (!confirm('Delete this segment?')) return
    await fetch(`/api/segments/${id}`, { method: 'DELETE' })
    toast.success('Segment deleted')
    void fetchSegments()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Tag className="size-6 text-primary" /> Segments
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Group contacts by industry, behavior, or any criteria</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2 self-start sm:self-auto">
          <Plus className="size-4" /> New Segment
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : segments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-16 text-center">
          <Tag className="mx-auto size-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No segments yet</p>
          <p className="text-xs text-muted-foreground mt-1">Create segments to group contacts — e.g. Hospital Leads, Wedding Clients, Training Enquiries</p>
          <Button className="mt-4 gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> New Segment
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {segments.map((seg) => (
            <div key={seg.id} className="rounded-xl border border-border bg-card p-4 hover:shadow-sm transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-full flex items-center justify-center" style={{ backgroundColor: seg.color + '20', border: `1.5px solid ${seg.color}40` }}>
                    <Tag className="size-4" style={{ color: seg.color }} />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{seg.name}</p>
                    {seg.description && <p className="text-xs text-muted-foreground">{seg.description}</p>}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger className="flex items-center justify-center size-8 -mr-1 -mt-1 rounded-md hover:bg-muted text-muted-foreground">
                    <MoreHorizontal className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-card">
                    <DropdownMenuItem onClick={() => openPreview(seg)}>
                      <Users className="size-4 mr-2" /> View contacts
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => deleteSegment(seg.id)} className="text-destructive">Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <button
                className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => openPreview(seg)}
              >
                <Users className="size-3.5" /> View contacts
              </button>
            </div>
          ))}
        </div>
      )}

      <SegmentFormDialog open={createOpen} onOpenChange={setCreateOpen} onSave={fetchSegments} />

      {/* Contacts Preview Dialog */}
      <Dialog open={!!previewSegment} onOpenChange={(v) => { if (!v) setPreviewSegment(null) }}>
        <DialogContent className="sm:max-w-lg bg-card">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="size-4 text-primary" /> {previewSegment?.name} — Contacts
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto">
            {previewLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : previewContacts.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No contacts match this segment yet. Add filter rules to narrow down contacts.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {previewContacts.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-2.5">
                    <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                      {(c.name ?? c.phone).charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{c.name ?? '—'}</p>
                      <p className="text-xs text-muted-foreground">{c.phone}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
