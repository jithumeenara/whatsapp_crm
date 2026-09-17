'use client'

import { useState, useEffect } from 'react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { MessageSquare, UserCheck, Loader2, BellRing, Plus, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'

const DEFAULT_CONFIRM =
  "Hi {{name}}! Is that your real name? Please reply *Yes* to confirm or *No* to enter a different name."
const DEFAULT_ASK_NAME =
  "No problem! Please type your correct full name and I'll save it for you."

interface CaptureConfig {
  enabled: boolean
  confirm_message: string
  ask_name_message: string
  /** Tell staff on WhatsApp when a number nobody has seen before starts
   *  a conversation. */
  new_contact_alert_enabled: boolean
  new_contact_alert_numbers: string[]
  new_contact_alert_template: string | null
}

export function CapturePanel() {
  const [config, setConfig] = useState<CaptureConfig>({
    enabled: false,
    confirm_message: DEFAULT_CONFIRM,
    ask_name_message: DEFAULT_ASK_NAME,
    new_contact_alert_enabled: false,
    new_contact_alert_numbers: [],
    new_contact_alert_template: null,
  })
  const [numberInput, setNumberInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/account/capture-config')
      .then((r) => r.json())
      .then((d: Partial<CaptureConfig>) =>
        setConfig((c) => ({
          ...c,
          ...d,
          // An account saved before this existed has no array here, and
          // a null would break the chips below.
          new_contact_alert_numbers: Array.isArray(d.new_contact_alert_numbers)
            ? d.new_contact_alert_numbers
            : [],
        })),
      )
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

  function addNumber() {
    // Digits only: a number pasted as "+91 98765 43210" is the same
    // number, and refusing it over punctuation would be pedantry.
    const n = numberInput.replace(/[^\d]/g, '')
    if (n.length < 8 || config.new_contact_alert_numbers.includes(n)) return
    setConfig((c) => ({ ...c, new_contact_alert_numbers: [...c.new_contact_alert_numbers, n] }))
    setNumberInput('')
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
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm flex items-start justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EEF0FF]">
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

        {/* Alerting staff the moment a stranger writes in. Sits with
            contact capture because that is where "a new person arrived"
            is already the subject. */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label className="flex items-center gap-2 text-[13.5px] font-semibold text-slate-800">
                <BellRing className="h-4 w-4 text-[#5B6CF9]" />
                Alert staff when someone new messages
              </Label>
              <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">
                A number nobody has seen before starts a conversation, and these numbers get their
                name, their number and what they said. Otherwise that first message is visible only
                to whoever has the inbox open.
              </p>
            </div>
            <Switch
              checked={config.new_contact_alert_enabled}
              onCheckedChange={(v) =>
                setConfig((c) => ({ ...c, new_contact_alert_enabled: v }))
              }
            />
          </div>

          {config.new_contact_alert_enabled && (
            <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
              <div className="flex gap-2">
                <Input
                  value={numberInput}
                  onChange={(e) => setNumberInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addNumber()
                    }
                  }}
                  placeholder="919876543210"
                  inputMode="numeric"
                  className="h-9 border-slate-200 text-[13px]"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={addNumber}
                  className="h-9 shrink-0 gap-1.5 border-slate-200 text-[13px]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </Button>
              </div>
              <p className="text-[11.5px] text-slate-400">
                Country code first, no plus sign and no spaces.
              </p>

              {config.new_contact_alert_numbers.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {config.new_contact_alert_numbers.map((n) => (
                    <span
                      key={n}
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-100 py-1 pl-2.5 pr-1.5 font-mono text-[12px] text-slate-700"
                    >
                      {n}
                      <button
                        type="button"
                        onClick={() =>
                          setConfig((c) => ({
                            ...c,
                            new_contact_alert_numbers: c.new_contact_alert_numbers.filter(
                              (x) => x !== n,
                            ),
                          }))
                        }
                        className="text-slate-400 transition-colors hover:text-rose-500"
                        aria-label={`Remove ${n}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-[12.5px] text-slate-600">
                  Template name (optional)
                </Label>
                <Input
                  value={config.new_contact_alert_template ?? ''}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      new_contact_alert_template: e.target.value.trim() || null,
                    }))
                  }
                  placeholder="new_contact_alert"
                  className="h-9 border-slate-200 font-mono text-[13px]"
                />
              </div>

              {/* Said plainly, because getting this wrong produces an
                  alert that silently never arrives — the worst possible
                  failure for an alert. */}
              <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-amber-800">
                {config.new_contact_alert_template
                  ? 'The template needs four variables, in this order: their name, their number, what they said, and the channel.'
                  : 'Without a template, this only reaches a staff member who messaged this business number in the last 24 hours — that is Meta\u2019s rule, not a setting. A number that never writes in gets nothing, with no error. Name an approved Utility template to make alerts arrive every time.'}
              </p>
            </div>
          )}
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
