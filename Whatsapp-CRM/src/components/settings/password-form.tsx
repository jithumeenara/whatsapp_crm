'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const MIN_PASSWORD = 8;

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
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-[12px] text-slate-500 -mt-1">
        Use at least {MIN_PASSWORD} characters. You&apos;ll stay signed in on this device after changing it.
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="current-password" className="text-[13px] font-medium text-slate-700">
          Current password
        </Label>
        <Input
          id="current-password"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          disabled={saving}
          required
          className="h-9 text-[13px] border-slate-200 focus:border-[#5B6CF9] focus:ring-[#5B6CF9]/20"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="new-password" className="text-[13px] font-medium text-slate-700">
            New password
          </Label>
          <Input
            id="new-password"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            disabled={saving}
            required
            className="h-9 text-[13px] border-slate-200 focus:border-[#5B6CF9] focus:ring-[#5B6CF9]/20"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-password" className="text-[13px] font-medium text-slate-700">
            Confirm new password
          </Label>
          <Input
            id="confirm-password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            disabled={saving}
            required
            className="h-9 text-[13px] border-slate-200 focus:border-[#5B6CF9] focus:ring-[#5B6CF9]/20"
          />
        </div>
      </div>

      {confirmError && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-600">
          {confirmError}
        </p>
      )}

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
