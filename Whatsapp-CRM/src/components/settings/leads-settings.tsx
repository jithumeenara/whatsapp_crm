'use client'

import { useState, useEffect } from 'react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Zap, BarChart3 } from 'lucide-react'
import { toast } from 'sonner'

interface LeadSettingsData {
  auto_lead_creation: boolean
  scoring_mode: string
}

export function LeadsSettings() {
  const [settings, setSettings] = useState<LeadSettingsData>({
    auto_lead_creation: false,
    scoring_mode: 'score',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/leads/settings')
      .then((r) => r.json())
      .then((d: LeadSettingsData) => setSettings(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/leads/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (!res.ok) throw new Error('Failed to save')
      toast.success('Lead settings saved.')
    } catch {
      toast.error('Failed to save settings. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-6 w-48 rounded bg-slate-100" />
        <div className="h-20 rounded bg-slate-100" />
        <div className="h-20 rounded bg-slate-100" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Lead Settings</h2>
        <p className="text-sm text-slate-500 mt-1">
          Configure how leads are created and scored in your CRM.
        </p>
      </div>

      {/* Auto Lead Creation */}
      <Card className="flex items-start justify-between gap-4 p-4">
        <div className="space-y-1 flex-1">
          <div className="flex items-center gap-2">
            <Zap className="size-4 text-primary" />
            <Label className="text-sm font-medium">Auto Lead Creation</Label>
          </div>
          <p className="text-xs text-slate-500">
            Automatically create a lead when a new customer sends their first WhatsApp message.
            The lead will appear in the New Leads pool for agents to claim.
          </p>
        </div>
        <Switch
          checked={settings.auto_lead_creation}
          onCheckedChange={(v) => setSettings((s) => ({ ...s, auto_lead_creation: v }))}
        />
      </Card>

      {/* Scoring Mode */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="size-4 text-primary" />
          <Label className="text-sm font-medium">Lead Scoring Mode</Label>
        </div>
        <p className="text-xs text-slate-500">
          Choose how leads are evaluated. This controls which scoring fields appear on lead cards and detail pages.
        </p>
        <Select
          value={settings.scoring_mode}
          onValueChange={(v) => v && setSettings((s) => ({ ...s, scoring_mode: v }))}
        >
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="score">Hot / Warm / Cold score</SelectItem>
            <SelectItem value="quality">Qualified / Not Qualified / Wrong Enquiry</SelectItem>
            <SelectItem value="both">Show both score and quality</SelectItem>
          </SelectContent>
        </Select>
      </Card>

      {/* Reference */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500 space-y-3">
        <p className="font-semibold text-slate-800 text-sm">Call Outcomes Reference</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="font-medium text-slate-800 mb-1">Call Not Connected</p>
            <ul className="space-y-0.5 list-disc list-inside">
              <li>Out of Coverage</li>
              <li>Busy</li>
              <li>Switched Off</li>
              <li>Invalid Number</li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-slate-800 mb-1">Call Connected</p>
            <ul className="space-y-0.5 list-disc list-inside">
              <li>Visited</li>
              <li>Appointment Fixed</li>
              <li>Follow-up scheduled</li>
              <li>Close Enquiry</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Kerala Districts Reference */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500 space-y-2">
        <p className="font-semibold text-slate-800 text-sm">Kerala Districts</p>
        <p className="flex flex-wrap gap-1.5">
          {[
            'Thiruvananthapuram', 'Kollam', 'Pathanamthitta', 'Alappuzha',
            'Kottayam', 'Idukki', 'Ernakulam', 'Thrissur', 'Palakkad',
            'Malappuram', 'Kozhikode', 'Wayanad', 'Kannur', 'Kasaragod',
          ].map((d) => (
            <span key={d} className="rounded bg-slate-100 px-1.5 py-0.5">{d}</span>
          ))}
        </p>
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
        {saving ? 'Saving…' : 'Save Settings'}
      </Button>
    </div>
  )
}
