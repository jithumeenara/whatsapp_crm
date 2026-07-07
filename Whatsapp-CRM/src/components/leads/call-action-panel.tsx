'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2, PhoneOff, Phone, MapPin, Calendar, CheckCircle2, MessageSquare } from 'lucide-react'
import { CloseEnquiryDialog } from './close-enquiry-dialog'
import { FollowupInlineForm } from './followup-inline-form'

interface CallActionPanelProps {
  leadId: string
  currentStatus: string
  onAction: (patch: Record<string, unknown>) => Promise<void>
}

type BusyKey = 'out_of_coverage' | 'busy' | 'switched_off' | 'invalid_number'
type ConnectedKey = 'visited' | 'appointment_fixed' | 'follow_up' | 'closed'

const NOT_CONNECTED: Array<{ key: BusyKey; label: string }> = [
  { key: 'out_of_coverage', label: 'Out of Coverage' },
  { key: 'busy', label: 'Busy' },
  { key: 'switched_off', label: 'Switched Off' },
  { key: 'invalid_number', label: 'Invalid Number' },
]

const CONNECTED: Array<{ key: ConnectedKey; label: string; icon: React.ReactNode }> = [
  { key: 'visited', label: 'Visited', icon: <MapPin className="size-3.5" /> },
  { key: 'appointment_fixed', label: 'Appointment Fixed', icon: <Calendar className="size-3.5" /> },
  { key: 'follow_up', label: 'Follow-up', icon: <MessageSquare className="size-3.5" /> },
  { key: 'closed', label: 'Close Enquiry', icon: <CheckCircle2 className="size-3.5" /> },
]

export function CallActionPanel({ leadId, currentStatus, onAction }: CallActionPanelProps) {
  const [loading, setLoading] = useState<string | null>(null)
  const [closeDialogOpen, setCloseDialogOpen] = useState(false)
  const [followupExpanded, setFollowupExpanded] = useState(false)

  const triggerAction = async (patch: Record<string, unknown>, key: string) => {
    setLoading(key)
    try {
      await onAction(patch)
    } finally {
      setLoading(null)
    }
  }

  const handleNotConnected = (key: BusyKey) => {
    void triggerAction({ status: 'call_not_connected', call_outcome: key }, key)
  }

  const handleConnected = (key: ConnectedKey) => {
    if (key === 'closed') {
      setCloseDialogOpen(true)
      return
    }
    if (key === 'follow_up') {
      setFollowupExpanded(true)
      return
    }
    void triggerAction({ status: key }, key)
  }

  const handleCloseConfirm = async (remarks: string) => {
    await triggerAction({ status: 'closed', closing_remarks: remarks }, 'closed')
    setCloseDialogOpen(false)
  }

  const handleFollowupSave = async (data: { due_at: string; note: string }) => {
    await triggerAction({ status: 'follow_up', due_at: data.due_at, follow_up_note: data.note }, 'follow_up')
    setFollowupExpanded(false)
  }

  const isActive = (key: string) => currentStatus === key

  return (
    <div className="space-y-4">
      {/* Call Not Connected */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <PhoneOff className="size-4" />
          Call Not Connected
        </div>
        <div className="grid grid-cols-2 gap-2">
          {NOT_CONNECTED.map(({ key, label }) => (
            <Button
              key={key}
              variant={isActive('call_not_connected') ? 'secondary' : 'outline'}
              size="sm"
              className="justify-start gap-2 text-xs"
              disabled={loading !== null}
              onClick={() => handleNotConnected(key)}
            >
              {loading === key ? <Loader2 className="size-3 animate-spin" /> : <PhoneOff className="size-3 shrink-0" />}
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="border-t border-slate-200" />

      {/* Call Connected */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-600">
          <Phone className="size-4" />
          Call Connected
        </div>
        <div className="grid grid-cols-2 gap-2">
          {CONNECTED.map(({ key, label, icon }) => (
            <Button
              key={key}
              variant={isActive(key) ? 'secondary' : 'outline'}
              size="sm"
              className="justify-start gap-2 text-xs"
              disabled={loading !== null}
              onClick={() => handleConnected(key)}
            >
              {loading === key ? <Loader2 className="size-3 animate-spin" /> : icon}
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* Follow-up inline form */}
      {followupExpanded && (
        <FollowupInlineForm
          onSave={handleFollowupSave}
          onCancel={() => setFollowupExpanded(false)}
        />
      )}

      {/* Close Enquiry dialog */}
      <CloseEnquiryDialog
        open={closeDialogOpen}
        onOpenChange={setCloseDialogOpen}
        onConfirm={handleCloseConfirm}
      />
    </div>
  )
}
