'use client';

/**
 * "Read images customers send" — and, beside it, "ask them to confirm
 * what was read". See lib/ai/image-reading.ts and image-confirm.ts.
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

type State = {
  read_images: boolean;
  confirm: boolean;
  gemini_ready: boolean;
  auto_reply_enabled: boolean;
};

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

  async function save(next: { read_images: boolean; confirm: boolean }) {
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
      toast.success(next.read_images ? 'Images will be read' : 'Images will not be read');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  if (!state) return null;

  return (
    <div className="rounded-2xl bg-[#F7F8FC] p-3.5 ring-1 ring-slate-200/70">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-slate-800">Read images customers send</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">
            When a customer sends a photo — a prescription, a payment screenshot, a product, a form — the assistant reads
            its text and what it shows. Staff see the reading under the image in the Inbox, and the assistant answers
            from it.
          </p>
        </div>
        {saving ? (
          <Loader2 className="mt-1 h-4 w-4 shrink-0 animate-spin text-slate-400" />
        ) : (
          <Switch
            checked={state.read_images}
            disabled={!state.gemini_ready && !state.read_images}
            onCheckedChange={(v) => void save({ read_images: v, confirm: state.confirm })}
            aria-label="Read images customers send"
          />
        )}
      </div>

      {!state.gemini_ready && (
        <p className="mt-2 flex items-start gap-1.5 text-[11.5px] text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Needs a Gemini API key — connect Gemini above first.
        </p>
      )}

      {state.read_images && (
        <div className="mt-3 space-y-3 border-t border-slate-200/70 pt-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium text-slate-800">Ask the customer to confirm first</p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">
                The assistant says what it read, in the customer&rsquo;s language, with Yes / No buttons — and acts on
                it only after Yes. On No, it asks them to type the details or send a clearer photo. Recommended: a
                misread date, amount or medicine is worse than no answer.
              </p>
            </div>
            <Switch
              checked={state.confirm}
              disabled={saving}
              onCheckedChange={(v) => void save({ read_images: true, confirm: v })}
              aria-label="Ask the customer to confirm what was read"
            />
          </div>
          <ul className="space-y-1.5 text-[11.5px] leading-relaxed text-slate-600">
            <li className="flex items-start gap-1.5">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              Aadhaar, card and account numbers are hidden except the last four digits, before anything is stored or sent.
            </li>
            <li className="flex items-start gap-1.5">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              Text inside a photo is treated as the customer&rsquo;s data, never as instructions to the assistant.
            </li>
            <li className="flex items-start gap-1.5">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              It describes; it does not diagnose or give medical, legal or financial advice — that goes to your team.
            </li>
            <li className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              Each image is one Gemini call, shown as &ldquo;Images in&rdquo; on the Usage tab. At most five per conversation every ten minutes.
            </li>
            {!state.auto_reply_enabled && (
              <li className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                Automatic replies are off, so images are read for the Inbox only. Turn on &ldquo;Answer messages no chatbot matched&rdquo; on the Chatbots page for the assistant to reply.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
