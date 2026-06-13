'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  TrendingUp, Plus, Search, Filter, MoreHorizontal, Loader2,
  User2, Phone, CheckCircle2, AlertCircle, Flame, Snowflake, Thermometer,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'

interface Lead {
  id: string
  title: string
  status: string
  score: string
  source: string
  notes: string | null
  created_at: string
  contact: { id: string; name: string | null; phone: string } | null
  assignee: { id: string; name: string | null; email: string } | null
  _count: { activities: number; follow_ups: number; tasks: number }
}

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  contacted: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  qualified: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  converted: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  lost: 'bg-red-500/10 text-red-500 border-red-500/20',
}

const SCORE_ICONS: Record<string, React.ReactNode> = {
  hot: <Flame className="size-3.5 text-red-500" />,
  warm: <Thermometer className="size-3.5 text-amber-500" />,
  cold: <Snowflake className="size-3.5 text-blue-400" />,
}

const STATUSES = ['new', 'contacted', 'qualified', 'converted', 'lost']
const SCORES = ['hot', 'warm', 'cold']
const SOURCES = ['manual', 'whatsapp_flow', 'import', 'broadcast', 'referral', 'chatbot']

function LeadFormDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSave: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    title: '', source: 'manual', status: 'new', score: 'warm', notes: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error((await res.json() as { error?: string }).error ?? 'Failed')
      toast.success('Lead created')
      onOpenChange(false)
      onSave()
      setForm({ title: '', source: 'manual', status: 'new', score: 'warm', notes: '' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create lead')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="size-4 text-primary" /> New Lead
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1">
            <label className="text-sm font-medium">Title *</label>
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. John - Wedding Venue Enquiry"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Source</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.source}
                onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
              >
                {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Score</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.score}
                onChange={(e) => setForm((f) => ({ ...f, score: e.target.value }))}
              >
                {SCORES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Status</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            >
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Notes</label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[72px] resize-none"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Add any notes about this lead..."
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving} className="gap-2">
              {saving && <Loader2 className="size-4 animate-spin" />}
              Create Lead
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [scoreFilter, setScoreFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  const fetchLeads = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (statusFilter) params.set('status', statusFilter)
      if (scoreFilter) params.set('score', scoreFilter)
      const res = await fetch(`/api/leads?${params}`)
      const data = await res.json() as { leads: Lead[]; total: number }
      setLeads(data.leads ?? [])
      setTotal(data.total ?? 0)
    } finally {
      setLoading(false)
    }
  }, [search, statusFilter, scoreFilter])

  useEffect(() => { void fetchLeads() }, [fetchLeads])

  const updateStatus = async (id: string, status: string) => {
    await fetch(`/api/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    void fetchLeads()
  }

  const deleteLead = async (id: string) => {
    if (!confirm('Delete this lead?')) return
    await fetch(`/api/leads/${id}`, { method: 'DELETE' })
    toast.success('Lead deleted')
    void fetchLeads()
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <TrendingUp className="size-6 text-primary" /> Leads
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{total} lead{total !== 1 ? 's' : ''} total</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2 self-start sm:self-auto">
          <Plus className="size-4" /> New Lead
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search leads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          <select
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All Status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={scoreFilter}
            onChange={(e) => setScoreFilter(e.target.value)}
          >
            <option value="">All Score</option>
            {SCORES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {(statusFilter || scoreFilter || search) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setSearch(''); setStatusFilter(''); setScoreFilter('') }}
            >
              <Filter className="size-4 mr-1" /> Clear
            </Button>
          )}
        </div>
      </div>

      {/* Table / Cards */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : leads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-16 text-center">
          <TrendingUp className="mx-auto size-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No leads yet</p>
          <p className="text-xs text-muted-foreground mt-1">Create your first lead to start tracking potential customers</p>
          <Button className="mt-4 gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> New Lead
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Lead</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Contact</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Score</th>
                <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Source</th>
                <th className="text-left px-4 py-3 font-medium hidden xl:table-cell">Activity</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{lead.title}</p>
                    {lead.notes && (
                      <p className="text-xs text-muted-foreground truncate max-w-xs">{lead.notes}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {lead.contact ? (
                      <div className="flex items-center gap-1.5">
                        <User2 className="size-3.5 text-muted-foreground" />
                        <span>{lead.contact.name ?? lead.contact.phone}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[lead.status] ?? ''}`}>
                      {lead.status === 'converted' && <CheckCircle2 className="size-3" />}
                      {lead.status === 'lost' && <AlertCircle className="size-3" />}
                      {lead.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className="inline-flex items-center gap-1 text-xs font-medium capitalize">
                      {SCORE_ICONS[lead.score]}
                      {lead.score}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground capitalize">{lead.source}</td>
                  <td className="px-4 py-3 hidden xl:table-cell text-xs text-muted-foreground">
                    {lead._count.activities} notes · {lead._count.follow_ups} follow-ups · {lead._count.tasks} tasks
                  </td>
                  <td className="px-4 py-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger className="flex items-center justify-center size-8 rounded-md hover:bg-muted text-muted-foreground">
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-card">
                        <p className="px-2 py-1.5 text-xs text-muted-foreground font-medium">Change status</p>
                        {STATUSES.filter((s) => s !== lead.status).map((s) => (
                          <DropdownMenuItem key={s} onClick={() => updateStatus(lead.id, s)} className="capitalize">
                            {s}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => deleteLead(lead.id)} className="text-destructive">
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <LeadFormDialog open={createOpen} onOpenChange={setCreateOpen} onSave={fetchLeads} />
    </div>
  )
}
