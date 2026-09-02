'use client';

import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  ShieldCheck, ShieldOff, Loader2, MessageSquare, Smartphone, KeyRound,
  Copy, CheckCircle2, ChevronRight, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Stepper } from '@/components/settings/settings-ui-kit';

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(' '); }

type MfaMethod = 'disabled' | 'sms' | 'whatsapp' | 'totp';

const METHOD_META: Record<Exclude<MfaMethod, 'disabled'>, { label: string; icon: typeof MessageSquare; description: string }> = {
  sms: { label: 'SMS', icon: MessageSquare, description: 'A 6-digit code texted to your phone every time you sign in.' },
  whatsapp: { label: 'WhatsApp', icon: Smartphone, description: 'A 6-digit code sent via WhatsApp every time you sign in.' },
  totp: { label: 'Authenticator App', icon: KeyRound, description: 'Google Authenticator, Authy, 1Password, etc. — works offline, no SMS needed.' },
};

export function MfaSettings() {
  const [loading, setLoading] = useState(true);
  const [currentMethod, setCurrentMethod] = useState<MfaMethod>('disabled');
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null);

  // Setup wizard state — picking a new method to enroll.
  const [picking, setPicking] = useState<Exclude<MfaMethod, 'disabled'> | null>(null);
  const [phone, setPhone] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);

  // TOTP-specific setup state
  const [totpSecret, setTotpSecret] = useState('');
  const [totpQr, setTotpQr] = useState('');
  const [copied, setCopied] = useState(false);

  // Disable flow
  const [disabling, setDisabling] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableBusy, setDisableBusy] = useState(false);

  async function fetchStatus() {
    setLoading(true);
    try {
      const res = await fetch('/api/account/mfa');
      const data = await res.json();
      if (res.ok) {
        setCurrentMethod((data.method as MfaMethod) ?? 'disabled');
        setMaskedPhone(data.maskedPhone ?? null);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchStatus(); }, []);

  function resetPicker() {
    setPicking(null);
    setPhone('');
    setChallengeId('');
    setCode('');
    setCodeSentTo(null);
    setTotpSecret('');
    setTotpQr('');
  }

  async function startSmsOrWhatsapp(method: 'sms' | 'whatsapp') {
    if (!phone.trim()) { toast.error('Enter a phone number first'); return; }
    setSending(true);
    try {
      const res = await fetch('/api/account/mfa/enroll/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, phone: phone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to send code'); return; }
      setChallengeId(data.challengeId);
      setCodeSentTo(phone.trim());
      toast.success(`Code sent via ${method === 'sms' ? 'SMS' : 'WhatsApp'}`);
    } finally {
      setSending(false);
    }
  }

  async function startTotp() {
    setSending(true);
    try {
      const res = await fetch('/api/account/mfa/enroll/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'totp' }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to start setup'); return; }
      setTotpSecret(data.secret);
      setTotpQr(data.qrDataUrl);
    } finally {
      setSending(false);
    }
  }

  async function confirmEnroll() {
    if (!picking || code.length !== 6) return;
    setConfirming(true);
    try {
      const body = picking === 'totp'
        ? { method: 'totp', secret: totpSecret, code }
        : { method: picking, challengeId, code };
      const res = await fetch('/api/account/mfa/enroll/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Incorrect code'); return; }
      toast.success('Multi-factor authentication (MFA) enabled');
      resetPicker();
      fetchStatus();
    } finally {
      setConfirming(false);
    }
  }

  async function handleDisable() {
    if (!disablePassword.trim()) { toast.error('Enter your password'); return; }
    setDisableBusy(true);
    try {
      const res = await fetch('/api/account/mfa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: disablePassword }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to disable'); return; }
      toast.success('Multi-factor authentication (MFA) disabled');
      setDisabling(false);
      setDisablePassword('');
      fetchStatus();
    } finally {
      setDisableBusy(false);
    }
  }

  function copySecret() {
    navigator.clipboard.writeText(totpSecret);
    setCopied(true);
    toast.success('Secret copied');
    setTimeout(() => setCopied(false), 1500);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  const isEnabled = currentMethod !== 'disabled';
  const pickingMeta = picking ? METHOD_META[picking] : null;

  return (
    <div className="space-y-5">
      {/* Centered status icon — matches the icon-in-circle language used
          elsewhere (password dialog, ConfirmIconDialog) */}
      {!picking && !disabling && (
        <div className="flex justify-center">
          <span className={cn(
            'flex h-14 w-14 items-center justify-center rounded-full',
            isEnabled ? 'bg-emerald-50' : 'bg-[#EEF0FF]',
          )}>
            {isEnabled
              ? <ShieldCheck className="h-6 w-6 text-emerald-600" />
              : <ShieldOff className="h-6 w-6 text-[#5B6CF9]" />}
          </span>
        </div>
      )}

      {/* Status */}
      {!picking && !disabling && (
        <div className={cn(
          'flex items-center gap-3 rounded-xl border px-4 py-3',
          isEnabled ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50',
        )}>
          <div className="flex-1 min-w-0 text-center">
            <p className={cn('text-[13.5px] font-semibold', isEnabled ? 'text-emerald-800' : 'text-slate-700')}>
              {isEnabled ? `Enabled — ${METHOD_META[currentMethod as Exclude<MfaMethod, 'disabled'>].label}` : 'Not enabled'}
            </p>
            {isEnabled && maskedPhone && currentMethod !== 'totp' && (
              <p className="text-[11px] text-emerald-600 mt-0.5">Codes sent to {maskedPhone}</p>
            )}
            {!isEnabled && (
              <p className="text-[11px] text-slate-400 mt-0.5">Off by default — nothing changes until you set it up.</p>
            )}
          </div>
        </div>
      )}

      {isEnabled && !disabling && (
        <Button variant="outline" onClick={() => setDisabling(true)} className="w-full h-9 text-[12.5px] border-rose-200 text-rose-600 hover:bg-rose-50">
          Disable two-factor authentication
        </Button>
      )}

      {/* Disable confirmation */}
      {disabling && (
        <div className="space-y-4">
          <div className="flex justify-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-50">
              <AlertTriangle className="h-6 w-6 text-rose-500" />
            </span>
          </div>
          <p className="text-[13px] text-center text-slate-600">
            Confirm your password to turn off two-factor authentication.
          </p>
          <div className="space-y-1.5">
            <Label className="text-[13px] font-medium text-slate-700">Current password</Label>
            <Input type="password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)}
              placeholder="••••••••" className="h-10 text-[13px] border-slate-200" autoFocus />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setDisabling(false); setDisablePassword(''); }} className="flex-1 h-9 text-[13px] border-slate-200">
              Cancel
            </Button>
            <Button onClick={handleDisable} disabled={disableBusy} className="flex-1 h-9 text-[13px] bg-rose-600 hover:bg-rose-700 text-white">
              {disableBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Disable'}
            </Button>
          </div>
        </div>
      )}

      {/* Method picker — only when not already enabled and not mid-setup */}
      {!isEnabled && !picking && (
        <div className="space-y-2">
          {(Object.entries(METHOD_META) as [Exclude<MfaMethod, 'disabled'>, typeof METHOD_META['sms']][]).map(([key, meta]) => {
            const Icon = meta.icon;
            return (
              <button key={key} type="button" onClick={() => setPicking(key)}
                className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3.5 text-left transition-all hover:border-[#5B6CF9]/40 hover:shadow-sm hover:-translate-y-0.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EEF0FF]">
                  <Icon className="h-4.5 w-4.5 text-[#5B6CF9]" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-semibold text-slate-800">{meta.label}</p>
                  <p className="text-[11.5px] text-slate-500 leading-relaxed mt-0.5">{meta.description}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-300 shrink-0 group-hover:text-[#5B6CF9] transition-colors" />
              </button>
            );
          })}
        </div>
      )}

      {/* SMS / WhatsApp setup — a real 2-step Stepper */}
      {(picking === 'sms' || picking === 'whatsapp') && pickingMeta && (
        <div className="space-y-4">
          <p className="text-[13.5px] font-semibold text-slate-800 text-center">Set up {pickingMeta.label}</p>
          <Stepper
            steps={[
              {
                title: 'Enter your phone number',
                state: codeSentTo ? 'done' : 'active',
                children: !codeSentTo ? (
                  <div className="flex gap-2 mt-1">
                    <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91XXXXXXXXXX"
                      className="h-9 text-[13px] font-mono border-slate-200" />
                    <Button onClick={() => startSmsOrWhatsapp(picking)} disabled={sending} className="h-9 text-[13px] bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white shrink-0">
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send code'}
                    </Button>
                  </div>
                ) : (
                  <p className="text-emerald-600">Code sent to {codeSentTo}</p>
                ),
              },
              {
                title: 'Enter the 6-digit code',
                state: codeSentTo ? 'active' : 'pending',
                children: codeSentTo && (
                  <div className="flex gap-2 mt-1">
                    <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="123456" inputMode="numeric" maxLength={6}
                      className="h-9 text-[13px] font-mono border-slate-200 text-center tracking-[0.3em]" />
                    <Button onClick={confirmEnroll} disabled={confirming || code.length !== 6} className="h-9 text-[13px] bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white shrink-0">
                      {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm'}
                    </Button>
                  </div>
                ),
              },
            ]}
          />
          <button type="button" onClick={resetPicker} className="block mx-auto text-[11.5px] text-slate-500 hover:text-slate-700 underline underline-offset-2">Cancel</button>
        </div>
      )}

      {/* TOTP setup — a real 2-step Stepper */}
      {picking === 'totp' && (
        <div className="space-y-4">
          <p className="text-[13.5px] font-semibold text-slate-800 text-center">Set up Authenticator App</p>
          <Stepper
            steps={[
              {
                title: 'Scan the QR code',
                state: totpQr ? 'done' : 'active',
                children: !totpQr ? (
                  <Button onClick={startTotp} disabled={sending} className="h-9 text-[13px] bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white mt-1">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Generate QR code'}
                  </Button>
                ) : (
                  <div className="flex flex-col items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-4 mt-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={totpQr} alt="Scan with your authenticator app" className="h-[160px] w-[160px]" />
                    <p className="text-[11px] text-slate-500 text-center">Scan with Google Authenticator, Authy, or 1Password — or enter manually:</p>
                    <div className="flex items-center gap-1.5">
                      <code className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700">{totpSecret}</code>
                      <button type="button" onClick={copySecret} className="text-slate-400 hover:text-slate-600">
                        {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                ),
              },
              {
                title: 'Enter the 6-digit code from the app',
                state: totpQr ? 'active' : 'pending',
                children: totpQr && (
                  <div className="flex gap-2 mt-1">
                    <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="123456" inputMode="numeric" maxLength={6}
                      className="h-9 text-[13px] font-mono border-slate-200 text-center tracking-[0.3em]" />
                    <Button onClick={confirmEnroll} disabled={confirming || code.length !== 6} className="h-9 text-[13px] bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white shrink-0">
                      {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm'}
                    </Button>
                  </div>
                ),
              },
            ]}
          />
          <button type="button" onClick={resetPicker} className="block mx-auto text-[11.5px] text-slate-500 hover:text-slate-700 underline underline-offset-2">Cancel</button>
        </div>
      )}
    </div>
  );
}
