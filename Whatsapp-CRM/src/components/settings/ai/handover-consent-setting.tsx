'use client';

/**
 * "Ask the customer before connecting them to a person" — and, beside it,
 * the three things that decide what then happens, so nobody has to guess:
 * whether chats are offered to agents, the team's working hours, and
 * whether staff get an alert. See lib/ai/handover-consent.ts.
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

type State = {
  ask_first: boolean;
  offers_enabled: boolean;
  alerts: { enabled: boolean; numbers: number; template: boolean };
  hours: string | null;
  open_now: boolean;
};

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-[12px] leading-relaxed text-slate-600">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
      ) : (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
      )}
      <span>{children}</span>
    </li>
  );
}

export function HandoverConsentSetting() {
  const [state, setState] = useState<State | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-config/handover', { cache: 'no-store' });
      if (res.ok) setState(await res.json());
    } catch {
      /* stays hidden */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(next: boolean) {
    setSaving(true);
    try {
      const res = await fetch('/api/ai-config/handover', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ask_first: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save');
      setState(data);
      toast.success(next ? 'The assistant will ask first' : 'Switched off');
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
          <p className="text-[13px] font-medium text-slate-800">Ask the customer before connecting them to a person</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">
            &ldquo;Shall I connect you to our team?&rdquo; with Yes / No buttons. On yes: staff get the alert; inside
            working hours the chat is offered to an agent and the customer is told who has them once that agent
            accepts; outside working hours they are told the hours and asked when to be called back. On no, the
            assistant carries on.
          </p>
        </div>
        {saving ? (
          <Loader2 className="mt-1 h-4 w-4 shrink-0 animate-spin text-slate-400" />
        ) : (
          <Switch checked={state.ask_first} onCheckedChange={(v) => void toggle(v)} aria-label="Ask before connecting to a person" />
        )}
      </div>

      {state.ask_first && (
        <ul className="mt-3 space-y-1.5 border-t border-slate-200/70 pt-3">
          <Check ok={state.offers_enabled}>
            {state.offers_enabled
              ? 'Chats are offered to one agent at a time — they accept or pass.'
              : 'Offering to agents is off, so a yes only marks the chat Pending. Turn on "Ring somebody when the assistant gives up" in Settings → Leads.'}
          </Check>
          <Check ok={Boolean(state.hours)}>
            {state.hours
              ? `Working hours: ${state.hours} — ${state.open_now ? 'open now' : 'closed now'}.`
              : 'No working hours set, so it counts as always open. Set them for each member in Settings → Members.'}
          </Check>
          <Check ok={state.alerts.enabled && state.alerts.numbers > 0 && state.alerts.template}>
            {!state.alerts.enabled || state.alerts.numbers === 0
              ? 'Staff alerts are off — switch on "Alert staff on WhatsApp" above and add a number.'
              : state.alerts.template
                ? `Staff alerts go to ${state.alerts.numbers} number${state.alerts.numbers === 1 ? '' : 's'}.`
                : 'Staff alerts are plain text, which only reaches a number that messaged this business in the last 24 hours. Pick an approved Utility template above.'}
          </Check>
        </ul>
      )}
    </div>
  );
}
