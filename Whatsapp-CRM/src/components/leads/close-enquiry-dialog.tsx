'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'

interface CloseEnquiryDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  onConfirm: (remarks: string) => Promise<void>
}

export function CloseEnquiryDialog({ open, onOpenChange, onConfirm }: CloseEnquiryDialogProps) {
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)

  const handleConfirm = async () => {
    if (!remarks.trim()) return
    setSaving(true)
    try {
      await onConfirm(remarks.trim())
      setRemarks('')
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-white">
        <DialogHeader>
          <DialogTitle>Close Enquiry</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Closing Remarks <span className="text-destructive">*</span></Label>
            <textarea
              className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm min-h-[100px] resize-none"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Enter reason for closing this enquiry…"
              autoFocus
            />
            {!remarks.trim() && remarks.length > 0 && (
              <p className="text-xs text-destructive">Closing remarks are required.</p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleConfirm} disabled={saving || !remarks.trim()} className="gap-2">
              {saving && <Loader2 className="size-4 animate-spin" />}
              Confirm Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
