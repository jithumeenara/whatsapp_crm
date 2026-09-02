'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Lock, Eye, EyeOff, Check, ShieldCheck } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const MIN_PASSWORD = 8;

type Strength = 0 | 1 | 2 | 3;

function scorePassword(pw: string): Strength {
  if (pw.length < MIN_PASSWORD) return 0;
  let variety = 0;
  if (/[a-z]/.test(pw)) variety++;
  if (/[A-Z]/.test(pw)) variety++;
  if (/[0-9]/.test(pw)) variety++;
  if (/[^A-Za-z0-9]/.test(pw)) variety++;
  if (pw.length >= 12 && variety >= 3) return 3;
  if (variety >= 3) return 2;
  return 1;
}

const STRENGTH_META: Record<Strength, { label: string; color: string }> = {
  0: { label: 'Too short', color: '#CBD5E1' },
  1: { label: 'Weak', color: '#F59E0B' },
  2: { label: 'Good', color: '#5B6CF9' },
  3: { label: 'Strong', color: '#0D9488' },
};

/** A password field with its own show/hide toggle — the one thing every
 *  other secret field in this app already has, that this form was
 *  missing. */
function PasswordField({ id, label, value, onChange, autoComplete, disabled, hint }: {
  id: string; label: string; value: string; onChange: (v: string) => void
  autoComplete: string; disabled: boolean; hint?: React.ReactNode
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[13px] font-medium text-slate-700">{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          minLength={id !== 'current-password' ? MIN_PASSWORD : undefined}
          disabled={disabled}
          required
          className="h-10 text-[13px] border-slate-200 pr-10 focus:border-[#5B6CF9] focus:ring-[#5B6CF9]/20"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          tabIndex={-1}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {hint}
    </div>
  );
}

/**
 * Bare form — no card chrome of its own. Lives inside a Dialog (see
 * SecurityCard, which supplies the title/description via DialogHeader).
 */
export function PasswordForm({ onDone }: { onDone?: () => void }) {
  const { profile } = useAuth();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const strength = useMemo(() => scorePassword(next), [next]);
  const strengthMeta = STRENGTH_META[strength];
  const match = confirm.length > 0 && next === confirm;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.email) {
      toast.error('Cannot change password without a current email');
      return;
    }
    if (next.length < MIN_PASSWORD) {
      setConfirmError(`Password must be at least ${MIN_PASSWORD} characters`);
      return;
    }
    if (next !== confirm) {
      setConfirmError('Passwords do not match');
      return;
    }
    setConfirmError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/account/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Update failed: HTTP ${res.status}`);
      }

      setCurrent('');
      setNext('');
      setConfirm('');
      toast.success('Password updated');
      onDone?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="flex justify-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#EEF0FF]">
          <Lock className="h-6 w-6 text-[#5B6CF9]" />
        </span>
      </div>

      <PasswordField
        id="current-password" label="Current password" value={current} onChange={setCurrent}
        autoComplete="current-password" disabled={saving}
      />

      <div className="h-px bg-slate-100" />

      <PasswordField
        id="new-password" label="New password" value={next} onChange={setNext}
        autoComplete="new-password" disabled={saving}
        hint={next.length > 0 && (
          <div className="space-y-1 pt-0.5">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1 flex-1 rounded-full transition-colors"
                  style={{ background: strength > i ? strengthMeta.color : '#E2E8F0' }}
                />
              ))}
            </div>
            <p className="text-[11px] font-medium" style={{ color: strengthMeta.color }}>{strengthMeta.label}</p>
          </div>
        )}
      />

      <PasswordField
        id="confirm-password" label="Confirm new password" value={confirm} onChange={setConfirm}
        autoComplete="new-password" disabled={saving}
        hint={confirm.length > 0 && (
          <p className={`flex items-center gap-1 text-[11px] ${match ? 'text-emerald-600' : 'text-rose-500'}`}>
            {match ? <Check className="h-3 w-3" /> : null}
            {match ? 'Passwords match' : 'Passwords do not match yet'}
          </p>
        )}
      />

      {confirmError && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-600">
          {confirmError}
        </p>
      )}

      <p className="flex items-start gap-1.5 text-[11px] text-slate-400 leading-relaxed">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        Use at least {MIN_PASSWORD} characters. You&apos;ll stay signed in on this device after changing it.
      </p>

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={saving || !current || !next || !confirm}
          className="h-9 px-5 text-[13px] bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Updating…
            </>
          ) : (
            'Update password'
          )}
        </Button>
      </div>
    </form>
  );
}
