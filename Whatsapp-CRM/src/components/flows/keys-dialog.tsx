'use client'

import { useState, useEffect } from 'react'
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
  RotateCcw,
} from 'lucide-react'
import { toast } from 'sonner'

interface Keys {
  privateKey: string
  publicKey: string
  envValue: string
  uploadedToMeta: boolean
  uploadError?: string
}

interface CurrentKeyStatus {
  hasKey: boolean
  publicKey?: string
  fingerprint?: string
  source?: 'db' | 'env'
  error?: string
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
  const [currentKey, setCurrentKey] = useState<CurrentKeyStatus | null>(null)
  const [resyncUploading, setResyncUploading] = useState(false)
  const [resyncStatus, setResyncStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [resyncError, setResyncError] = useState<string | null>(null)

  // Load current key status when dialog opens
  useEffect(() => {
    if (!open) return
    setCurrentKey(null)
    setResyncStatus('idle')
    setResyncError(null)
    fetch('/api/flows/keys')
      .then(r => r.json())
      .then((b: CurrentKeyStatus) => setCurrentKey(b))
      .catch(() => setCurrentKey({ hasKey: false, error: 'Failed to load key status' }))
  }, [open])

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
      // Refresh current key display
      setCurrentKey(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate keys')
    } finally {
      setGenerating(false)
    }
  }

  const uploadKey = async (publicKey: string, opts: {
    setUploading: (v: boolean) => void
    setStatus: (v: 'idle' | 'success' | 'error') => void
    setError: (v: string | null) => void
  }) => {
    opts.setUploading(true)
    opts.setStatus('idle')
    opts.setError(null)
    try {
      const res = await fetch('/api/flows/keys/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey }),
      })
      const body = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Upload failed')
      opts.setStatus('success')
      toast.success('Public key uploaded to Meta successfully!')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      opts.setError(msg)
      opts.setStatus('error')
      toast.error(msg)
    } finally {
      opts.setUploading(false)
    }
  }

  const handleUploadToMeta = () =>
    uploadKey(keys!.publicKey, {
      setUploading: setUploading,
      setStatus: setUploadStatus,
      setError: setUploadError,
    })

  const handleResync = () =>
    uploadKey(currentKey!.publicKey!, {
      setUploading: setResyncUploading,
      setStatus: setResyncStatus,
      setError: setResyncError,
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl bg-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-primary" />
            WhatsApp Flows Encryption Keys
          </DialogTitle>
          <DialogDescription>
            Generate an RSA-2048 key pair for Meta WhatsApp Flows. The public key
            is uploaded to Meta; the private key goes in your <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">.env.local</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Current key status + resync */}
          {currentKey && !keys && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className={`rounded p-1 ${currentKey.hasKey ? 'bg-emerald-500/10' : 'bg-destructive/10'}`}>
                  {currentKey.hasKey
                    ? <ShieldCheck className="size-4 text-emerald-500" />
                    : <AlertCircle className="size-4 text-destructive" />}
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {currentKey.hasKey ? 'Active key detected' : 'No key configured'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {currentKey.hasKey
                      ? 'FLOWS_PRIVATE_KEY is set. Use "Resync" if Meta is showing decryption errors.'
                      : 'Generate a key pair below to enable WhatsApp Flows encryption.'}
                  </p>
                </div>
              </div>

              {currentKey.hasKey && currentKey.publicKey && (
                <>
                  {currentKey.source && (
                    <p className="text-[11px] text-slate-500">
                      Source: <span className="font-mono">{currentKey.source === 'db' ? 'database (active)' : 'FLOWS_PRIVATE_KEY env var'}</span>
                    </p>
                  )}
                  <pre className="text-[11px] bg-slate-100 rounded-lg p-3 overflow-auto max-h-20 text-sky-400 leading-relaxed whitespace-pre-wrap">
                    {currentKey.publicKey}
                  </pre>
                  <div className="flex items-center gap-3">
                    <Button
                      size="sm"
                      variant={resyncStatus === 'success' ? 'outline' : 'default'}
                      onClick={handleResync}
                      disabled={resyncUploading || resyncStatus === 'success'}
                      className="gap-2"
                    >
                      {resyncUploading ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : resyncStatus === 'success' ? (
                        <CheckCircle2 className="size-3.5 text-emerald-400" />
                      ) : (
                        <RotateCcw className="size-3.5" />
                      )}
                      {resyncUploading ? 'Uploading…' : resyncStatus === 'success' ? 'Synced with Meta' : 'Resync with Meta'}
                    </Button>
                    <CopyButton text={currentKey.publicKey} label="Copy PEM" />
                    {resyncStatus === 'error' && (
                      <p className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle className="size-3.5 shrink-0" />
                        {resyncError}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Generate button */}
          <Button onClick={handleGenerate} disabled={generating} variant={keys ? 'default' : currentKey?.hasKey ? 'outline' : 'default'} className="gap-2">
            {generating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {keys ? 'Regenerate Key Pair' : 'Generate New Key Pair'}
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
              <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="rounded bg-primary/10 p-1">
                      <FileKey2 className="size-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-800">Step 1 — Private Key</p>
                      <p className="text-xs text-slate-500">Add this line to your <code className="bg-slate-100 px-1 rounded">.env.local</code> and restart the server</p>
                    </div>
                  </div>
                  <CopyButton text={keys.envValue} label="Copy .env line" />
                </div>
                <pre className="text-[11px] bg-slate-100 rounded-lg p-3 overflow-auto max-h-24 text-emerald-400 leading-relaxed break-all whitespace-pre-wrap">
                  {keys.envValue}
                </pre>
              </div>

              {/* Step 2 — Upload public key to Meta (auto-attempted on generate) */}
              <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`rounded p-1 ${keys.uploadedToMeta ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}>
                      <ShieldCheck className={`size-4 ${keys.uploadedToMeta ? 'text-emerald-500' : 'text-amber-500'}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-800">Step 2 — Upload Public Key to Meta</p>
                      <p className="text-xs text-slate-500">
                        {keys.uploadedToMeta
                          ? 'Automatically uploaded to Meta. The webhook will use this key immediately.'
                          : 'Auto-upload failed — upload manually below.'}
                      </p>
                    </div>
                  </div>
                  <CopyButton text={keys.publicKey} label="Copy PEM" />
                </div>

                <pre className="text-[11px] bg-slate-100 rounded-lg p-3 overflow-auto max-h-24 text-sky-400 leading-relaxed whitespace-pre-wrap">
                  {keys.publicKey}
                </pre>

                {keys.uploadedToMeta ? (
                  <div className="flex items-center gap-2 text-sm text-emerald-500">
                    <CheckCircle2 className="size-4 shrink-0" />
                    Public key is live on Meta
                  </div>
                ) : (
                  <div className="space-y-2">
                    {keys.uploadError && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                        <AlertCircle className="size-3.5 shrink-0" />
                        {keys.uploadError}
                      </p>
                    )}
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
                )}
              </div>

              {/* Step 3 reminder */}
              <div className="rounded-lg bg-slate-100 border border-slate-200 p-3 flex items-start gap-2 text-sm text-slate-500">
                <CheckCircle2 className="size-4 shrink-0 mt-0.5 text-primary" />
                <span>
                  <strong className="text-slate-800">Step 3 (optional)</strong> — Save <code className="text-xs bg-slate-100 px-1 rounded">FLOWS_PRIVATE_KEY</code> to
                  your <code className="text-xs bg-slate-100 px-1 rounded">.env.local</code> as a backup.
                  The key is already active in the database — no server restart needed.
                </span>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
