'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, LogOut, ShieldAlert } from 'lucide-react';

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
 * "other devices" to enumerate or individually revoke. What IS real and
 * useful: "Sign out everywhere", backed by users.session_invalidated_at,
 * which forces every existing token — on every device, including this
 * one — to be rejected on its next use (see auth.ts's jwt callback).
 */
export function SessionsCard() {
  const { signOut, profile } = useAuth();
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [everywhereOpen, setEverywhereOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signingOutEverywhere, setSigningOutEverywhere] = useState(false);

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

  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-start gap-3 px-6 py-4 border-b border-slate-100">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFF0F3]">
            <LogOut className="h-4.5 w-4.5 text-[#E11D48]" />
          </span>
          <div className="flex-1 min-w-0">
            <h3 className="text-[14px] font-semibold text-slate-800">Sessions</h3>
            <p className="text-[12px] text-slate-500 mt-0.5 leading-relaxed">
              {profile?.email && (
                <span className="block mb-1">
                  Signed in as <strong className="text-slate-700 font-medium">{profile.email}</strong>
                  {profile.account_role && (
                    <span className="ml-2 text-[11px] text-slate-400">({profile.account_role})</span>
                  )}
                </span>
              )}
              Sign out of just this browser, or force every device currently signed in — including this one — to log in again.
            </p>
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
