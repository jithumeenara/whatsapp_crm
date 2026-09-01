'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, LogOut, ShieldAlert } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
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
      <Card className="bg-white/40 border-slate-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-slate-800">
            <LogOut className="size-4 text-primary" />
            Sessions
          </CardTitle>
          <CardDescription className="text-slate-500">
            {profile?.email && (
              <span className="block mb-1">
                Signed in as <strong className="text-slate-800/80">{profile.email}</strong>
                {profile.account_role && (
                  <span className="ml-2 text-xs text-slate-500">({profile.account_role})</span>
                )}
              </span>
            )}
            Sign out of just this browser, or force every device currently signed in — including this one — to log in again.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setSignOutOpen(true)}>
            <LogOut className="size-4" />
            Sign out
          </Button>
          <Button type="button" variant="outline" onClick={() => setEverywhereOpen(true)}
            className="text-rose-600 border-rose-200 hover:bg-rose-50 hover:text-rose-700">
            <ShieldAlert className="size-4" />
            Sign out everywhere
          </Button>
        </CardContent>
      </Card>

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
