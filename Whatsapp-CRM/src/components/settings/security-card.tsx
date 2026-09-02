'use client';

import { useEffect, useState } from 'react';
import { Lock, ShieldCheck, ChevronRight, MessageSquare, Smartphone, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { PasswordForm } from '@/components/settings/password-form';
import { MfaSettings } from '@/components/settings/mfa-settings';

type MfaMethod = 'disabled' | 'sms' | 'whatsapp' | 'totp';

const METHOD_META: Record<Exclude<MfaMethod, 'disabled'>, { label: string; icon: typeof MessageSquare }> = {
  sms: { label: 'SMS', icon: MessageSquare },
  whatsapp: { label: 'WhatsApp', icon: Smartphone },
  totp: { label: 'Authenticator App', icon: KeyRound },
};

/**
 * Merged Password + Multi-factor authentication (MFA) card — matches the
 * reference design's single "Security" section instead of two separate
 * cards. Each row is a compact summary; the real forms (password change,
 * MFA enrollment/disable — both already-working, untouched logic) open
 * in a Dialog on demand.
 */
export function SecurityCard() {
  const [pwdOpen, setPwdOpen] = useState(false);
  const [mfaOpen, setMfaOpen] = useState(false);
  const [method, setMethod] = useState<MfaMethod>('disabled');

  async function fetchStatus() {
    try {
      const res = await fetch('/api/account/mfa');
      const data = await res.json();
      if (res.ok) setMethod((data.method as MfaMethod) ?? 'disabled');
    } catch {
      // summary row just stays at its last-known state
    }
  }

  // Initial data fetch on mount — fetchStatus's setState happens after an
  // await (a later microtask), not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStatus();
  }, []);

  const isEnabled = method !== 'disabled';
  const methodMeta = isEnabled ? METHOD_META[method as Exclude<MfaMethod, 'disabled'>] : null;
  const MethodIcon = methodMeta?.icon;

  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-start gap-3 px-6 py-4 border-b border-slate-100">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#EEF0FF]">
            <Lock className="h-4.5 w-4.5 text-[#5B6CF9]" />
          </span>
          <div className="flex-1 min-w-0">
            <h3 className="text-[14px] font-semibold text-slate-800">Security</h3>
            <p className="text-[12px] text-slate-500 mt-0.5">Manage your account security and access.</p>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {/* Password row */}
          <div className="flex items-center gap-3 px-6 py-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#EEF0FF]">
              <Lock className="h-4 w-4 text-[#5B6CF9]" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] font-semibold text-slate-800">Password</p>
              <p className="text-[12px] text-slate-500 mt-0.5">Use a strong password to keep your account secure.</p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPwdOpen(true)}
              className="h-9 px-3.5 text-[12.5px] border-slate-200 shrink-0"
            >
              Change password
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* 2FA row */}
          <div className="flex items-center gap-3 px-6 py-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#E9FBF5]">
              <ShieldCheck className="h-4 w-4 text-[#0D9488]" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] font-semibold text-slate-800">Multi-factor authentication (MFA)</p>
              <p className="text-[12px] text-slate-500 mt-0.5">Add an extra layer of security to your account.</p>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              {isEnabled && (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-600">
                  Enabled
                </span>
              )}
              <button
                type="button"
                role="switch"
                aria-checked={isEnabled}
                aria-label="Multi-factor authentication (MFA)"
                onClick={() => setMfaOpen(true)}
                className={`relative h-6 w-10 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#5B6CF9]/40 focus:ring-offset-2 ${
                  isEnabled ? 'bg-emerald-500' : 'bg-slate-200'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
                    isEnabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Active method sub-row */}
          {isEnabled && methodMeta && MethodIcon && (
            <div className="flex items-center gap-3 pl-[4.25rem] pr-6 py-3 bg-slate-50/60">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white border border-slate-200">
                <MethodIcon className="h-3.5 w-3.5 text-slate-500" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-medium text-slate-700">{methodMeta.label}</p>
                <p className="text-[11px] text-slate-400">Used for sign-in verification</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setMfaOpen(true)}
                className="h-7 px-3 text-[11.5px] border-emerald-200 text-emerald-700 hover:bg-emerald-50 shrink-0"
              >
                Manage
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Title/description are sr-only — PasswordForm/MfaSettings already
          open with their own centered icon + heading, matching the
          ConfirmIconDialog language used elsewhere; a second DialogHeader
          on top of that read as two stacked titles. Still real elements
          (not removed) since the Dialog needs an accessible name. */}
      <Dialog open={pwdOpen} onOpenChange={setPwdOpen}>
        <DialogContent>
          <DialogHeader className="sr-only">
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>Update the password you use to sign in.</DialogDescription>
          </DialogHeader>
          <PasswordForm onDone={() => setPwdOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={mfaOpen} onOpenChange={(open) => { setMfaOpen(open); if (!open) fetchStatus(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader className="sr-only">
            <DialogTitle>Multi-factor authentication (MFA)</DialogTitle>
            <DialogDescription>Require a second code every time you sign in.</DialogDescription>
          </DialogHeader>
          <MfaSettings />
        </DialogContent>
      </Dialog>
    </>
  );
}
