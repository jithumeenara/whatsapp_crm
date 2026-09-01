'use client'

import { useState, useEffect } from 'react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { MessageSquare, UserCheck, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

const DEFAULT_CONFIRM =
  "Hi {{name}}! Is that your real name? Please reply *Yes* to confirm or *No* to enter a different name."
const DEFAULT_ASK_NAME =
  "No problem! Please type your correct full name and I'll save it for you."

interface CaptureConfig {
  enabled: boolean
  confirm_message: string
  ask_name_message: string
}

export function CapturePanel() {
  const [config, setConfig] = useState<CaptureConfig>({
    enabled: false,
    confirm_message: DEFAULT_CONFIRM,
    ask_name_message: DEFAULT_ASK_NAME,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/account/capture-config')
      .then((r) => r.json())
      .then((d: CaptureConfig) => setConfig(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/account/capture-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!res.ok) throw new Error('Failed to save')
      toast.success('Contact capture settings saved.')
    } catch {
      toast.error('Failed to save settings. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const previewConfirm = config.confirm_message.replace(/\{\{name\}\}/gi, 'John Doe')

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm px-6 py-8 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[16px] font-semibold text-slate-900">Contact Name Capture</h2>
        <p className="text-[13px] text-slate-500 mt-0.5">
          When a new contact messages you for the first time, automatically verify or collect
          their real name before saving it to your CRM — keeps Leads, Follow-ups, and Tasks clean.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm flex items-start justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
            <UserCheck className="h-4.5 w-4.5 text-[#5B6CF9]" />
          </span>
          <div>
            <Label className="text-[13.5px] font-semibold text-slate-800">Enable Name Verification</Label>
            <p className="text-[12.5px] text-slate-500 mt-0.5">
              New contacts will be asked to confirm or correct their WhatsApp display name before it&apos;s saved to the CRM.
            </p>
          </div>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={(v) => setConfig((c) => ({ ...c, enabled: v }))}
        />
      </div>

      <div className={config.enabled ? 'space-y-5' : 'space-y-5 pointer-events-none opacity-40'}>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-3">
          <div>
            <Label className="text-[13px] font-semibold text-slate-800">Name Confirmation Message</Label>
            <p className="text-[12px] text-slate-500 mt-0.5">
              Sent to every new contact on their first message. Use{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">{'{{name}}'}</code> where
              their WhatsApp display name should appear.
            </p>
          </div>
          <Textarea
            value={config.confirm_message}
            onChange={(e) => setConfig((c) => ({ ...c, confirm_message: e.target.value }))}
            rows={3}
            placeholder={DEFAULT_CONFIRM}
            className="font-mono text-[13px] border-slate-200 focus-visible:ring-[#5B6CF9]/20"
          />

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              Preview — how it will appear
            </p>
            <div className="flex gap-2">
              <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-[#5B6CF9]" />
              <p className="text-[13px] text-slate-700">{previewConfirm}</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-3">
          <div>
            <Label className="text-[13px] font-semibold text-slate-800">Request Correct Name Message</Label>
            <p className="text-[12px] text-slate-500 mt-0.5">
              Sent when the contact replies <strong className="text-slate-700">No</strong> — asking them to type their real name.
            </p>
          </div>
          <Textarea
            value={config.ask_name_message}
            onChange={(e) => setConfig((c) => ({ ...c, ask_name_message: e.target.value }))}
            rows={2}
            placeholder={DEFAULT_ASK_NAME}
            className="font-mono text-[13px] border-slate-200 focus-visible:ring-[#5B6CF9]/20"
          />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <p className="font-semibold text-slate-800 text-[13px] mb-2.5">How it works</p>
          <ol className="space-y-1.5 text-[12.5px] text-slate-500 leading-relaxed">
            {[
              <>New contact sends any message → captured to inbox as usual</>,
              <>Bot sends the <em>Name Confirmation Message</em> with their WhatsApp display name</>,
              <>Contact replies <strong className="text-slate-700">Yes</strong> → name saved, ready for CRM</>,
              <>Contact replies <strong className="text-slate-700">No</strong> → bot sends the <em>Request Correct Name Message</em></>,
              <>Contact types their correct name → saved to CRM, flow complete</>,
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[9px] font-semibold text-slate-500">{i + 1}</span>
                {item}
              </li>
            ))}
          </ol>
        </div>

      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto h-9 px-5 text-[13px] bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white">
        {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : 'Save Settings'}
      </Button>
    </div>
  )
}
