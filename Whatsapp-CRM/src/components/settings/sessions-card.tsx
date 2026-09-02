'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, LogOut, ShieldAlert, Monitor, Smartphone, MoreVertical } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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

function isMobileLabel(label: string) {
  return /Android|iOS/.test(label);
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

/**
 * Real per-device session list, backed by UserSession (one row per
 * login — see auth.ts). Each row's "Log out" actually revokes that one
 * device via DELETE /api/account/sessions/[id], forcing its next request
 * to be rejected — not a cosmetic list.
 */
export function SessionsCard() {
  const { signOut, profile } = useAuth();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [everywhereOpen, setEverywhereOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<SessionRow | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signingOutEverywhere, setSigningOutEverywhere] = useState(false);
  const [revoking, setRevoking] = useState(false);

  async function loadSessions() {
    try {
      const res = await fetch('/api/account/sessions');
      const data = await res.json();
      if (res.ok) setSessions(data.sessions ?? []);
    } catch {
      // list just stays empty/loading — the sign-out buttons still work
    }
  }

  useEffect(() => { loadSessions(); }, []);

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
        </div>

        {sessions === null ? (
          <div className="flex items-center justify-center py-6 border-b border-slate-100">
            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {sessions.map((s) => {
              const DeviceIcon = isMobileLabel(s.device_label) ? Smartphone : Monitor;
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
                    <p className="text-[11.5px] text-slate-400 mt-0.5">
                      Active {timeAgo(s.last_seen_at)}
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
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setRevokeTarget(s)} className="text-rose-600 focus:text-rose-600">
                        <LogOut className="h-3.5 w-3.5" />
                        Log out this device
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
            {sessions.length === 0 && (
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

      <Dialog open={signOutOpen} onOpenChange={setSignOutOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out?</DialogTitle>
            <DialogDescription>You&apos;ll be signed out of this browser and redirected to the login page.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setSignOutOpen(false)} disabled={signingOut}>Cancel</Button>
            <Button type="button" onClick={onSignOut} disabled={signingOut}>
              {signingOut ? <><Loader2 className="size-4 animate-spin" />Signing out…</> : 'Sign out'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={everywhereOpen} onOpenChange={setEverywhereOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out everywhere?</DialogTitle>
            <DialogDescription>
              Every device currently signed in to your account — phone, other browsers, this one too — will be signed out and need to log in again. Use this if you think someone else has access to your account.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setEverywhereOpen(false)} disabled={signingOutEverywhere}>Cancel</Button>
            <Button type="button" onClick={onSignOutEverywhere} disabled={signingOutEverywhere}
              className="bg-rose-600 hover:bg-rose-700 text-white">
              {signingOutEverywhere ? <><Loader2 className="size-4 animate-spin" />Signing out everywhere…</> : 'Sign out everywhere'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!revokeTarget} onOpenChange={(open) => { if (!open) setRevokeTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log out this device?</DialogTitle>
            <DialogDescription>
              {revokeTarget?.isCurrent
                ? 'This is your current device — you\'ll be signed out immediately.'
                : `"${revokeTarget?.device_label}" will be signed out and need to log in again.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setRevokeTarget(null)} disabled={revoking}>Cancel</Button>
            <Button type="button" onClick={confirmRevoke} disabled={revoking} className="bg-rose-600 hover:bg-rose-700 text-white">
              {revoking ? <><Loader2 className="size-4 animate-spin" />Logging out…</> : 'Log out'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
