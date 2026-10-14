'use client'

import { KeyRound, MessageCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { credentialLines, credentialsShareText, type CreatedAgent } from '@/lib/auth/agent-credentials'

/** A new password for an agent, shown once with the same "send on WhatsApp" as Add Agent. */
export function AgentCredentialsDialog({
  agent,
  onClose,
}: {
  agent: CreatedAgent | null
  onClose: () => void
}) {
  const siteUrl = typeof window !== 'undefined' ? window.location.origin : ''
  return (
    <Dialog open={agent !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="bg-white border-slate-200 sm:max-w-md">
        {agent && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-slate-800">
                <KeyRound className="size-4 text-[#4A5CE8]" />
                New password made
              </DialogTitle>
              <DialogDescription className="text-slate-500">
                Send these to <span className="font-medium text-slate-800/80">{agent.name || 'the agent'}</span>.
                Their old password no longer works and they have been signed out.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <div className="rounded-lg border border-slate-200 bg-slate-100 p-4 space-y-2.5 text-sm">
                {credentialLines(agent).map((line) => (
                  <div key={line.label} className="flex items-center justify-between gap-3">
                    <span className="text-slate-500">{line.label}</span>
                    <span className="break-all text-right font-mono font-semibold text-slate-800">{line.value}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-500">The password is shown only now — send it before closing.</p>
              <a
                href={`https://wa.me/${agent.whatsapp}?text=${encodeURIComponent(credentialsShareText(agent, siteUrl))}`}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center justify-center gap-2 w-full rounded-md border border-[#25D366]/40 bg-[#25D366]/10 px-4 py-2.5 text-sm font-medium text-emerald-800 hover:bg-[#25D366]/20 transition-colors"
              >
                <MessageCircle className="size-4" />
                Send credentials via WhatsApp
              </a>
            </div>

            <DialogFooter className="bg-white border-slate-200">
              <Button onClick={onClose} className="bg-[#4A5CE8] hover:bg-[#3D4FD6] text-white">
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
