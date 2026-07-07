'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle, Loader2, MessageCircle, Phone, User } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface AddAgentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

interface CreatedAgent {
  name: string
  username: string
  whatsapp: string
}

export function AddAgentDialog({ open, onOpenChange, onCreated }: AddAgentDialogProps) {
  const [name, setName] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<CreatedAgent | null>(null)

  function reset() {
    setName('')
    setWhatsapp('')
    setSubmitting(false)
    setResult(null)
  }

  async function handleCreate() {
    if (!name.trim() || !whatsapp.trim()) {
      toast.error('Please fill in all fields')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/account/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), whatsapp: whatsapp.trim() }),
      })
      const data = (await res.json()) as { error?: string; member?: CreatedAgent }
      if (!res.ok) {
        toast.error(data.error || 'Failed to create agent')
        return
      }
      if (data.member) setResult(data.member)
      onCreated()
    } catch {
      toast.error('Could not reach the server')
    } finally {
      setSubmitting(false)
    }
  }

  function waShareUrl() {
    if (!result) return '#'
    const siteUrl = typeof window !== 'undefined' ? window.location.origin : ''
    const msg = [
      `Hi ${result.name}! Here are your WhatsApp CRM login details:`,
      ``,
      `Login URL: ${siteUrl}/login`,
      `Username: ${result.username}`,
      `Password: ${result.username}`,
      ``,
      `Please change your password after first login.`,
    ].join('\n')
    return `https://wa.me/${result.whatsapp}?text=${encodeURIComponent(msg)}`
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="bg-white border-slate-200 sm:max-w-md">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-slate-800">
                <CheckCircle className="size-4 text-green-400" />
                Agent account created
              </DialogTitle>
              <DialogDescription className="text-slate-500">
                Share these credentials with{' '}
                <span className="font-medium text-slate-800/80">{result.name}</span>.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <div className="rounded-lg border border-slate-200 bg-slate-100 p-4 space-y-2.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Username</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {result.username}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Password</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {result.username}
                  </span>
                </div>
              </div>

              <p className="text-xs text-slate-500">
                Username and initial password are both the WhatsApp number (digits only). The
                agent can change their password from Settings → Profile after logging in.
              </p>

              <a
                href={waShareUrl()}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center justify-center gap-2 w-full rounded-md border border-[#25D366]/40 bg-[#25D366]/10 px-4 py-2.5 text-sm font-medium text-[#25D366] hover:bg-[#25D366]/20 transition-colors"
              >
                <MessageCircle className="size-4" />
                Send credentials via WhatsApp
              </a>
            </div>

            <DialogFooter className="bg-white border-slate-200">
              <Button
                onClick={() => onOpenChange(false)}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-slate-800">Add Agent</DialogTitle>
              <DialogDescription className="text-slate-500">
                Create an agent account instantly. Their WhatsApp number becomes their
                username and default password — no invite link needed.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label className="text-slate-800/80 flex items-center gap-1.5">
                  <User className="size-3.5" />
                  Full Name
                </Label>
                <Input
                  placeholder="e.g. Sara Mathews"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-slate-100 border-slate-200 text-slate-800 placeholder:text-slate-500"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-800/80 flex items-center gap-1.5">
                  <Phone className="size-3.5" />
                  WhatsApp Number (with country code)
                </Label>
                <Input
                  placeholder="e.g. 919876543210"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  className="bg-slate-100 border-slate-200 text-slate-800 placeholder:text-slate-500"
                />
                <p className="text-xs text-slate-500">
                  Full number with country code, no spaces or +. This becomes both the
                  login username and initial password.
                </p>
              </div>
            </div>

            <DialogFooter className="bg-white border-slate-200">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-slate-200 text-slate-800/80 hover:bg-slate-100"
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={submitting}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Creating…
                  </>
                ) : (
                  'Create Agent'
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
