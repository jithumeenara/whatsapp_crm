'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ShieldCheck, BellOff, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/use-auth';
import { apiFetch, errorText } from '@/lib/api-fetch';

interface Settings {
  frequency_cap_enabled: boolean;
  frequency_cap_count: number;
  frequency_cap_days: number;
  stop_keywords_enabled: boolean;
  auto_retry_daily_limit: boolean;
}

/**
 * Broadcasts → Rules: the account's sending rules. Read by everyone with
 * the page; changed by an owner or admin (the API enforces it too).
 */
export function BroadcastRules() {
  const { accountRole } = useAuth();
  const canEdit = accountRole === 'owner' || accountRole === 'admin';
  const [saved, setSaved] = useState<Settings | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    apiFetch('/api/broadcasts/settings')
      .then((r) => r.json())
      .then((d: { settings: Settings }) => { if (live) { setSaved(d.settings); setForm(d.settings); } })
      .catch((err) => {
        console.error('[broadcasts] rules failed to load:', err);
        if (live) setError(errorText(err, 'Could not load the rules.'));
      });
    return () => { live = false; };
  }, []);

  if (error) return <p className="rounded-xl border border-slate-200 bg-white p-5 text-[13px] text-rose-700">{error}</p>;
  if (!form || !saved) return <div className="h-64 animate-pulse rounded-xl bg-white" aria-hidden />;

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  async function save() {
    if (!form || saving) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/broadcasts/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const d = (await res.json()) as { settings: Settings };
      setSaved(d.settings);
      setForm(d.settings);
      toast.success('Rules saved');
    } catch (err) {
      console.error('[broadcasts] rules save failed:', err);
      toast.error(errorText(err, 'Could not save the rules'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      {!canEdit && (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-[12px] text-slate-600">Only an owner or admin can change these rules.</p>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[14px] font-semibold text-slate-800">Limit offers per person</h3>
              <Switch checked={form.frequency_cap_enabled} disabled={!canEdit} onCheckedChange={(v) => set('frequency_cap_enabled', !!v)} aria-label="Limit offers per person" />
            </div>
            <p className="mt-1 text-[12.5px] text-slate-500">
              Nobody gets more than this many marketing broadcasts in this many days. Extra sends are marked “Left out”, not sent. Reminders and other non-marketing templates are never limited.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="cap-count">Messages</Label>
                <Input id="cap-count" name="cap-count" type="number" inputMode="numeric" min={1} max={50} className="w-24" autoComplete="off"
                  value={form.frequency_cap_count} disabled={!canEdit || !form.frequency_cap_enabled}
                  onChange={(e) => set('frequency_cap_count', Number(e.target.value))} />
              </div>
              <span className="pb-2 text-[13px] text-slate-500">in</span>
              <div className="space-y-1">
                <Label htmlFor="cap-days">Days</Label>
                <Input id="cap-days" name="cap-days" type="number" inputMode="numeric" min={1} max={90} className="w-24" autoComplete="off"
                  value={form.frequency_cap_days} disabled={!canEdit || !form.frequency_cap_enabled}
                  onChange={(e) => set('frequency_cap_days', Number(e.target.value))} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <BellOff className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[14px] font-semibold text-slate-800">STOP and START replies</h3>
              <Switch checked={form.stop_keywords_enabled} disabled={!canEdit} onCheckedChange={(v) => set('stop_keywords_enabled', !!v)} aria-label="STOP and START replies" />
            </div>
            <p className="mt-1 text-[12.5px] text-slate-500">
              A customer who sends just “STOP” (or “Unsubscribe”, “നിർത്തുക”, “बंद करो” and similar) stops getting broadcasts and gets one confirmation. “START” brings them back. They can still chat with you. WhatsApp’s own “Stop promotions” button always works, whatever this is set to.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[14px] font-semibold text-slate-800">Retry WhatsApp’s daily limit</h3>
              <Switch checked={form.auto_retry_daily_limit} disabled={!canEdit} onCheckedChange={(v) => set('auto_retry_daily_limit', !!v)} aria-label="Retry WhatsApp’s daily limit" />
            </div>
            <p className="mt-1 text-[12.5px] text-slate-500">
              When WhatsApp holds a marketing message back because that person already got enough from businesses today, try once more a day later. Never more than once.
            </p>
          </div>
        </div>
      </section>

      {canEdit && dirty && (
        <div className="flex items-center justify-end gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <span className="mr-auto text-[12.5px] text-slate-500">Unsaved changes</span>
          <Button variant="outline" onClick={() => setForm(saved)} disabled={saving}>Discard</Button>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="animate-spin" aria-hidden />} Save changes</Button>
        </div>
      )}
    </div>
  );
}
