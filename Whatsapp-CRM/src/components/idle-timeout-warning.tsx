'use client';

import { ShieldAlert } from 'lucide-react';
import { useIdleTimeout } from '@/hooks/use-idle-timeout';

/** Mounted once, app-wide (see providers.tsx) — shows a countdown for the
 *  last 10 seconds before an idle session is signed out. Any real
 *  interaction (including clicking "Stay signed in" here) dismisses it and
 *  resets the idle clock; the actual 10-minute cutoff is enforced
 *  server-side regardless of whether this ever renders (see proxy.ts). */
export function IdleTimeoutWarning() {
  const { secondsLeft, stayActive } = useIdleTimeout();
  if (secondsLeft === null) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl border border-slate-100 p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100">
          <ShieldAlert className="h-6 w-6 text-amber-600" />
        </div>
        <h3 className="text-[16px] font-bold text-slate-900">Still there?</h3>
        <p className="mt-1.5 text-[13px] text-slate-500">
          You&apos;ve been inactive — for your security, you&apos;ll be signed out in
        </p>
        <p className="mt-2 text-[32px] font-bold tabular-nums text-amber-600">{secondsLeft}s</p>
        <button
          type="button"
          onClick={stayActive}
          className="mt-4 h-11 w-full rounded-xl bg-indigo-600 text-[14px] font-semibold text-white transition-all hover:bg-indigo-700 active:scale-[0.98]"
        >
          Stay signed in
        </button>
      </div>
    </div>
  );
}
