'use client';

import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  ShieldCheck, ShieldOff, Loader2, MessageSquare, Smartphone, KeyRound,
  Copy, CheckCircle2, Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
      toast.success('Two-factor authentication enabled');
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
      toast.success('Two-factor authentication disabled');
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
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm px-6 py-8 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  const isEnabled = currentMethod !== 'disabled';

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-start gap-3 px-6 py-4 border-b border-slate-100">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFF6E6]">
          <ShieldCheck className="h-4.5 w-4.5 text-[#D97706]" />
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-semibold text-slate-800">Two-factor authentication</h3>
          <p className="text-[12px] text-slate-500 mt-0.5">Require a second code (SMS, WhatsApp, or an authenticator app) every time you sign in.</p>
        </div>
      </div>

      <div className="px-6 py-5 space-y-4">
        {/* Status */}
        <div className={cn(
          'flex items-center gap-3 rounded-xl border px-4 py-3',
          isEnabled ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50',
        )}>
          <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', isEnabled ? 'bg-emerald-100' : 'bg-slate-200')}>
            {isEnabled ? <ShieldCheck className="h-4.5 w-4.5 text-emerald-600" /> : <ShieldOff className="h-4.5 w-4.5 text-slate-500" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className={cn('text-[13px] font-semibold', isEnabled ? 'text-emerald-800' : 'text-slate-700')}>
              {isEnabled ? `Enabled — ${METHOD_META[currentMethod as Exclude<MfaMethod, 'disabled'>].label}` : 'Not enabled'}
            </p>
            {isEnabled && maskedPhone && currentMethod !== 'totp' && (
              <p className="text-[11px] text-emerald-600">Codes sent to {maskedPhone}</p>
            )}
          </div>
          {isEnabled && !disabling && (
            <Button variant="outline" size="sm" onClick={() => setDisabling(true)} className="h-8 text-[12px] border-slate-200 bg-white shrink-0">
              Disable
            </Button>
          )}
        </div>

        {/* Disable confirmation */}
        {disabling && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 space-y-2.5">
            <p className="text-[12.5px] text-rose-700">Confirm your password to turn off two-factor authentication.</p>
            <div className="flex gap-2">
              <Input type="password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)}
                placeholder="Current password" className="h-9 text-[13px] border-rose-200 bg-white" />
              <Button onClick={handleDisable} disabled={disableBusy} className="h-9 text-[13px] bg-rose-600 hover:bg-rose-700 text-white shrink-0">
                {disableBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Disable'}
              </Button>
              <Button variant="outline" onClick={() => { setDisabling(false); setDisablePassword(''); }} className="h-9 text-[13px] border-slate-200 shrink-0">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Method picker — only when not already enabled and not mid-setup */}
        {!isEnabled && !picking && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(Object.entries(METHOD_META) as [Exclude<MfaMethod, 'disabled'>, typeof METHOD_META['sms']][]).map(([key, meta]) => {
              const Icon = meta.icon;
              return (
                <button key={key} type="button" onClick={() => setPicking(key)}
                  className="flex flex-col items-start gap-2 rounded-xl border border-slate-200 p-3.5 text-left transition-all hover:border-[#5B6CF9]/40 hover:shadow-sm">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#EEF0FF]">
                    <Icon className="h-4 w-4 text-[#5B6CF9]" />
                  </div>
                  <p className="text-[13px] font-semibold text-slate-800">{meta.label}</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed">{meta.description}</p>
                </button>
              );
            })}
          </div>
        )}

        {/* SMS / WhatsApp setup */}
        {(picking === 'sms' || picking === 'whatsapp') && (
          <div className="space-y-3 rounded-xl border border-[#5B6CF9]/15 bg-[#EEF0FF]/40 p-4">
            <p className="text-[12.5px] font-semibold text-[#4a5ce8]">Set up {METHOD_META[picking].label}</p>
            {!codeSentTo ? (
              <div className="flex gap-2">
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91XXXXXXXXXX"
                  className="h-9 text-[13px] font-mono border-slate-200 bg-white" />
                <Button onClick={() => startSmsOrWhatsapp(picking)} disabled={sending} className="h-9 text-[13px] bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white shrink-0">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send code'}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[12px] text-slate-500">Code sent to {codeSentTo}</p>
                <div className="flex gap-2">
                  <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456" inputMode="numeric" maxLength={6}
                    className="h-9 text-[13px] font-mono border-slate-200 bg-white text-center tracking-[0.3em]" />
                  <Button onClick={confirmEnroll} disabled={confirming || code.length !== 6} className="h-9 text-[13px] bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white shrink-0">
                    {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm'}
                  </Button>
                </div>
              </div>
            )}
            <button type="button" onClick={resetPicker} className="text-[11px] text-slate-500 hover:text-slate-700 underline underline-offset-2">Cancel</button>
          </div>
        )}

        {/* TOTP setup */}
        {picking === 'totp' && (
          <div className="space-y-3 rounded-xl border border-[#5B6CF9]/15 bg-[#EEF0FF]/40 p-4">
            <p className="text-[12.5px] font-semibold text-[#4a5ce8]">Set up Authenticator App</p>
            {!totpQr ? (
              <Button onClick={startTotp} disabled={sending} className="h-9 text-[13px] bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Generate QR code'}
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={totpQr} alt="Scan with your authenticator app" className="h-[180px] w-[180px]" />
                  <p className="text-[11px] text-slate-500 text-center">Scan with Google Authenticator, Authy, or 1Password — or enter the code manually:</p>
                  <div className="flex items-center gap-1.5">
                    <code className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700">{totpSecret}</code>
                    <button type="button" onClick={copySecret} className="text-slate-400 hover:text-slate-600">
                      {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                <Label className="text-[12px] font-medium text-slate-600">Enter the 6-digit code from the app</Label>
                <div className="flex gap-2">
                  <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456" inputMode="numeric" maxLength={6}
                    className="h-9 text-[13px] font-mono border-slate-200 bg-white text-center tracking-[0.3em]" />
                  <Button onClick={confirmEnroll} disabled={confirming || code.length !== 6} className="h-9 text-[13px] bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white shrink-0">
                    {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm'}
                  </Button>
                </div>
              </div>
            )}
            <button type="button" onClick={resetPicker} className="text-[11px] text-slate-500 hover:text-slate-700 underline underline-offset-2">Cancel</button>
          </div>
        )}

        {!isEnabled && !picking && (
          <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Lock className="h-3 w-3" /> Off by default — nothing changes for anyone until they set this up themselves.
          </p>
        )}
      </div>
    </div>
  );
}
