'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, LogOut, ShieldAlert, Monitor, Smartphone } from 'lucide-react';

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

/**
 * Sessions are JWT-based (stateless, no server-side session store — see
 * src/auth.ts's `session: { strategy: "jwt" }`), so there is no list of
 * "other devices" to enumerate or individually revoke, and no real IP/
 * location tracking. What IS real: the browser this page is currently
 * running in (derived from navigator.userAgent, client-side only — never
 * fabricated), and "Sign out everywhere", backed by
 * users.session_invalidated_at, which forces every existing token — on
 * every device, including this one — to be rejected on its next use (see
 * auth.ts's jwt callback).
 */
function parseUserAgent(ua: string): { os: string; browser: string; mobile: boolean } {
  let os = 'Unknown OS';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  let browser = 'Unknown browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua)) browser = 'Opera';
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';

  return { os, browser, mobile: /Android|iPhone|iPad|iPod/.test(ua) };
}

export function SessionsCard() {
  const { signOut, profile } = useAuth();
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [everywhereOpen, setEverywhereOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signingOutEverywhere, setSigningOutEverywhere] = useState(false);
  // Read client-side only (no navigator on the server) — never fabricated,
  // just what this actual browser reports about itself.
  const [device, setDevice] = useState<{ os: string; browser: string; mobile: boolean } | null>(null);

  useEffect(() => {
    setDevice(parseUserAgent(navigator.userAgent));
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

  const DeviceIcon = device?.mobile ? Smartphone : Monitor;

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

        {/* Current device — the only session this app can actually see */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100">
            <DeviceIcon className="h-4 w-4 text-slate-500" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-slate-800 flex items-center gap-2">
              {device ? `${device.os} • ${device.browser}` : 'This device'}
              <span className="rounded-full bg-[#EEF0FF] px-2 py-0.5 text-[10.5px] font-semibold text-[#5B6CF9]">
                Current session
              </span>
            </p>
            {profile?.email && (
              <p className="text-[11.5px] text-slate-400 mt-0.5">
                Signed in as {profile.email}
                {profile.account_role && ` • ${profile.account_role}`}
              </p>
            )}
          </div>
        </div>

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
    </>
  );
}
