'use client';

/**
 * "Read images and files customers send" — a switch for each, and beside
 * them "ask the customer to confirm what was read". See
 * lib/ai/image-reading.ts and image-confirm.ts.
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, FileText, Image as ImageIcon, Loader2, ShieldCheck } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

type Settings = { read_images: boolean; read_files: boolean; confirm: boolean };
type State = Settings & { gemini_ready: boolean; auto_reply_enabled: boolean };

function Row({
  id,
  icon,
  title,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-slate-500">{icon}</span>
        <div className="min-w-0">
          <label htmlFor={id} className="block text-[12.5px] font-medium text-slate-800">
            {title}
          </label>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">{hint}</p>
        </div>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}

export function ImageReadingSetting() {
  const [state, setState] = useState<State | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-config/image-reading', { cache: 'no-store' });
      if (res.ok) setState(await res.json());
    } catch {
      /* stays hidden */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(patch: Partial<Settings>, done: string) {
    if (!state) return;
    const next: Settings = {
      read_images: state.read_images,
      read_files: state.read_files,
      confirm: state.confirm,
      ...patch,
    };
    setSaving(true);
    try {
      const res = await fetch('/api/ai-config/image-reading', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save');
      setState(data);
      toast.success(done);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  if (!state) return null;
  const anyOn = state.read_images || state.read_files;
  // Never block switching something off; only switching on needs a key.
  const lockOn = !state.gemini_ready;

  return (
    <div className="rounded-2xl bg-[#F7F8FC] p-3.5 ring-1 ring-slate-200/70">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-slate-800">Read images and files customers send</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">
            The assistant reads what a customer sends — a prescription, a payment screenshot, an invoice, a form — and
            answers from it. Staff see what was read under the message in the Inbox. Each is switched on separately.
          </p>
        </div>
        {saving && <Loader2 className="mt-1 h-4 w-4 shrink-0 animate-spin text-slate-400" />}
      </div>

      <div className="mt-3 space-y-3 border-t border-slate-200/70 pt-3">
        <Row
          id="ai-read-images"
          icon={<ImageIcon className="h-4 w-4" />}
          title="Images"
          hint="Photos and screenshots — and a photo sent as a file."
          checked={state.read_images}
          disabled={saving || (lockOn && !state.read_images)}
          onChange={(v) => void save({ read_images: v }, v ? 'Images will be read' : 'Images will not be read')}
        />
        <Row
          id="ai-read-files"
          icon={<FileText className="h-4 w-4" />}
          title="Files (PDF)"
          hint="PDF and text files. Word and Excel files cannot be read by Gemini, so they stay for your team."
          checked={state.read_files}
          disabled={saving || (lockOn && !state.read_files)}
          onChange={(v) => void save({ read_files: v }, v ? 'Files will be read' : 'Files will not be read')}
        />
        {anyOn && (
          <Row
            id="ai-read-confirm"
            icon={<ShieldCheck className="h-4 w-4" />}
            title="Ask the customer to confirm first"
            hint="Says what was read, in the customer's language, with Yes / No buttons — and acts on it only after Yes. On No, asks them to type the details or send it again. Recommended: a misread date, amount or medicine is worse than no answer."
            checked={state.confirm}
            disabled={saving}
            onChange={(v) => void save({ confirm: v }, v ? 'The assistant will ask first' : 'The assistant will answer directly')}
          />
        )}
      </div>

      {lockOn && (
        <p className="mt-3 flex items-start gap-1.5 text-[11.5px] text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Needs a Gemini API key — connect Gemini above first.
        </p>
      )}

      {anyOn && (
        <ul className="mt-3 space-y-1.5 border-t border-slate-200/70 pt-3 text-[11.5px] leading-relaxed text-slate-600">
          <li className="flex items-start gap-1.5">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            Aadhaar, card and account numbers are hidden except the last four digits, before anything is stored or sent.
          </li>
          <li className="flex items-start gap-1.5">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            Text inside an image or file is treated as the customer&rsquo;s data, never as instructions to the assistant.
          </li>
          <li className="flex items-start gap-1.5">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            It describes; it does not diagnose or give medical, legal or financial advice — that goes to your team.
          </li>
          <li className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            Each is one Gemini call — &ldquo;Images in&rdquo; and &ldquo;Files in&rdquo; on the Usage tab. A long PDF costs more (every page counts); files over 10 MB are not read. At most five per conversation every ten minutes.
          </li>
          {!state.auto_reply_enabled && (
            <li className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              Automatic replies are off, so these are read for the Inbox only. Turn on &ldquo;Answer messages no chatbot matched&rdquo; on the Chatbots page for the assistant to reply.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
