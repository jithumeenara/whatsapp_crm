'use client'

/**
 * Settings → Database.
 *
 * Download a backup — the server owner only (src/lib/auth/platform-owner.ts):
 * the file is the whole database, every workspace on this server.
 *
 * Restoring is deliberately not here. It ran any uploaded SQL against the
 * live database, and a backup begins by dropping every table — one upload
 * from one stolen session replaced everything. It is done on the server,
 * into a new database first, as the card below says.
 */

import { useState } from 'react'
import { AlertCircle, CheckCircle2, Database, Download, Loader2, ShieldCheck, Terminal } from 'lucide-react'
import { errorText } from '@/lib/api-fetch'

type Status = 'idle' | 'loading' | 'success' | 'error'

function SectionCard({ title, description, icon: Icon, tone = 'indigo', children }: {
  title: string
  description: React.ReactNode
  icon: React.ElementType
  tone?: 'indigo' | 'emerald'
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start gap-3 border-b border-slate-100 px-6 py-4">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone === 'emerald' ? 'bg-emerald-50' : 'bg-[#EEF0FF]'}`}>
          <Icon className={`h-4.5 w-4.5 ${tone === 'emerald' ? 'text-emerald-600' : 'text-[#4A5CE8]'}`} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold text-slate-800">{title}</h2>
          <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">{description}</p>
        </div>
      </div>
      <div className="space-y-4 px-6 py-5">{children}</div>
    </div>
  )
}

export function DatabasePanel() {
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)

  const handleBackup = async () => {
    if (status === 'loading') return
    setStatus('loading')
    setError(null)
    try {
      const res = await fetch('/api/database/backup')
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Backup failed (${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const match = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)
      a.download = match?.[1] ?? `crm-db-backup-${new Date().toISOString().slice(0, 10)}.sql`
      a.href = url
      a.click()
      URL.revokeObjectURL(url)
      setStatus('success')
      setTimeout(() => setStatus('idle'), 4000)
    } catch (err) {
      console.error('[database] backup failed:', err)
      setError(errorText(err, 'Backup failed'))
      setStatus('error')
    }
  }

  return (
    <div className="space-y-5">
      <SectionCard
        title="Download a backup"
        icon={Database}
        description="A complete copy of this server's database as a .sql file. Only the server owner can download it — it holds every workspace's data."
      >
        <button
          type="button"
          onClick={() => void handleBackup()}
          disabled={status === 'loading'}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#4A5CE8] px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-[#3D4FD6] disabled:opacity-60"
        >
          {status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {status === 'loading' ? 'Preparing…' : 'Download backup'}
        </button>
        {status === 'success' && (
          <p className="flex items-center gap-2 text-[12.5px] font-medium text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Downloaded. Keep it somewhere safe, off this computer&apos;s shared folders.
          </p>
        )}
        {status === 'error' && error && (
          <p className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-[12.5px] text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </p>
        )}
      </SectionCard>

      <SectionCard
        title="Automatic backups and restoring"
        icon={ShieldCheck}
        tone="emerald"
        description="Restoring replaces data, so it is never done from a web page. It is done on the server, and checked in a new database before the live one is touched."
      >
        <ul className="space-y-2 text-[12.5px] leading-relaxed text-slate-600">
          <li className="flex gap-2"><Terminal className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <span>Nightly backups: <code className="rounded bg-slate-100 px-1 text-[11.5px]">scripts/backup-db.sh</code>, run by cron on the server, keeps the last 14 days.</span>
          </li>
          <li className="flex gap-2"><Terminal className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <span>To restore: load the file into a <b>new, empty</b> database with <code className="rounded bg-slate-100 px-1 text-[11.5px]">psql</code>, check it, then point the app at it. Never over the live database.</span>
          </li>
        </ul>
      </SectionCard>
    </div>
  )
}
