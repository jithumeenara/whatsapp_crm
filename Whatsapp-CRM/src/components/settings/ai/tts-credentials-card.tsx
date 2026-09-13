'use client';

/**
 * Uploading the Google Cloud key that gives the assistant better voices.
 *
 * Exists because the alternative was an environment variable on the
 * server: a feature that could only be switched on with shell access,
 * by somebody who knew the file had to be flattened to a single line
 * first. That is not a feature, it is a note in a deploy script.
 *
 * Two things it deliberately does not do:
 *
 *   - It never shows the key back. Once uploaded, the screen reports the
 *     service-account address and project so somebody can confirm the
 *     right one is loaded, and nothing more. There is no endpoint that
 *     returns it either.
 *   - It does not pretend an untested key works. Uploading runs a real
 *     synthesis call, and a key that fails is reported with the two
 *     causes worth checking rather than stored to fail quietly later.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, Loader2, CheckCircle2, AlertTriangle, Trash2, Volume2, FileJson } from 'lucide-react';
import { AiCard, AiNotice, AiButton, AiHint } from './ui-kit';
import { toast } from 'sonner';

type Status = {
  uploaded: boolean;
  client_email: string | null;
  project_id: string | null;
  verified_at: string | null;
  source: 'account' | 'environment' | 'none';
};

export function TtsCredentialsCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-config/tts-credentials');
      if (res.ok) setStatus(await res.json());
    } catch {
      /* the rest of Settings still works */
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const upload = useCallback(
    async (credentials: string) => {
      setBusy(true);
      setError('');
      setHint('');
      try {
        const res = await fetch('/api/ai-config/tts-credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credentials }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? 'That key could not be used.');
          setHint(data.hint ?? '');
          return;
        }
        toast.success('Voice key verified and saved.');
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed.');
      } finally {
        setBusy(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    },
    [load],
  );

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (!/\.json$/i.test(file.name)) {
        setError('That is not a .json file. Google Cloud downloads the key as JSON.');
        return;
      }
      void upload(await file.text());
    },
    [upload],
  );

  const remove = useCallback(async () => {
    setBusy(true);
    try {
      await fetch('/api/ai-config/tts-credentials', { method: 'DELETE' });
      toast.success('Voice key removed. Replies use the built-in voice again.');
      await load();
    } finally {
      setBusy(false);
    }
  }, [load]);

  if (!status) return null;

  const usingAccountKey = status.source === 'account';
  const usingServerKey = status.source === 'environment';

  return (
    <AiCard className="p-4">
      <div className="mb-3 flex items-start gap-2.5">
        <span
          className={[
            'grid h-8 w-8 shrink-0 place-items-center rounded-xl',
            usingAccountKey || usingServerKey ? 'bg-emerald-50 text-emerald-600' : 'bg-[#F5F6FA] text-slate-400',
          ].join(' ')}
        >
          <Volume2 className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-slate-900">Better voices</span>
          <span className="block text-[11.5px] leading-relaxed text-slate-500">
            {usingAccountKey
              ? 'Using your Google Cloud key — native Malayalam and Tamil voices, about a second per reply.'
              : usingServerKey
                ? 'Using the key configured on this server.'
                : 'Add a Google Cloud key for native Malayalam and Tamil voices, replies in about a second instead of eight, and true voice notes instead of audio files.'}
          </span>
        </span>
      </div>

      {usingAccountKey && (
        <div className="mb-3 rounded-xl bg-[#F7F8FC] p-2.5 ring-1 ring-slate-200/70">
          <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            Verified{status.verified_at ? ` on ${new Date(status.verified_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
          </p>
          {/* Identity only. The key itself is never returned by the API. */}
          <p className="mt-1 break-all font-mono text-[10.5px] text-slate-500">{status.client_email}</p>
          {status.project_id && (
            <p className="break-all font-mono text-[10.5px] text-slate-400">project: {status.project_id}</p>
          )}
        </div>
      )}

      {error && (
        <div className="mb-3">
          <AiNotice tone="error" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
            <span className="block">{error}</span>
            {hint && <span className="mt-1 block text-[11px] opacity-90">{hint}</span>}
          </AiNotice>
        </div>
      )}

      <input
        ref={fileRef}
        id="tts-credentials-file"
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />

      <div className="flex flex-wrap gap-2">
        <AiButton onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {busy ? 'Checking…' : usingAccountKey ? 'Replace key' : 'Upload key'}
        </AiButton>
        {usingAccountKey && (
          <AiButton tone="outline" onClick={() => void remove()} disabled={busy}>
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </AiButton>
        )}
      </div>

      {!usingAccountKey && (
        <div className="mt-3">
          <AiHint>
            <span className="mb-1 flex items-center gap-1.5 font-medium text-slate-600">
              <FileJson className="h-3 w-3" />
              Where to get the file
            </span>
            Google Cloud Console → enable the <strong>Text-to-Speech API</strong> → IAM &amp; Admin → Service
            Accounts → create one with the <strong>Cloud Text-to-Speech User</strong> role → Keys → Add key →
            JSON. Upload that file here, exactly as downloaded.
          </AiHint>
        </div>
      )}

      <p className="mt-2.5 text-[10.5px] leading-relaxed text-slate-400">
        Stored encrypted and never shown again. Without a key the assistant still speaks, using the built-in
        voice.
      </p>
    </AiCard>
  );
}
