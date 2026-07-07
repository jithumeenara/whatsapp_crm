'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  MessageSquare,
  CheckSquare,
  CalendarCheck,
  Bell,
  ArrowRight,
  UserPlus,
} from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'

interface Conversation {
  id: string
  status: string
  unread_count: number
  last_message_text: string | null
  last_message_at: string | null
  assigned_agent_id: string | null
  contact: { name: string | null; phone: string } | null
}

interface Task {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
}

interface FollowUp {
  id: string
  title: string
  status: string
  due_at: string
}

function greeting(name: string | null | undefined) {
  const hour = new Date().getHours()
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
  return `Good ${part}${name ? `, ${name.split(' ')[0]}` : ''}!`
}

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function AgentDashboard() {
  const { profile, userId } = useAuth()

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [cRes, tRes, fRes] = await Promise.all([
        fetch('/api/conversations', { cache: 'no-store' }),
        fetch('/api/tasks?limit=100', { cache: 'no-store' }),
        fetch('/api/follow-ups?status=pending&limit=100', { cache: 'no-store' }),
      ])
      if (cRes.ok) setConversations(await cRes.json())
      if (tRes.ok) {
        const d = await tRes.json()
        setTasks(d.tasks ?? [])
      }
      if (fRes.ok) {
        const d = await fRes.json()
        setFollowUps(d.followUps ?? [])
      }
    } catch (e) {
      console.error('[AgentDashboard]', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadData() }, [loadData])

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const myChats = conversations.filter((c) => c.assigned_agent_id === userId)
  const unread = myChats.reduce((sum, c) => sum + (c.unread_count ?? 0), 0)
  const openChats = myChats.filter((c) => c.status === 'open').length
  const myTasks = tasks.filter(
    (t) =>
      t.status !== 'done' &&
      t.due_date &&
      new Date(t.due_date) <= new Date(today.getTime() + 86400000),
  )
  const myFollowUps = followUps.filter(
    (f) => new Date(f.due_at) <= new Date(today.getTime() + 86400000),
  )

  const statCards = [
    { label: 'My Active Chats', value: openChats, icon: MessageSquare, href: '/inbox', color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: 'Unread Messages', value: unread, icon: Bell, href: '/inbox', color: 'text-amber-400', bg: 'bg-amber-500/10' },
    { label: 'Tasks Due Today', value: myTasks.length, icon: CheckSquare, href: '/tasks', color: 'text-green-400', bg: 'bg-green-500/10' },
    { label: 'Follow-ups Due', value: myFollowUps.length, icon: CalendarCheck, href: '/follow-ups', color: 'text-purple-400', bg: 'bg-purple-500/10' },
  ]

  const recentChats = [...myChats]
    .sort((a, b) => new Date(b.last_message_at ?? 0).getTime() - new Date(a.last_message_at ?? 0).getTime())
    .slice(0, 6)

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">{greeting(profile?.full_name)}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Here's your work summary for today.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {statCards.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:bg-slate-100"
          >
            <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${s.bg}`}>
              <s.icon className={`h-4 w-4 ${s.color}`} />
            </div>
            {loading ? (
              <div className="h-7 w-12 animate-pulse rounded bg-slate-100" />
            ) : (
              <p className="text-2xl font-bold text-slate-800">{s.value}</p>
            )}
            <p className="mt-0.5 text-xs text-slate-500">{s.label}</p>
          </Link>
        ))}
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3">
        <Link
          href="/inbox"
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-100 transition-colors"
        >
          <MessageSquare className="size-4 text-primary" />
          Open Inbox
          <ArrowRight className="size-3.5 text-slate-500" />
        </Link>
        <Link
          href="/contacts"
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-100 transition-colors"
        >
          <UserPlus className="size-4 text-primary" />
          New Contact
          <ArrowRight className="size-3.5 text-slate-500" />
        </Link>
        <Link
          href="/tasks"
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-100 transition-colors"
        >
          <CheckSquare className="size-4 text-primary" />
          My Tasks
          <ArrowRight className="size-3.5 text-slate-500" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Recent assigned chats */}
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-800">My Recent Chats</h2>
            <Link href="/inbox" className="text-xs text-primary hover:underline">
              View all
            </Link>
          </div>
          {loading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />
              ))}
            </div>
          ) : recentChats.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <MessageSquare className="mb-2 size-8 text-slate-500/40" />
              <p className="text-sm text-slate-500">No chats assigned to you yet</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-200">
              {recentChats.map((c) => (
                <li key={c.id}>
                  <Link
                    href="/inbox"
                    className="flex items-center gap-3 px-4 py-3 hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                      {(c.contact?.name ?? c.contact?.phone ?? '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {c.contact?.name ?? c.contact?.phone ?? 'Unknown'}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {c.last_message_text ?? '—'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-[10px] text-slate-500">
                        {timeAgo(c.last_message_at)}
                      </span>
                      {c.unread_count > 0 && (
                        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                          {c.unread_count}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Tasks due today */}
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-800">Tasks Due Today</h2>
            <Link href="/tasks" className="text-xs text-primary hover:underline">
              View all
            </Link>
          </div>
          {loading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />
              ))}
            </div>
          ) : myTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CheckSquare className="mb-2 size-8 text-slate-500/40" />
              <p className="text-sm text-slate-500">No tasks due today</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-200">
              {myTasks.slice(0, 6).map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <div className={`h-2 w-2 shrink-0 rounded-full ${
                    t.priority === 'urgent' ? 'bg-red-400' :
                    t.priority === 'high' ? 'bg-amber-400' :
                    t.priority === 'medium' ? 'bg-blue-400' : 'bg-slate-100-foreground/40'
                  }`} />
                  <span className="flex-1 truncate text-sm text-slate-800">{t.title}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                    t.status === 'in_progress'
                      ? 'bg-blue-500/10 text-blue-400'
                      : 'bg-slate-100 text-slate-500'
                  }`}>
                    {t.status === 'in_progress' ? 'In Progress' : 'Todo'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

