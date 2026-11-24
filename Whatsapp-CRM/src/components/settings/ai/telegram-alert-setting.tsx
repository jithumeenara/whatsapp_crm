'use client';

/**
 * "Alert staff on Telegram" — a handover also messages the owners and
 * admins who linked Admin Chat on Telegram (lib/ai/staff-telegram.ts).
 * Telegram is free and has no 24-hour window, so unlike the WhatsApp
 * alert it needs no approved template. On by default.
 *
 * Shows counts only — who it reaches, never names or numbers — and what
 * is missing when it would reach nobody.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { apiFetch, errorText } from '@/lib/api-fetch';

type State = {
  enabled: boolean;
  admin_chat_on: boolean;
  bot_connected: boolean;
  recipients: number;
  reachable_now: number;
};

function reachText(s: State): { text: string; ok: boolean } {
  if (!s.bot_connected) return { text: 'No Telegram bot connected yet — connect one in Settings → Channels.', ok: false };
  if (!s.admin_chat_on) return { text: 'Admin Chat is off — switch it on in Settings → Admin Chat.', ok: false };
  if (s.recipients === 0) return { text: 'Nobody will get it yet — in Admin Chat, add an owner or admin on Telegram with Alerts ticked.', ok: false };
  const people = s.recipients === 1 ? '1 admin' : `${s.recipients} admins`;
  const now = s.reachable_now === s.recipients ? '' : ` (${s.reachable_now} inside their hours right now)`;
  return { text: `Goes to ${people} on Telegram${now}.`, ok: true };
}

export function TelegramAlertSetting() {
  const [state, setState] = useState<State | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setState((await (await apiFetch('/api/ai-config/telegram-alerts', { cache: 'no-store' })).json()) as State);
    } catch (err) {
      console.error('[telegram-alert-setting] load failed:', err);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function change(enabled: boolean) {
    if (saving || !state) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/ai-config/telegram-alerts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      setState((await res.json()) as State);
      toast.success(enabled ? 'Telegram alerts turned on' : 'Telegram alerts turned off');
    } catch (err) {
      console.error('[telegram-alert-setting] save failed:', err);
      toast.error(errorText(err, 'Could not save.'));
    } finally {
      setSaving(false);
    }
  }

  if (!state) return null;
  const reach = reachText(state);

  return (
    <div className="rounded-2xl bg-[#F7F8FC] p-3.5 ring-1 ring-slate-200/70">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <Send className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
          <div className="min-w-0">
            <label htmlFor="telegram-alert-switch" className="block text-[13px] font-medium text-slate-800">
              Alert staff on Telegram
            </label>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">
              The same alert, on Telegram. It is free and has no 24-hour limit, so it arrives even when a
              WhatsApp alert would need an approved template. Each admin sees only what their Admin Chat
              access allows.
            </p>
            {state.enabled && (
              <p className={`mt-1.5 text-[11.5px] leading-relaxed ${reach.ok ? 'text-emerald-700' : 'text-amber-700'}`} role="status">
                {reach.text}{' '}
                {!reach.ok && (
                  <Link
                    href={state.bot_connected ? '/settings?tab=admin-chat' : '/settings?tab=channels'}
                    className="font-medium underline underline-offset-2"
                  >
                    {state.bot_connected ? 'Open Admin Chat' : 'Open Channels'}
                  </Link>
                )}
              </p>
            )}
          </div>
        </div>
        <Switch
          id="telegram-alert-switch"
          checked={state.enabled}
          disabled={saving}
          onCheckedChange={(v) => void change(v)}
          aria-label="Alert staff on Telegram"
        />
      </div>
    </div>
  );
}
