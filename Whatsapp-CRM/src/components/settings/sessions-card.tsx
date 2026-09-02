'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, LogOut, ShieldAlert, Monitor, Smartphone, MoreVertical, Settings, Clock } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmIconDialog } from '@/components/ui/confirm-icon-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface SessionRow {
  id: string;
  device_label: string;
  ip_address: string | null;
  created_at: string;
  last_seen_at: string;
  isCurrent: boolean;
}

type TimeUnit = 'minutes' | 'hours' | 'days';
const UNIT_MINUTES: Record<TimeUnit, number> = { minutes: 1, hours: 60, days: 1440 };

/** Picks the largest whole unit that divides evenly, so 4320 minutes
 *  shows as "3 days" instead of "4320 minutes". */
function minutesToDisplay(totalMinutes: number): { value: number; unit: TimeUnit } {
  if (totalMinutes % 1440 === 0) return { value: totalMinutes / 1440, unit: 'days' };
  if (totalMinutes % 60 === 0) return { value: totalMinutes / 60, unit: 'hours' };
  return { value: totalMinutes, unit: 'minutes' };
}

function isMobileLabel(label: string) {
  return /Android|iOS/.test(label);
}

// Matches the jwt callback's own throttle window in auth.ts — a session
// whose last_seen_at falls inside that window really is live right now
// (or was, within the last heartbeat), not just "recently active".
const LIVE_THRESHOLD_MS = 5 * 60_000;

function activityStatus(iso: string): { live: boolean; label: string } {
  const then = new Date(iso).getTime();
  if (Date.now() - then < LIVE_THRESHOLD_MS) return { live: true, label: 'Live' };
  const label = new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
  return { live: false, label: `Last active ${label}` };
}

/** Gear-icon dialog — lets the user pick their own inactivity
 *  auto-logout duration (Settings > Profile > Sessions), instead of the
 *  fixed 3-day default. Value + unit, converted to minutes on save
 *  (that's what's actually stored and enforced server-side). */
function TimeoutSettingsDialog({ open, onOpenChange, onSaved }: {
  open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState(3);
  const [unit, setUnit] = useState<TimeUnit>('days');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch('/api/account/session-settings')
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.limitMinutes === 'number') {
          const d = minutesToDisplay(data.limitMinutes);
          setValue(d.value);
          setUnit(d.unit);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  async function save() {
    const limitMinutes = Math.round(value * UNIT_MINUTES[unit]);
    setSaving(true);
    try {
      const res = await fetch('/api/account/session-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limitMinutes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || 'Failed to save'); return; }
      toast.success('Auto-logout timeout updated');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader className="sr-only">
          <DialogTitle>Auto-logout timeout</DialogTitle>
          <DialogDescription>Choose how long a device can be inactive before it&apos;s signed out automatically.</DialogDescription>
        </DialogHeader>

        <div className="flex justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#EEF0FF]">
            <Clock className="h-6 w-6 text-[#5B6CF9]" />
          </span>
        </div>
        <h2 className="text-center text-[15px] font-semibold text-slate-900 mt-3">Auto-logout timeout</h2>
        <p className="text-center text-[12.5px] text-slate-500 mt-1 mb-5">
          A device with no activity for longer than this is signed out automatically.
        </p>

        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label className="text-[13px] font-medium text-slate-700">Log out after</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                value={value}
                onChange={(e) => setValue(Math.max(1, Number(e.target.value) || 1))}
                className="h-10 w-24 text-[13px] border-slate-200 focus:border-[#5B6CF9] focus:ring-[#5B6CF9]/20"
              />
              <div className="flex flex-1 rounded-xl border border-slate-200 p-1">
                {(['minutes', 'hours', 'days'] as TimeUnit[]).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setUnit(u)}
                    className={`flex-1 rounded-lg py-1.5 text-[12.5px] font-medium capitalize transition-colors ${
                      unit === u ? 'bg-[#5B6CF9] text-white' : 'text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-slate-400">Between 5 minutes and 90 days.</p>
          </div>
        )}

        <div className="flex gap-2 mt-5">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="flex-1 h-9 text-[13px] border-slate-200">
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || loading} className="flex-1 h-9 text-[13px] bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Real per-device session list, backed by UserSession (one row per
 * device — see auth.ts). Each row's "Log out" actually revokes that one
 * device via DELETE /api/account/sessions/[id], forcing its next request
 * to be rejected — not a cosmetic list. Refetches every 30s so "Live" /
 * last-active timestamps and the list itself stay current without
 * needing a manual page reload.
 */
export function SessionsCard() {
  const { signOut, profile } = useAuth();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [everywhereOpen, setEverywhereOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<SessionRow | null>(null);
  const [timeoutSettingsOpen, setTimeoutSettingsOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signingOutEverywhere, setSigningOutEverywhere] = useState(false);
  const [revoking, setRevoking] = useState(false);

  async function loadSessions() {
    setLoadError(null);
    try {
      const res = await fetch('/api/account/sessions');
      const data = await res.json().catch(() => ({}));
      // A failure here must still stop the loading spinner — leaving
      // `sessions` at null forever (as this used to) spins indefinitely
      // with no feedback, which is what was reported as "not working".
      if (!res.ok) { setLoadError(data.error || 'Failed to load sessions'); setSessions([]); return; }
      setSessions(data.sessions ?? []);
    } catch {
      setLoadError('Failed to load sessions — check your connection');
      setSessions([]);
    }
  }

  useEffect(() => {
    loadSessions();
    const interval = setInterval(loadSessions, 30_000);
    return () => clearInterval(interval);
  }, []);

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSigningOut(false);
    }
  };

  const onSignOutEverywhere = async () => {
    setSigningOutEverywhere(true);
    try {
      const res = await fetch('/api/account/sign-out-everywhere', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || 'Failed to sign out everywhere'); return; }
      toast.success('Signed out everywhere');
      await signOut();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSigningOutEverywhere(false);
    }
  };

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const res = await fetch(`/api/account/sessions/${revokeTarget.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || 'Failed to log out that session'); return; }
      if (data.wasCurrent) {
        toast.success('Signed out');
        await signOut();
        return;
      }
      toast.success(`Logged out ${revokeTarget.device_label}`);
      setSessions((prev) => prev?.filter((s) => s.id !== revokeTarget.id) ?? null);
      setRevokeTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setRevoking(false);
    }
  }

  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-start gap-3 px-6 py-4 border-b border-slate-100">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFF0F3]">
            <LogOut className="h-4.5 w-4.5 text-[#E11D48]" />
          </span>
          <div className="flex-1 min-w-0">
            <h3 className="text-[14px] font-semibold text-slate-800">Sessions</h3>
            <p className="text-[12px] text-slate-500 mt-0.5">Manage your active sessions on different devices.</p>
          </div>
          <button
            type="button"
            title="Auto-logout timeout settings"
            onClick={() => setTimeoutSettingsOpen(true)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>

        {sessions === null ? (
          <div className="flex items-center justify-center py-6 border-b border-slate-100">
            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {sessions.map((s) => {
              const DeviceIcon = isMobileLabel(s.device_label) ? Smartphone : Monitor;
              const status = activityStatus(s.last_seen_at);
              return (
                <div key={s.id} className="flex items-center gap-3 px-6 py-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100">
                    <DeviceIcon className="h-4 w-4 text-slate-500" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800 flex items-center gap-2">
                      {s.device_label}
                      {s.isCurrent && (
                        <span className="rounded-full bg-[#EEF0FF] px-2 py-0.5 text-[10.5px] font-semibold text-[#5B6CF9]">
                          Current session
                        </span>
                      )}
                    </p>
                    <p className="text-[11.5px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                      {status.live ? (
                        <span className="flex items-center gap-1 font-medium text-emerald-600">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Live
                        </span>
                      ) : (
                        status.label
                      )}
                      {profile?.email && s.isCurrent && ` • ${profile.email}`}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      title="Session options"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors data-[popup-open]:bg-slate-100 data-[popup-open]:text-slate-600"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[190px]">
                      <DropdownMenuItem onClick={() => setRevokeTarget(s)} variant="destructive" className="whitespace-nowrap">
                        <LogOut className="h-3.5 w-3.5" />
                        Log out
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
            {sessions.length === 0 && loadError && (
              <div className="flex items-center justify-between gap-3 px-6 py-4">
                <p className="text-[12.5px] text-rose-500">{loadError}</p>
                <button type="button" onClick={loadSessions} className="text-[12px] font-medium text-[#5B6CF9] hover:text-[#4a5ce8] shrink-0">
                  Retry
                </button>
              </div>
            )}
            {sessions.length === 0 && !loadError && (
              <p className="px-6 py-4 text-[12.5px] text-slate-400">No active sessions found.</p>
            )}
          </div>
        )}

        <div className="px-6 py-5 flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setSignOutOpen(true)} className="h-9 text-[13px] border-slate-200">
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
          <Button type="button" variant="outline" onClick={() => setEverywhereOpen(true)}
            className="h-9 text-[13px] text-rose-600 border-rose-200 hover:bg-rose-50 hover:text-rose-700">
            <ShieldAlert className="h-4 w-4" />
            Sign out everywhere
          </Button>
        </div>
      </div>

      <TimeoutSettingsDialog
        open={timeoutSettingsOpen}
        onOpenChange={setTimeoutSettingsOpen}
        onSaved={loadSessions}
      />

      <ConfirmIconDialog
        open={signOutOpen}
        onOpenChange={setSignOutOpen}
        icon={LogOut}
        tone="info"
        title="Sign out?"
        description="You'll be signed out of this browser and redirected to the login page."
        actionLabel="Sign out"
        actionPendingLabel="Signing out…"
        onConfirm={onSignOut}
        pending={signingOut}
      />

      <ConfirmIconDialog
        open={everywhereOpen}
        onOpenChange={setEverywhereOpen}
        icon={ShieldAlert}
        tone="danger"
        title="Sign out everywhere?"
        description="Every device currently signed in to your account — phone, other browsers, this one too — will be signed out and need to log in again. Use this if you think someone else has access to your account."
        actionLabel="Sign out everywhere"
        actionPendingLabel="Signing out everywhere…"
        onConfirm={onSignOutEverywhere}
        pending={signingOutEverywhere}
      />

      <ConfirmIconDialog
        open={!!revokeTarget}
        onOpenChange={(open) => { if (!open) setRevokeTarget(null); }}
        icon={LogOut}
        tone="danger"
        title="Log out this device?"
        description={revokeTarget?.isCurrent
          ? 'This is your current device — you\'ll be signed out immediately.'
          : `"${revokeTarget?.device_label}" will be signed out and need to log in again.`}
        actionLabel="Log out"
        actionPendingLabel="Logging out…"
        onConfirm={confirmRevoke}
        pending={revoking}
      />
    </>
  );
}
