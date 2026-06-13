'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  CalendarCheck, Plus, MoreHorizontal, Loader2, Clock, CheckCircle2, AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'

interface FollowUp {
  id: string
  title: string
  note: string | null
  due_at: string
  status: string
  created_at: string
  contact: { id: string; name: string | null; phone: string } | null
  lead: { id: string; title: string } | null
  assignee: { id: string; name: string | null; email: string } | null
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  done: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  skipped: 'bg-muted text-muted-foreground border-border',
}

function isOverdue(duAt: string, status: string) {
  return status === 'pending' && new Date(duAt) < new Date()
}

function FollowUpFormDialog({
  open, onOpenChange, onSave,
}: { open: boolean; onOpenChange: (v: boolean) => void; onSave: () => void }) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ title: '', note: '', due_at: '' })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/follow-ups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error((await res.json() as { error?: string }).error ?? 'Failed')
      toast.success('Follow-up scheduled')
      onOpenChange(false)
      onSave()
      setForm({ title: '', note: '', due_at: '' })
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
            <CalendarCheck className="size-4 text-primary" /> Schedule Follow-up
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1">
            <label className="text-sm font-medium">Title *</label>
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Call John about pricing" required />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Due Date & Time *</label>
            <Input type="datetime-local" value={form.due_at} onChange={(e) => setForm((f) => ({ ...f, due_at: e.target.value }))} required />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Note</label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[72px] resize-none"
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="Additional notes..."
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving} className="gap-2">
              {saving && <Loader2 className="size-4 animate-spin" />} Schedule
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function FollowUpsPage() {
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('pending')
  const [createOpen, setCreateOpen] = useState(false)

  const fetchFollowUps = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      const res = await fetch(`/api/follow-ups?${params}`)
      const data = await res.json() as { followUps: FollowUp[]; total: number }
      setFollowUps(data.followUps ?? [])
      setTotal(data.total ?? 0)
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { void fetchFollowUps() }, [fetchFollowUps])

  const markDone = async (id: string) => {
    await fetch(`/api/follow-ups/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })
    toast.success('Marked as done')
    void fetchFollowUps()
  }

  const deleteFollowUp = async (id: string) => {
    if (!confirm('Delete this follow-up?')) return
    await fetch(`/api/follow-ups/${id}`, { method: 'DELETE' })
    toast.success('Follow-up deleted')
    void fetchFollowUps()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CalendarCheck className="size-6 text-primary" /> Follow-ups
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{total} follow-up{total !== 1 ? 's' : ''}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2 self-start sm:self-auto">
          <Plus className="size-4" /> Schedule
        </Button>
      </div>

      {/* Status tabs */}
      <div className="flex gap-2">
        {['', 'pending', 'done', 'skipped'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              statusFilter === s
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : followUps.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-16 text-center">
          <CalendarCheck className="mx-auto size-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No follow-ups</p>
          <Button className="mt-4 gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Schedule Follow-up
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {followUps.map((fu) => {
            const overdue = isOverdue(fu.due_at, fu.status)
            return (
              <div
                key={fu.id}
                className={`rounded-xl border p-4 flex items-start gap-4 ${overdue ? 'border-red-500/30 bg-red-500/5' : 'border-border bg-card'}`}
              >
                <div className="mt-0.5">
                  {fu.status === 'done' ? (
                    <CheckCircle2 className="size-5 text-emerald-500" />
                  ) : overdue ? (
                    <AlertCircle className="size-5 text-red-500" />
                  ) : (
                    <Clock className="size-5 text-amber-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`font-medium ${fu.status === 'done' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                      {fu.title}
                    </p>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[fu.status] ?? ''}`}>
                      {overdue ? 'Overdue' : fu.status}
                    </span>
                  </div>
                  {fu.note && <p className="text-sm text-muted-foreground mt-0.5">{fu.note}</p>}
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                    <span>Due: {new Date(fu.due_at).toLocaleString()}</span>
                    {fu.contact && <span>· {fu.contact.name ?? fu.contact.phone}</span>}
                    {fu.lead && <span>· {fu.lead.title}</span>}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger className="flex items-center justify-center size-8 shrink-0 rounded-md hover:bg-muted text-muted-foreground">
                    <MoreHorizontal className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-card">
                    {fu.status !== 'done' && (
                      <DropdownMenuItem onClick={() => markDone(fu.id)}>
                        <CheckCircle2 className="size-4 mr-2" /> Mark done
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => deleteFollowUp(fu.id)} className="text-destructive">
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )
          })}
        </div>
      )}

      <FollowUpFormDialog open={createOpen} onOpenChange={setCreateOpen} onSave={fetchFollowUps} />
    </div>
  )
}
