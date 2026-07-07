'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Lead } from '@/types'

const KERALA_DISTRICTS = [
  'Thiruvananthapuram', 'Kollam', 'Pathanamthitta', 'Alappuzha',
  'Kottayam', 'Idukki', 'Ernakulam', 'Thrissur', 'Palakkad',
  'Malappuram', 'Kozhikode', 'Wayanad', 'Kannur', 'Kasaragod',
]

const DEFAULT_SOURCES = [
  { icon: '', label: 'WhatsApp' }, { icon: '', label: 'Instagram' },
  { icon: '🌐', label: 'Website' }, { icon: '📣', label: 'Campaign' },
  { icon: '🔗', label: 'Referral' }, { icon: '👤', label: 'Manual' }, { icon: '📝', label: 'Other' },
]

interface LeadDetailFormProps {
  lead: Lead
  scoringMode: string
  sources?: { icon: string; label: string }[]
  onChange: (patch: Partial<Lead>) => void
}

export function LeadDetailForm({ lead, scoringMode, sources = DEFAULT_SOURCES, onChange }: LeadDetailFormProps) {
  const showScore = scoringMode === 'score' || scoringMode === 'both'
  const showQuality = scoringMode === 'quality' || scoringMode === 'both'

  return (
    <div className="space-y-4">
      {/* Read-only contact info */}
      <div className="grid grid-cols-1 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-slate-500 uppercase tracking-wide">Name</Label>
          <p className="text-sm font-medium text-slate-800">{lead.contact?.name ?? lead.title}</p>
        </div>
        {lead.contact?.phone && (
          <div className="space-y-1">
            <Label className="text-xs text-slate-500 uppercase tracking-wide">Mobile</Label>
            <p className="text-sm text-slate-800">{lead.contact.phone}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* District */}
        <div className="space-y-1">
          <Label className="text-sm font-medium">District</Label>
          <select
            className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
            value={lead.district ?? ''}
            onChange={(e) => onChange({ district: e.target.value || null })}
          >
            <option value="">Select district</option>
            {KERALA_DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        {/* Place */}
        <div className="space-y-1">
          <Label className="text-sm font-medium">Place</Label>
          <Input
            value={lead.place ?? ''}
            onChange={(e) => onChange({ place: e.target.value || null })}
            placeholder="City / area"
          />
        </div>
      </div>

      {/* Source */}
      <div className="space-y-1">
        <Label className="text-sm font-medium">Source</Label>
        <select
          className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
          value={lead.source}
          onChange={(e) => onChange({ source: e.target.value as Lead['source'] })}
        >
          {sources.map(({ icon, label }) => (
            <option key={label} value={label}>{icon ? icon + ' ' : ''}{label}</option>
          ))}
        </select>
      </div>

      {/* Score */}
      {showScore && (
        <div className="space-y-1">
          <Label className="text-sm font-medium">Score</Label>
          <select
            className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
            value={lead.score}
            onChange={(e) => onChange({ score: e.target.value as Lead['score'] })}
          >
            <option value="hot">Hot</option>
            <option value="warm">Warm</option>
            <option value="cold">Cold</option>
          </select>
        </div>
      )}

      {/* Lead Quality */}
      {showQuality && (
        <div className="space-y-1">
          <Label className="text-sm font-medium">Lead Quality</Label>
          <select
            className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
            value={lead.lead_quality ?? ''}
            onChange={(e) => onChange({ lead_quality: (e.target.value as Lead['lead_quality']) || null })}
          >
            <option value="">Not set</option>
            <option value="qualified">Qualified</option>
            <option value="not_qualified">Not Qualified</option>
            <option value="wrong_enquiry">Wrong Enquiry</option>
          </select>
        </div>
      )}

      {/* Notes */}
      <div className="space-y-1">
        <Label className="text-sm font-medium">Notes</Label>
        <textarea
          className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm min-h-[80px] resize-none"
          value={lead.notes ?? ''}
          onChange={(e) => onChange({ notes: e.target.value || null })}
          placeholder="Add any notes about this lead…"
        />
      </div>

      {/* Timestamps */}
      <div className="pt-2 border-t border-slate-200 space-y-1">
        <p className="text-xs text-slate-500">
          Created: {new Date(lead.created_at).toLocaleString()}
        </p>
        {lead.claimed_at && (
          <p className="text-xs text-slate-500">
            Claimed: {new Date(lead.claimed_at).toLocaleString()}
          </p>
        )}
        <p className="text-xs text-slate-500">
          Updated: {new Date(lead.updated_at).toLocaleString()}
        </p>
      </div>
    </div>
  )
}
