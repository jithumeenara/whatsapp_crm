'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  CheckSquare, Plus, MoreHorizontal, Loader2, AlertTriangle,
  ArrowUp, Minus, ArrowDown, CheckCircle2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'

interface Task {
  id: string
  title: string
  description: string | null
  priority: string
  status: string
  due_date: string | null
  created_at: string
  contact: { id: string; name: string | null; phone: string } | null
  lead: { id: string; title: string } | null
  assignee: { id: string; name: string | null; email: string } | null
}

const PRIORITY_ICONS: Record<string, React.ReactNode> = {
  urgent: <AlertTriangle className="size-3.5 text-red-500" />,
  high: <ArrowUp className="size-3.5 text-orange-500" />,
  medium: <Minus className="size-3.5 text-amber-500" />,
  low: <ArrowDown className="size-3.5 text-blue-400" />,
}

const STATUS_COLORS: Record<string, string> = {
  todo: 'bg-muted text-muted-foreground border-border',
  in_progress: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  done: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  cancelled: 'bg-muted text-muted-foreground/60 border-border',
}

const PRIORITIES = ['urgent', 'high', 'medium', 'low']
const STATUSES = ['todo', 'in_progress', 'done', 'cancelled']

function TaskFormDialog({
  open, onOpenChange, onSave,
}: { open: boolean; onOpenChange: (v: boolean) => void; onSave: () => void }) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ title: '', description: '', priority: 'medium', status: 'todo', due_date: '' })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, due_date: form.due_date || undefined }),
      })
      if (!res.ok) throw new Error((await res.json() as { error?: string }).error ?? 'Failed')
      toast.success('Task created')
      onOpenChange(false)
      onSave()
      setForm({ title: '', description: '', priority: 'medium', status: 'todo', due_date: '' })
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
            <CheckSquare className="size-4 text-primary" /> New Task
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1">
            <label className="text-sm font-medium">Title *</label>
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Send proposal to client" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Priority</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
              >
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Status</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Due Date</label>
            <Input type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Description</label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[64px] resize-none"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Task details..."
            />
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

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('todo')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (priorityFilter) params.set('priority', priorityFilter)
      const res = await fetch(`/api/tasks?${params}`)
      const data = await res.json() as { tasks: Task[]; total: number }
      setTasks(data.tasks ?? [])
      setTotal(data.total ?? 0)
    } finally {
      setLoading(false)
    }
  }, [statusFilter, priorityFilter])

  useEffect(() => { void fetchTasks() }, [fetchTasks])

  const updateStatus = async (id: string, status: string) => {
    await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    void fetchTasks()
  }

  const deleteTask = async (id: string) => {
    if (!confirm('Delete this task?')) return
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
    toast.success('Task deleted')
    void fetchTasks()
  }

  const isOverdue = (task: Task) =>
    task.status !== 'done' && task.status !== 'cancelled' && task.due_date && new Date(task.due_date) < new Date()

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CheckSquare className="size-6 text-primary" /> Tasks
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{total} task{total !== 1 ? 's' : ''}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2 self-start sm:self-auto">
          <Plus className="size-4" /> New Task
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="flex gap-1">
          {['', 'todo', 'in_progress', 'done', 'cancelled'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {s === '' ? 'All' : s.replace('_', ' ')}
            </button>
          ))}
        </div>
        <select
          className="rounded-full border border-input bg-background px-3 py-1 text-sm"
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
        >
          <option value="">All Priority</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-16 text-center">
          <CheckSquare className="mx-auto size-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No tasks</p>
          <Button className="mt-4 gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> New Task
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => {
            const overdue = isOverdue(task)
            return (
              <div
                key={task.id}
                className={`rounded-xl border p-4 flex items-start gap-3 transition-colors ${
                  overdue ? 'border-red-500/30 bg-red-500/5' : 'border-border bg-card hover:bg-muted/20'
                }`}
              >
                <button
                  onClick={() => updateStatus(task.id, task.status === 'done' ? 'todo' : 'done')}
                  className="mt-0.5 shrink-0"
                >
                  <CheckCircle2 className={`size-5 ${task.status === 'done' ? 'text-emerald-500' : 'text-muted-foreground/40 hover:text-emerald-400'} transition-colors`} />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 justify-between">
                    <p className={`font-medium ${task.status === 'done' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                      {task.title}
                    </p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="inline-flex items-center gap-1 text-xs font-medium capitalize">
                        {PRIORITY_ICONS[task.priority]} {task.priority}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[task.status] ?? ''}`}>
                        {task.status.replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                  {task.description && <p className="text-sm text-muted-foreground mt-0.5">{task.description}</p>}
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                    {task.due_date && (
                      <span className={overdue ? 'text-red-500 font-medium' : ''}>
                        Due: {new Date(task.due_date).toLocaleDateString()}
                      </span>
                    )}
                    {task.contact && <span>· {task.contact.name ?? task.contact.phone}</span>}
                    {task.lead && <span>· {task.lead.title}</span>}
                    {task.assignee && <span>· Assigned: {task.assignee.name ?? task.assignee.email}</span>}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger className="flex items-center justify-center size-8 shrink-0 rounded-md hover:bg-muted text-muted-foreground">
                    <MoreHorizontal className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-card">
                    <p className="px-2 py-1.5 text-xs text-muted-foreground font-medium">Set status</p>
                    {STATUSES.filter((s) => s !== task.status).map((s) => (
                      <DropdownMenuItem key={s} onClick={() => updateStatus(task.id, s)} className="capitalize">
                        {s.replace('_', ' ')}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => deleteTask(task.id)} className="text-destructive">Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )
          })}
        </div>
      )}

      <TaskFormDialog open={createOpen} onOpenChange={setCreateOpen} onSave={fetchTasks} />
    </div>
  )
}
