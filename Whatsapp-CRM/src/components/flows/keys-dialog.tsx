'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  KeyRound,
  RefreshCw,
  Copy,
  Check,
  Upload,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  FileKey2,
} from 'lucide-react'
import { toast } from 'sonner'

interface Keys {
  privateKey: string
  publicKey: string
  envValue: string
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <Button variant="ghost" size="sm" onClick={copy} className="h-7 gap-1.5 text-xs">
      {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
      {label ?? (copied ? 'Copied!' : 'Copy')}
    </Button>
  )
}

interface KeysDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function KeysDialog({ open, onOpenChange }: KeysDialogProps) {
  const [keys, setKeys] = useState<Keys | null>(null)
  const [generating, setGenerating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [uploadError, setUploadError] = useState<string | null>(null)

  const handleGenerate = async () => {
    setGenerating(true)
    setKeys(null)
    setUploadStatus('idle')
    setUploadError(null)
    try {
      const res = await fetch('/api/flows/keys', { method: 'POST' })
      const body = await res.json() as Keys & { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Key generation failed')
      setKeys(body)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate keys')
    } finally {
      setGenerating(false)
    }
  }

  const handleUploadToMeta = async () => {
    if (!keys) return
    setUploading(true)
    setUploadStatus('idle')
    setUploadError(null)
    try {
      const res = await fetch('/api/flows/keys/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey: keys.publicKey }),
      })
      const body = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Upload failed')
      setUploadStatus('success')
      toast.success('Public key uploaded to Meta successfully!')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      setUploadError(msg)
      setUploadStatus('error')
      toast.error(msg)
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-primary" />
            WhatsApp Flows Encryption Keys
          </DialogTitle>
          <DialogDescription>
            Generate an RSA-2048 key pair for Meta WhatsApp Flows. The public key
            is uploaded to Meta; the private key goes in your <code className="text-xs bg-muted px-1 py-0.5 rounded">.env.local</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Generate button */}
          <Button onClick={handleGenerate} disabled={generating} className="gap-2">
            {generating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {keys ? 'Regenerate Key Pair' : 'Generate Key Pair'}
          </Button>

          {keys && (
            <div className="space-y-4">
              {/* Warning */}
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3 flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <span>
                  <strong>Save the private key now.</strong> It will not be shown again after
                  you close this dialog. If you regenerate keys, all existing flow sessions will stop working
                  until you restart the server with the new key.
                </span>
              </div>

              {/* Step 1 — Private key */}
              <div className="rounded-lg border border-border bg-background p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="rounded bg-primary/10 p-1">
                      <FileKey2 className="size-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Step 1 — Private Key</p>
                      <p className="text-xs text-muted-foreground">Add this line to your <code className="bg-muted px-1 rounded">.env.local</code> and restart the server</p>
                    </div>
                  </div>
                  <CopyButton text={keys.envValue} label="Copy .env line" />
                </div>
                <pre className="text-[11px] bg-muted rounded-lg p-3 overflow-auto max-h-24 text-emerald-400 leading-relaxed break-all whitespace-pre-wrap">
                  {keys.envValue}
                </pre>
              </div>

              {/* Step 2 — Upload public key to Meta */}
              <div className="rounded-lg border border-border bg-background p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="rounded bg-primary/10 p-1">
                      <ShieldCheck className="size-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Step 2 — Upload Public Key to Meta</p>
                      <p className="text-xs text-muted-foreground">Registers the key with your WhatsApp phone number so Meta can encrypt requests</p>
                    </div>
                  </div>
                  <CopyButton text={keys.publicKey} label="Copy PEM" />
                </div>

                <pre className="text-[11px] bg-muted rounded-lg p-3 overflow-auto max-h-24 text-sky-400 leading-relaxed whitespace-pre-wrap">
                  {keys.publicKey}
                </pre>

                <div className="flex items-center gap-3">
                  <Button
                    onClick={handleUploadToMeta}
                    disabled={uploading || uploadStatus === 'success'}
                    variant={uploadStatus === 'success' ? 'outline' : 'default'}
                    className="gap-2"
                  >
                    {uploading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : uploadStatus === 'success' ? (
                      <CheckCircle2 className="size-4 text-emerald-400" />
                    ) : (
                      <Upload className="size-4" />
                    )}
                    {uploading ? 'Uploading…' : uploadStatus === 'success' ? 'Uploaded to Meta' : 'Upload Public Key to Meta'}
                  </Button>

                  {uploadStatus === 'error' && (
                    <p className="text-sm text-destructive flex items-center gap-1.5">
                      <AlertCircle className="size-4 shrink-0" />
                      {uploadError}
                    </p>
                  )}
                </div>
              </div>

              {/* Step 3 reminder */}
              <div className="rounded-lg bg-muted/50 border border-border p-3 flex items-start gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 shrink-0 mt-0.5 text-primary" />
                <span>
                  <strong className="text-foreground">Step 3</strong> — After saving <code className="text-xs bg-muted px-1 rounded">FLOWS_PRIVATE_KEY</code> to
                  your <code className="text-xs bg-muted px-1 rounded">.env.local</code>, restart the dev server
                  (<code className="text-xs bg-muted px-1 rounded">npm run dev</code>) for the new key to take effect.
                  Then test your flow endpoint in Meta Playground.
                </span>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
