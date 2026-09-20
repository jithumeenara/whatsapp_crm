'use client'

/**
 * The Flows encryption key, and what state it is actually in.
 *
 * Two columns, because the panel answers two different questions that
 * used to be stacked into one long scroll: *what is the state of my key*
 * (left — one glance, always in the same place) and *what do I do with
 * it* (right — the key material and the steps). On a phone there is no
 * room for that, so the columns become rows in the same order, and the
 * state you need to read first is still first.
 *
 * Two things were wrong with the version before this and both mattered
 * more than they looked.
 *
 * It had no height limit, so once a key pair was generated the two PEM
 * blocks pushed it past the viewport and the browser clipped it at both
 * ends — the private key you were told to save now sat above the top of
 * the screen. Header and footer are pinned here; only the middle scrolls.
 *
 * And it had two states where there are three. "Active" and "none" are
 * not the whole story: a key can be stored and unreadable, which looks
 * identical to "none" and is made permanently worse by the thing the
 * dialog then invites you to do. That case is its own state now — red,
 * with Generate demoted out of the way.
 */

import { useCallback, useEffect, useState } from 'react'
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
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  RotateCcw,
  ShieldAlert,
  ArrowRight,
  Lock,
} from 'lucide-react'
import { toast } from 'sonner'

interface Keys {
  privateKey: string
  publicKey: string
  envValue: string
  /** Whether the private half was written AND read back. Only then is
   *  the pair usable; the server refuses to tell Meta about it if not. */
  stored: boolean
  storeError?: string
  uploadedToMeta: boolean
  uploadError?: string
}

interface CurrentKeyStatus {
  hasKey: boolean
  /** A key exists but this server cannot use it. Distinct from !hasKey,
   *  because generating fixes the one and worsens the other. */
  broken?: boolean
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
    <Button variant="ghost" size="sm" onClick={copy} className="h-7 shrink-0 gap-1.5 text-xs">
      {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
      {label ?? (copied ? 'Copied!' : 'Copy')}
    </Button>
  )
}

/** The revealed private key. Capped and scrollable — a 2048-bit key is
 *  25 lines, and letting it set the dialog's height is what clipped it
 *  before.
 *
 *  Only ever the private half now. The public one is not printed at
 *  all: the fingerprint is what anybody compares, and the key itself is
 *  only ever pasted, so a copy button is the whole of what it is for. */
function PemBlock({ text }: { text: string }) {
  return (
    <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5 text-[10.5px] leading-relaxed text-emerald-800">
      {text}
    </pre>
  )
}

/**
 * The private key, not shown.
 *
 * A secret on screen is a secret in a screenshot, in a screen share and
 * over a shoulder — and this dialog is opened precisely when somebody
 * is being helped with a problem, which is when other people are
 * looking. It was printed in full.
 *
 * Copying does not require reading, so the button works on the hidden
 * text and is the ordinary path. Revealing stays possible because one
 * real case needs it — pasting the line into a file by hand on a server
 * — but it takes a deliberate click, and the warning says what that
 * click costs.
 */
function SecretBlock({ text }: { text: string }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <div className="space-y-1.5">
      {revealed ? (
        <PemBlock text={text} />
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-2.5 py-3">
          <Lock className="size-3.5 shrink-0 text-emerald-600" />
          <span className="font-mono text-[11px] tracking-[0.2em] text-emerald-700">
            ••••••••••••••••••••••••
          </span>
        </div>
      )}
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        className="text-[11px] font-medium text-slate-500 underline underline-offset-2 hover:text-slate-700"
      >
        {revealed ? 'Hide it again' : 'Show it (only if nobody is watching)'}
      </button>
    </div>
  )
}

function StepCard({
  n,
  title,
  note,
  action,
  children,
}: {
  n: number
  title: string
  note: string
  action?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-200 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10.5px] font-semibold text-slate-600">
            {n}
          </span>
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold text-slate-800">{title}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{note}</p>
          </div>
        </div>
        {action}
      </div>
      {children && <div className="mt-2.5 space-y-2">{children}</div>}
    </section>
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

  const loadStatus = useCallback(() => {
    setCurrentKey(null)
    fetch('/api/flows/keys')
      // The endpoint answers with a body on every outcome, including its
      // error ones — a non-2xx here carries the reason, so it is read
      // rather than thrown away.
      .then((r) => r.json())
      .then((b: CurrentKeyStatus) => setCurrentKey(b))
      .catch(() => setCurrentKey({ hasKey: false, error: 'Could not reach the server.' }))
  }, [])

  useEffect(() => {
    if (!open) return
    setKeys(null)
    setResyncStatus('idle')
    setResyncError(null)
    loadStatus()
  }, [open, loadStatus])

  const handleGenerate = async () => {
    setGenerating(true)
    setKeys(null)
    setUploadStatus('idle')
    setUploadError(null)
    try {
      const res = await fetch('/api/flows/keys', { method: 'POST' })
      const body = (await res.json()) as Keys & { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Key generation failed')
      setKeys(body)
      if (body.stored) toast.success('Key pair generated and saved.')
      else toast.error('Generated, but it could not be saved on the server.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate keys')
    } finally {
      setGenerating(false)
    }
  }

  const uploadKey = async (
    publicKey: string,
    opts: {
      setUploading: (v: boolean) => void
      setStatus: (v: 'idle' | 'success' | 'error') => void
      setError: (v: string | null) => void
    },
  ) => {
    opts.setUploading(true)
    opts.setStatus('idle')
    opts.setError(null)
    try {
      const res = await fetch('/api/flows/keys/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey }),
      })
      const body = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Upload failed')
      opts.setStatus('success')
      toast.success('Public key uploaded to Meta.')
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
      setUploading,
      setStatus: setUploadStatus,
      setError: setUploadError,
    })

  const handleResync = () =>
    uploadKey(currentKey!.publicKey!, {
      setUploading: setResyncUploading,
      setStatus: setResyncStatus,
      setError: setResyncError,
    })

  const healthy = Boolean(currentKey?.hasKey && !currentKey?.broken)
  const broken = Boolean(currentKey?.broken)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The height cap plus header/body/footer rows are what stop the
          content growing past the viewport and being clipped at both ends. */}
      <DialogContent className="grid max-h-[90dvh] w-full grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden bg-white p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-slate-100 px-4 py-3 text-left sm:px-5 sm:py-4">
          <DialogTitle className="flex items-center gap-2 pr-8 text-[15px]">
            <KeyRound className="size-4 shrink-0 text-indigo-500" />
            Flows Encryption Key
          </DialogTitle>
          <DialogDescription className="text-[12px] leading-relaxed">
            Meta encrypts every Flow request with your public key; this server decrypts it with
            the private half. They must be the same pair, or Flows open blank on the phone.
          </DialogDescription>
        </DialogHeader>

        {/* One column, always.

            Two columns put a short status card beside a tall block of
            advice, so one side ran out and left a column of nothing
            next to it. Reading order is the same either way — what the
            key is doing now, then what to do about it — and in a single
            column that order is the layout rather than something the
            layout has to survive. */}
        <div className="min-h-0 overflow-y-auto">
          <aside className="space-y-3 border-b border-slate-100 px-4 py-4 sm:px-5">
            {!currentKey && !keys && (
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 p-3.5 text-[12.5px] text-slate-500">
                <Loader2 className="size-4 shrink-0 animate-spin" />
                Checking this server&rsquo;s key…
              </div>
            )}

            {currentKey && (
              <div
                className={`space-y-3 rounded-xl border p-3.5 ${
                  broken
                    ? 'border-rose-200 bg-rose-50/60'
                    : healthy
                      ? 'border-emerald-200 bg-emerald-50/50'
                      : 'border-amber-200 bg-amber-50/50'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  {broken ? (
                    <ShieldAlert className="mt-0.5 size-4 shrink-0 text-rose-500" />
                  ) : healthy ? (
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  ) : (
                    <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  )}
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800">
                      {broken ? 'Stored, but unusable' : healthy ? 'Key active' : 'No key yet'}
                    </p>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-600">
                      {currentKey.error
                        ? currentKey.error
                        : healthy
                          ? `Read from ${currentKey.source === 'db' ? 'the database — no restart needed' : 'the FLOWS_PRIVATE_KEY environment variable'}.`
                          : 'Generate a pair to turn on Flow encryption.'}
                    </p>
                  </div>
                </div>

                {healthy && currentKey.fingerprint && (
                  <div className="rounded-lg bg-white/70 px-2.5 py-2">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                      Fingerprint
                    </p>
                    <p className="mt-0.5 break-all font-mono text-[10px] leading-relaxed text-slate-600">
                      {currentKey.fingerprint}
                    </p>
                  </div>
                )}

                {broken && (
                  <p className="rounded-lg bg-white/70 px-2.5 py-2 text-[11px] leading-relaxed text-rose-800">
                    Generating will <strong>not</strong> repair this — it replaces the key Meta
                    holds and every published Flow stops until the new one is live. Fix the cause
                    above first.
                  </p>
                )}

                {healthy && currentKey.publicKey && (
                  <div className="space-y-2">
                    <Button
                      size="sm"
                      variant={resyncStatus === 'success' ? 'outline' : 'default'}
                      onClick={handleResync}
                      disabled={resyncUploading || resyncStatus === 'success'}
                      className="w-full gap-2"
                    >
                      {resyncUploading ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : resyncStatus === 'success' ? (
                        <CheckCircle2 className="size-3.5 text-emerald-500" />
                      ) : (
                        <RotateCcw className="size-3.5" />
                      )}
                      {resyncUploading
                        ? 'Uploading…'
                        : resyncStatus === 'success'
                          ? 'Synced with Meta'
                          : 'Resync with Meta'}
                    </Button>
                    <p className="text-[10.5px] leading-relaxed text-slate-500">
                      Re-uploads <em>this same</em> key. The safe repair — nothing that already
                      works stops working.
                    </p>
                    {resyncStatus === 'error' && (
                      <p className="flex items-start gap-1.5 text-[11px] text-rose-600">
                        <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                        {resyncError}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* The public half is not a secret — Meta holds a copy and
                is meant to. But nobody reads a PEM, and twenty-five
                lines of base64 is twenty-five lines of nothing on a
                screen somebody opened to answer one question.

                The fingerprint above already answers it: that is the
                value to compare with what Meta shows, and it is short
                enough to read down a phone line. The key itself is only
                ever pasted somewhere, so a copy button is the whole of
                what it is for. */}
            {healthy && currentKey?.publicKey && !keys && (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-white/70 px-2.5 py-2">
                <p className="text-[11px] font-medium text-slate-600">Public key in use</p>
                <CopyButton text={currentKey.publicKey} label="Copy PEM" />
              </div>
            )}
          </aside>

          <div className="min-h-0 space-y-3 px-4 py-4 sm:px-5">
            {!keys && (
              <>
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                  <p className="text-[12.5px] font-semibold text-slate-800">
                    When a Flow opens blank
                  </p>
                  <ol className="mt-2 space-y-2 text-[11.5px] leading-relaxed text-slate-600">
                    <li className="flex gap-2">
                      <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-slate-400" />
                      <span>
                        <strong className="text-slate-700">Resync first.</strong> Nine times in
                        ten the key here is fine and Meta is simply holding an older one.
                      </span>
                    </li>
                    <li className="flex gap-2">
                      <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-slate-400" />
                      <span>
                        <strong className="text-slate-700">Then test the Flow.</strong> The key
                        belongs to the WhatsApp number, not to each Flow, so a resync usually
                        fixes every Flow at once without republishing.
                      </span>
                    </li>
                    <li className="flex gap-2">
                      <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-slate-400" />
                      <span>
                        <strong className="text-slate-700">Generate only as a last resort.</strong>{' '}
                        It replaces the key Meta holds. Every Flow stops working until the new key
                        is live, and any Flow that still fails afterwards needs republishing.
                      </span>
                    </li>
                  </ol>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-400">
                  The private key is stored encrypted against your WhatsApp number and read from
                  there, so the webhook picks up a new one without a restart. It is kept in one
                  place on purpose — a secret held in two has two chances to leak and two versions
                  to disagree.
                </p>
              </>
            )}

            {keys && (
              <>
                {keys.stored ? (
                  <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-[12px] leading-relaxed text-emerald-900">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    <span>
                      <strong>Saved on this server and read back.</strong> The webhook is using it
                      now — no restart needed.
                    </span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50/70 p-3 text-[12px] leading-relaxed text-rose-900">
                    <ShieldAlert className="mt-0.5 size-4 shrink-0 text-rose-600" />
                    <span>
                      <strong>Not saved on this server.</strong> {keys.storeError} Nothing was
                      sent to Meta, so your existing Flows are untouched.
                    </span>
                  </div>
                )}

                {/* The key lives in the database and nowhere else.

                    The webhook reads it from there, encrypted against
                    this WhatsApp number, and picks up a new one without
                    a restart. An .env copy was only ever a fallback for
                    the case below — and a secret kept in two places is a
                    secret with two chances to leak and two versions to
                    disagree.

                    So when the save worked there is nothing here to
                    copy, nothing to paste and nothing to lose. Saying
                    "copy this now or lose it" when neither is true is
                    how a warning stops being read. */}
                {keys.stored ? (
                  <StepCard n={1} title="Private key" note="Kept in the database on this server.">
                    <p className="text-[12px] leading-relaxed text-slate-600">
                      Nothing to copy and nothing to save. It is encrypted against your WhatsApp
                      number and the webhook is already using it.
                    </p>
                  </StepCard>
                ) : (
                  <>
                    <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-[12px] leading-relaxed text-amber-900">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                      <span>
                        <strong>Copy the private key now.</strong> The server could not keep it,
                        so this is the only copy that will ever exist. It stays hidden on screen —
                        copying does not need it shown.
                      </span>
                    </div>

                    <StepCard
                      n={1}
                      title="Private key"
                      note="Put this in .env.local and restart, until the database problem above is fixed."
                      action={<CopyButton text={keys.envValue} label="Copy .env line" />}
                    >
                      <SecretBlock text={keys.envValue} />
                    </StepCard>
                  </>
                )}

                <StepCard
                  n={2}
                  title="Public key at Meta"
                  note={
                    keys.uploadedToMeta
                      ? 'Uploaded. Meta encrypts with this key from the next request.'
                      : 'Not uploaded yet.'
                  }
                  action={<CopyButton text={keys.publicKey} label="Copy PEM" />}
                >
                  {/* Same reasoning as the key in use above: uploaded
                      for you, and copyable if you ever have to do it by
                      hand. Printing it helps nobody. */}
                  {keys.uploadedToMeta ? (
                    <p className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-700">
                      <CheckCircle2 className="size-4 shrink-0" />
                      Live on Meta
                    </p>
                  ) : (
                    <>
                      {keys.uploadError && (
                        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-700">
                          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                          {keys.uploadError}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          onClick={handleUploadToMeta}
                          disabled={uploading || uploadStatus === 'success'}
                          variant={uploadStatus === 'success' ? 'outline' : 'default'}
                          className="gap-2"
                        >
                          {uploading ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : uploadStatus === 'success' ? (
                            <CheckCircle2 className="size-3.5 text-emerald-500" />
                          ) : (
                            <Upload className="size-3.5" />
                          )}
                          {uploading
                            ? 'Uploading…'
                            : uploadStatus === 'success'
                              ? 'Uploaded'
                              : 'Upload to Meta'}
                        </Button>
                        {uploadStatus === 'error' && (
                          <p className="flex items-start gap-1.5 text-[11px] text-rose-600">
                            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                            {uploadError}
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </StepCard>

                <StepCard
                  n={3}
                  title="Test a Flow"
                  note="The key belongs to the number rather than to each Flow, so this is usually all that was needed. Republish only a Flow that still fails."
                />
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-100 bg-slate-50/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="min-w-0 text-[10.5px] leading-relaxed text-slate-500">
            {broken
              ? 'Fix the stored key before generating — see the panel.'
              : healthy
                ? 'Generating replaces the key Meta holds. Published Flows stop until the new one is live.'
                : 'RSA-2048, stored encrypted on this server.'}
          </p>
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={generating}
            variant={healthy || broken ? 'outline' : 'default'}
            className="shrink-0 gap-2 max-sm:w-full"
          >
            {generating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {generating
              ? 'Generating…'
              : healthy || broken
                ? 'Regenerate anyway'
                : 'Generate key pair'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
