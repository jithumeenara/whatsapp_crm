'use client'

import { useState, useEffect } from 'react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { MessageSquare, UserCheck } from 'lucide-react'
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
      <div className="space-y-4 animate-pulse">
        <div className="h-6 w-48 rounded bg-slate-100" />
        <div className="h-24 rounded bg-slate-100" />
        <div className="h-24 rounded bg-slate-100" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Contact Name Capture</h2>
        <p className="text-sm text-slate-500 mt-1">
          When a new contact messages you for the first time, automatically verify or collect
          their real name before saving it to your CRM. This keeps your Leads, Follow-ups,
          and Tasks records clean and accurate.
        </p>
      </div>

      {/* Enable toggle */}
      <Card className="flex items-start justify-between gap-4 p-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <UserCheck className="size-4 text-primary" />
            <Label className="text-sm font-medium">Enable Name Verification</Label>
          </div>
          <p className="text-xs text-slate-500">
            When enabled, new contacts will be asked to confirm or correct their WhatsApp
            display name before being saved to the CRM.
          </p>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={(v) => setConfig((c) => ({ ...c, enabled: v }))}
        />
      </Card>

      {/* Config sections — only active when enabled */}
      <div className={config.enabled ? '' : 'pointer-events-none opacity-40'}>

      {/* Confirmation message */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Name Confirmation Message</Label>
        <p className="text-xs text-slate-500">
          Sent to every new contact on their first message. Use{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">{'{{name}}'}</code> where
          their WhatsApp display name should appear.
        </p>
        <Textarea
          value={config.confirm_message}
          onChange={(e) => setConfig((c) => ({ ...c, confirm_message: e.target.value }))}
          rows={3}
          placeholder={DEFAULT_CONFIRM}
          className="font-mono text-sm"
        />

        {/* Live preview */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            Preview — how it will appear
          </p>
          <div className="flex gap-2">
            <MessageSquare className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="text-sm text-slate-800/80">{previewConfirm}</p>
          </div>
        </div>
      </div>

      {/* Ask-name message */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Request Correct Name Message</Label>
        <p className="text-xs text-slate-500">
          Sent when the contact replies <strong>No</strong> — asking them to type their real name.
        </p>
        <Textarea
          value={config.ask_name_message}
          onChange={(e) => setConfig((c) => ({ ...c, ask_name_message: e.target.value }))}
          rows={2}
          placeholder={DEFAULT_ASK_NAME}
          className="font-mono text-sm"
        />
      </div>

      {/* Flow diagram */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-500 space-y-2">
        <p className="font-semibold text-slate-800 text-sm">How it works</p>
        <ol className="list-decimal list-inside space-y-1 leading-relaxed">
          <li>New contact sends any message → captured to inbox as usual</li>
          <li>Bot sends the <em>Name Confirmation Message</em> with their WhatsApp display name</li>
          <li>
            Contact replies <strong className="text-slate-800">Yes</strong> → name saved, ready for CRM
          </li>
          <li>
            Contact replies <strong className="text-slate-800">No</strong> → bot sends the{' '}
            <em>Request Correct Name Message</em>
          </li>
          <li>Contact types their correct name → saved to CRM, flow complete</li>
        </ol>
      </div>

      </div>{/* end config sections */}

      <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
        {saving ? 'Saving…' : 'Save Settings'}
      </Button>
    </div>
  )
}
