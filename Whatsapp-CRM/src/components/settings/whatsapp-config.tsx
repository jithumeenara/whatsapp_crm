'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Eye, EyeOff, Copy, ClipboardCheck, CheckCircle2, XCircle, Loader2, ExternalLink,
  Zap, AlertTriangle, RotateCcw, Info, Terminal, Globe, KeyRound,
  Hash, Building2, Lock, Shield, CheckCheck, ChevronDown, ChevronUp,
  Wifi, WifiOff, RefreshCw,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useConfirm } from '@/hooks/use-confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { WhatsAppConfig as WhatsAppConfigType } from '@/types';
import { KeysDialog } from '@/components/flows/keys-dialog';

const MASKED_TOKEN = '••••••••••••••••';

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';
type ResetReason = 'token_corrupted' | 'meta_api_error' | null;

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(' ') }

/* ── small helper ── */
function FieldRow({
  id, label, icon: Icon, children, hint,
}: {
  id?: string
  label: React.ReactNode
  icon: React.ElementType
  children: React.ReactNode
  hint?: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex items-center gap-1.5 text-[13px] font-medium text-slate-700">
        <Icon className="h-3.5 w-3.5 text-slate-400" />
        {label}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-slate-400 leading-relaxed">{hint}</p>}
    </div>
  )
}

function SectionCard({ title, description, children, footer }: {
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100">
        <h3 className="text-[14px] font-semibold text-slate-800">{title}</h3>
        {description && <p className="text-[12px] text-slate-500 mt-0.5">{description}</p>}
      </div>
      <div className="px-6 py-5 space-y-4">{children}</div>
      {footer && (
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
          {footer}
        </div>
      )}
    </div>
  )
}

export function WhatsAppConfig() {
  const { userId, accountId, loading: authLoading, profileLoading } = useAuth();
  const confirm = useConfirm();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [keysDialogOpen, setKeysDialogOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [config, setConfig] = useState<WhatsAppConfigType | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [resetReason, setResetReason] = useState<ResetReason>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [showSetup, setShowSetup] = useState(false);

  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [tokenCopied, setTokenCopied] = useState(false);
  const [pin, setPin] = useState('');
  const [tokenEdited, setTokenEdited] = useState(false);

  const isRegistered = Boolean(config?.registered_at);
  const lastRegistrationError = config?.last_registration_error ?? null;

  const [verifyingRegistration, setVerifyingRegistration] = useState(false);
  type RegistrationProbe = {
    live: boolean;
    checks: Record<string, boolean | null>;
    errors?: string[];
    last_registration_error?: string | null;
    registered_at?: string | null;
    subscribed_apps_at?: string | null;
  };
  const [registrationProbe, setRegistrationProbe] = useState<RegistrationProbe | null>(null);

  const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/whatsapp/webhook` : '';
  const isLocalhost = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    !webhookUrl.startsWith('https://')
  );

  const fetchConfig = useCallback(async (_acctId: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/whatsapp/config', { method: 'GET' });
      const payload = await res.json();
      const data = payload.config ?? null;

      if (data) {
        setConfig(data);
        setPhoneNumberId(data.phone_number_id || '');
        setWabaId(data.waba_id || '');
        setAccessToken(MASKED_TOKEN);
        setVerifyToken('');
        setPin('');
        setTokenEdited(false);
      } else {
        setConfig(null);
        setPhoneNumberId('');
        setWabaId('');
        setAccessToken('');
        setVerifyToken('');
        setPin('');
        setTokenEdited(false);
      }
      setRegistrationProbe(null);

      if (data) {
        if (payload.connected) {
          setConnectionStatus('connected');
          setResetReason(null);
          setStatusMessage('');
        } else {
          setConnectionStatus('disconnected');
          setResetReason(payload.needs_reset ? 'token_corrupted' : payload.reason === 'meta_api_error' ? 'meta_api_error' : null);
          setStatusMessage(payload.message || '');
        }
      } else {
        setConnectionStatus('disconnected');
        setResetReason(null);
        setStatusMessage('');
      }
    } catch (err) {
      console.error('fetchConfig error:', err);
      toast.error('Failed to load WhatsApp configuration');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!userId || !accountId) { setLoading(false); return; }
    fetchConfig('');
  }, [authLoading, profileLoading, userId, accountId, fetchConfig]);

  async function handleSave() {
    if (!phoneNumberId.trim()) { toast.error('Phone Number ID is required'); return; }
    if (!config && (!accessToken.trim() || !tokenEdited)) { toast.error('Access Token is required for initial setup'); return; }

    try {
      setSaving(true);
      const payload: Record<string, unknown> = {
        phone_number_id: phoneNumberId.trim(),
        waba_id: wabaId.trim() || null,
        verify_token: verifyToken.trim() || null,
        pin: pin.trim() || null,
      };

      if (tokenEdited && accessToken !== MASKED_TOKEN && accessToken.trim()) {
        payload.access_token = accessToken.trim();
      } else if (config) {
        toast.error('Please re-enter the Access Token to save changes');
        setSaving(false);
        return;
      }

      const res = await fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) { toast.error(data.error || 'Failed to save configuration'); setSaving(false); return; }

      if (data.registered === false && data.registration_error) {
        toast.error(`Saved, but Meta couldn't register the number: ${data.registration_error}`, { duration: 12000 });
      } else {
        toast.success(
          data.phone_info?.verified_name
            ? `Live — ${data.phone_info.verified_name} can now receive events.`
            : 'WhatsApp connected. Events will start flowing within a minute.',
        );
        setPin('');
      }
      await fetchConfig('');
    } catch (err) {
      console.error('Save error:', err);
      toast.error('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    try {
      setTesting(true);
      const res = await fetch('/api/whatsapp/config', { method: 'GET' });
      const payload = await res.json();
      if (payload.connected) {
        setConnectionStatus('connected');
        setResetReason(null);
        setStatusMessage('');
        toast.success(payload.phone_info?.verified_name ? `Connected to ${payload.phone_info.verified_name}` : 'API connection successful');
      } else {
        setConnectionStatus('disconnected');
        setResetReason(payload.needs_reset ? 'token_corrupted' : payload.reason === 'meta_api_error' ? 'meta_api_error' : null);
        setStatusMessage(payload.message || '');
        toast.error(payload.message || 'API connection failed');
      }
    } catch {
      setConnectionStatus('disconnected');
      toast.error('Connection test failed. Check network and try again.');
    } finally {
      setTesting(false);
    }
  }

  async function handleVerifyRegistration() {
    setVerifyingRegistration(true);
    setRegistrationProbe(null);
    try {
      const res = await fetch('/api/whatsapp/config/verify-registration', { method: 'GET' });
      const data = (await res.json()) as RegistrationProbe;
      setRegistrationProbe(data);
      if (data.live) {
        toast.success('Number is fully wired — Meta is delivering events.');
      } else {
        toast.error('Number is not fully registered. See the checks below for which step failed.', { duration: 8000 });
      }
      await fetchConfig('');
    } catch {
      toast.error('Could not reach the verification endpoint.');
    } finally {
      setVerifyingRegistration(false);
    }
  }

  async function handleReset() {
    const yes = await confirm({
      title: 'Reset WhatsApp config?',
      description: 'This will delete the current WhatsApp config so you can re-enter it.',
      confirmLabel: 'Reset',
      variant: 'destructive',
    });
    if (!yes) return;

    try {
      setResetting(true);
      const res = await fetch('/api/whatsapp/config', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to reset configuration'); return; }
      toast.success('Configuration cleared. You can now re-enter your credentials.');
      setConfig(null);
      setPhoneNumberId('');
      setWabaId('');
      setAccessToken('');
      setVerifyToken('');
      setTokenEdited(false);
      setConnectionStatus('disconnected');
      setResetReason(null);
      setStatusMessage('');
    } catch {
      toast.error('Failed to reset configuration');
    } finally {
      setResetting(false);
    }
  }

  async function handleSendTestMessage() {
    if (!testPhone.trim()) { toast.error('Enter a phone number first'); return; }
    try {
      setSendingTest(true);
      const res = await fetch('/api/whatsapp/test-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: testPhone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to send test message'); }
      else { toast.success(`Test message sent to ${testPhone.trim()}`); }
    } catch {
      toast.error('Could not send test message');
    } finally {
      setSendingTest(false);
    }
  }

  function handleCopyWebhookUrl() {
    navigator.clipboard.writeText(webhookUrl);
    toast.success('Webhook URL copied');
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#5B6CF9] border-t-transparent" />
          <p className="text-[13px] text-slate-500">Loading configuration…</p>
        </div>
      </div>
    );
  }

  const isConnected = connectionStatus === 'connected';

  return (
    <div className="space-y-5">
      {/* ── Status Bar ── */}
      <div className={cn(
        "rounded-2xl border px-5 py-4 flex items-center gap-4",
        isConnected
          ? "bg-emerald-50 border-emerald-200"
          : resetReason === 'token_corrupted'
          ? "bg-amber-50 border-amber-200"
          : "bg-slate-50 border-slate-200"
      )}>
        <div className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
          isConnected ? "bg-emerald-100" : "bg-slate-200",
        )}>
          {isConnected
            ? <Wifi className="h-5 w-5 text-emerald-600" />
            : <WifiOff className="h-5 w-5 text-slate-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className={cn("text-[14px] font-semibold",
            isConnected ? "text-emerald-800" : "text-slate-700"
          )}>
            {isConnected ? 'WhatsApp Connected' : 'Not Connected'}
          </p>
          <p className={cn("text-[12px] mt-0.5",
            isConnected ? "text-emerald-600" : "text-slate-500"
          )}>
            {isConnected
              ? 'Your access token authenticates successfully with Meta.'
              : statusMessage || 'Configure your Meta API credentials below to get started.'}
          </p>
        </div>
        {config && (
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestConnection}
              disabled={testing}
              className="h-8 text-[12px] border-slate-200 bg-white"
            >
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Test
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleVerifyRegistration}
              disabled={verifyingRegistration}
              className="h-8 text-[12px] border-slate-200 bg-white"
            >
              {verifyingRegistration ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
              Verify
            </Button>
          </div>
        )}
      </div>

      {/* Registration probe results */}
      {registrationProbe && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 space-y-2">
          <p className="text-[12px] font-semibold text-slate-700 flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5 text-slate-400" />
            Registration Diagnostic —{' '}
            <span className={registrationProbe.live ? 'text-emerald-600' : 'text-amber-600'}>
              {registrationProbe.live ? 'Live' : 'Not live'}
            </span>
          </p>
          <ul className="space-y-1">
            {Object.entries(registrationProbe.checks).map(([k, v]) => (
              <li key={k} className="flex items-center gap-2 text-[12px]">
                {v === true
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  : v === false
                  ? <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                  : <span className="h-3.5 w-3.5 rounded-full border border-slate-300 shrink-0 inline-block" />}
                <code className="text-slate-600">{k}</code>
              </li>
            ))}
          </ul>
          {(registrationProbe.errors ?? []).length > 0 && (
            <ul className="space-y-0.5 text-[11px] text-red-500">
              {registrationProbe.errors?.map((e, i) => <li key={i}>• {e}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Token-corrupted banner */}
      {resetReason === 'token_corrupted' && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-[13px] font-semibold text-amber-800">Stored token can't be decrypted</p>
            <p className="text-[12px] text-amber-700 mt-0.5">{statusMessage}</p>
            <Button
              size="sm"
              onClick={handleReset}
              disabled={resetting}
              className="mt-3 h-7 text-[12px] bg-amber-500 hover:bg-amber-600 text-white"
            >
              {resetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              Reset Configuration
            </Button>
          </div>
        </div>
      )}

      {/* Registration status */}
      {config && (
        <div className={cn(
          "rounded-2xl border px-5 py-4 flex items-start gap-3",
          isRegistered ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"
        )}>
          {isRegistered
            ? <CheckCheck className="h-4.5 w-4.5 text-emerald-600 mt-0.5 shrink-0" />
            : <AlertTriangle className="h-4.5 w-4.5 text-amber-500 mt-0.5 shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className={cn("text-[13px] font-semibold",
              isRegistered ? "text-emerald-800" : "text-amber-800"
            )}>
              {isRegistered ? 'Registered — Meta will deliver events' : 'Not registered — events won\'t arrive'}
            </p>
            <p className={cn("text-[12px] mt-0.5",
              isRegistered ? "text-emerald-700" : "text-amber-700"
            )}>
              {isRegistered
                ? `Subscribed since ${config.registered_at ? new Date(config.registered_at).toLocaleString() : 'unknown'}.`
                : lastRegistrationError
                ? `Last attempt: "${lastRegistrationError}". Enter the 2-step PIN below and save.`
                : 'Enter the 2-step PIN below and save to subscribe this number.'}
            </p>
          </div>
        </div>
      )}

      {/* ── Credentials ── */}
      <SectionCard
        title="API Credentials"
        description="Enter your Meta WhatsApp Business API credentials from Meta Developers."
        footer={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="h-9 px-5 text-[13px] bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white"
            >
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : 'Save Configuration'}
            </Button>
            {!config && (
              <p className="text-[12px] text-slate-500">Save credentials first to test connection.</p>
            )}
            {config && (
              <Button
                variant="outline"
                onClick={handleReset}
                disabled={resetting}
                className="h-9 text-[12px] border-red-200 text-red-600 hover:bg-red-50 ml-auto"
              >
                {resetting ? <><Loader2 className="h-4 w-4 animate-spin" />Resetting…</> : <><RotateCcw className="h-4 w-4" />Reset</>}
              </Button>
            )}
          </div>
        }
      >
        <FieldRow id="phoneNumberId" label="Phone Number ID" icon={Hash}
          hint="Found in Meta Developers → WhatsApp → API Setup">
          <Input
            id="phoneNumberId"
            placeholder="e.g. 100234567890123"
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value)}
            className="h-9 text-[13px] border-slate-200 font-mono"
          />
        </FieldRow>

        <FieldRow id="wabaId" label="WhatsApp Business Account ID" icon={Building2}
          hint="Found next to your Phone Number ID in Meta Developers">
          <Input
            id="wabaId"
            placeholder="e.g. 100234567890456"
            value={wabaId}
            onChange={(e) => setWabaId(e.target.value)}
            className="h-9 text-[13px] border-slate-200 font-mono"
          />
        </FieldRow>

        <FieldRow id="accessToken" label="Permanent Access Token" icon={Lock}>
          <div className="relative">
            <Input
              id="accessToken"
              type={showToken ? 'text' : 'password'}
              placeholder="Enter your access token"
              value={accessToken}
              onChange={(e) => { setAccessToken(e.target.value); setTokenEdited(true); }}
              onFocus={() => { if (accessToken === MASKED_TOKEN) { setAccessToken(''); setTokenEdited(true); } }}
              className="h-9 text-[13px] border-slate-200 pr-10 font-mono"
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {config && !tokenEdited && (
            <p className="text-[11px] text-slate-400">Token hidden for security. Click to re-enter.</p>
          )}
        </FieldRow>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FieldRow id="verifyToken" label="Webhook Verify Token" icon={Shield}
            hint="Custom string — must match what you set in Meta">
            <div className="flex gap-2">
              <Input
                id="verifyToken"
                placeholder="my-secret-verify-token"
                value={verifyToken}
                onChange={(e) => setVerifyToken(e.target.value)}
                className="h-9 text-[13px] border-slate-200 font-mono flex-1"
              />
              <button
                type="button"
                title="Generate a random verify token"
                onClick={() => {
                  const token = Array.from(crypto.getRandomValues(new Uint8Array(18)))
                    .map((b) => b.toString(36).padStart(2, "0"))
                    .join("")
                    .slice(0, 24)
                  setVerifyToken(token)
                  setTokenCopied(false)
                }}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[12px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors whitespace-nowrap h-9"
              >
                <RefreshCw className="h-3 w-3" />
                Generate
              </button>
              {verifyToken && (
                <button
                  type="button"
                  title="Copy verify token"
                  onClick={() => {
                    void navigator.clipboard.writeText(verifyToken)
                    setTokenCopied(true)
                    setTimeout(() => setTokenCopied(false), 2000)
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[12px] font-medium transition-colors whitespace-nowrap h-9 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  {tokenCopied ? <ClipboardCheck className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
                  {tokenCopied ? "Copied!" : "Copy"}
                </button>
              )}
            </div>
          </FieldRow>

          <FieldRow id="pin" label={<span className="flex items-center gap-1">2-Step PIN {!isRegistered && <span className="text-red-400">*</span>}</span>} icon={KeyRound}
            hint="6-digit PIN from Meta WhatsApp Manager">
            <Input
              id="pin"
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="••••••"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="h-9 text-[13px] border-slate-200 tracking-[0.3em] font-mono"
            />
          </FieldRow>
        </div>
      </SectionCard>

      {/* ── Encryption Keys ── */}
      <SectionCard
        title="WhatsApp Flows Encryption"
        description="RSA-2048 key pair for Meta WhatsApp Flows. If flow forms show errors, resync here."
      >
        <Button variant="outline" className="h-9 text-[13px] gap-2 border-slate-200" onClick={() => setKeysDialogOpen(true)}>
          <KeyRound className="h-4 w-4" />
          Manage Encryption Keys
        </Button>
      </SectionCard>

      {/* ── Webhook ── */}
      <SectionCard
        title="Webhook Configuration"
        description="Paste this URL into Meta Developers → WhatsApp → Configuration → Webhooks."
      >
        {isLocalhost && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[13px] font-semibold text-amber-800">Localhost can't be reached by Meta</p>
                <p className="text-[12px] text-amber-700 mt-0.5 leading-relaxed">
                  You need a public HTTPS URL. Use ngrok for quick local testing.
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-white p-3 space-y-2">
              <div className="flex items-center gap-1.5">
                <Terminal className="h-3.5 w-3.5 text-amber-600" />
                <p className="text-[12px] font-semibold text-amber-700">Quick setup with ngrok</p>
              </div>
              <ol className="space-y-1.5 text-[12px] text-slate-700">
                {[
                  'Install ngrok from ngrok.com (free)',
                  'Run: ngrok http 3000',
                  'Copy the https://xxxx.ngrok.io URL',
                  'Use https://xxxx.ngrok.io/api/whatsapp/webhook as your Callback URL',
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700 mt-0.5">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-[13px] font-medium text-slate-700 flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5 text-slate-400" />
            Callback URL
            {isLocalhost && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-600">
                Not public
              </span>
            )}
          </Label>
          <div className="flex gap-2">
            <Input
              readOnly
              value={webhookUrl}
              className="h-9 text-[13px] bg-slate-50 border-slate-200 font-mono text-slate-600"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={handleCopyWebhookUrl}
              className="h-9 w-9 shrink-0 border-slate-200"
              title="Copy URL"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          {!isLocalhost && (
            <p className="text-[11px] text-emerald-600 flex items-center gap-1.5">
              <CheckCircle2 className="h-3 w-3 shrink-0" />
              Public HTTPS URL — Meta can reach it.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-2">
          <p className="text-[12px] font-semibold text-slate-700 flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5 text-slate-400" />
            How to configure in Meta
          </p>
          <ol className="space-y-1 text-[12px] text-slate-500">
            {[
              'Meta Developers → Your App → WhatsApp → Configuration',
              'Click Edit under Webhook',
              'Paste the Callback URL above',
              'Enter the same Verify Token from the form',
              'Click Verify and Save',
              'Subscribe to the messages field',
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="shrink-0 font-semibold text-slate-400">{i + 1}.</span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      </SectionCard>

      {/* ── Test Message ── */}
      {config && (
        <SectionCard
          title="Send Test Message"
          description="Send a Hello World message to verify your WhatsApp connection is working."
        >
          <div className="flex gap-2">
            <Input
              placeholder="+91 98765 43210"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendTestMessage()}
              className="h-9 text-[13px] border-slate-200 max-w-xs"
            />
            <Button
              onClick={handleSendTestMessage}
              disabled={sendingTest || !testPhone.trim()}
              className="h-9 text-[13px] bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {sendingTest ? <><Loader2 className="h-4 w-4 animate-spin" />Sending…</> : 'Send Test'}
            </Button>
          </div>
          <p className="text-[11px] text-slate-400">International format with country code. Number must have WhatsApp installed.</p>
        </SectionCard>
      )}

      {/* ── Setup guide (collapsible) ── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setShowSetup((p) => !p)}
          className="w-full flex items-center justify-between px-6 py-4 text-left"
        >
          <div>
            <h3 className="text-[14px] font-semibold text-slate-800">Setup Guide</h3>
            <p className="text-[12px] text-slate-500 mt-0.5">Step-by-step Meta WhatsApp API setup instructions</p>
          </div>
          {showSetup
            ? <ChevronUp className="h-4 w-4 text-slate-400" />
            : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </button>

        {showSetup && (
          <div className="border-t border-slate-100">
            {[
              {
                n: 1, title: 'Create a Meta App',
                steps: ['Go to developers.facebook.com', 'Click "My Apps" → "Create App"', 'Select "Business" as app type', 'Fill in app details and create'],
              },
              {
                n: 2, title: 'Add WhatsApp Product',
                steps: ['In your app dashboard, click "Add Product"', 'Find "WhatsApp" and click "Set Up"', 'Follow the setup wizard to link your business'],
              },
              {
                n: 3, title: 'Get API Credentials',
                steps: ['Go to WhatsApp → API Setup', 'Copy your Phone Number ID', 'Copy your WhatsApp Business Account ID', 'Generate Permanent Access Token from Business Settings → System Users'],
              },
              {
                n: 4, title: 'Configure Webhooks',
                steps: ['Go to WhatsApp → Configuration in Meta Developers', 'Click Edit on the Webhook section', 'Paste your Callback URL (from above)', 'Enter the same Verify Token', 'Click Verify and Save', 'Subscribe to the messages field'],
              },
            ].map((section) => (
              <div key={section.n} className="px-6 py-4 border-b border-slate-100 last:border-0">
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#5B6CF9] text-[11px] font-bold text-white">
                    {section.n}
                  </span>
                  <p className="text-[13px] font-semibold text-slate-700">{section.title}</p>
                </div>
                <ol className="space-y-1.5 text-[12px] text-slate-500">
                  {section.steps.map((step, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-slate-300 font-mono">{i + 1}.</span>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
            <div className="px-6 py-4">
              <a
                href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[13px] text-[#5B6CF9] hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Meta WhatsApp API Documentation
              </a>
            </div>
          </div>
        )}
      </div>

      <KeysDialog open={keysDialogOpen} onOpenChange={setKeysDialogOpen} />
    </div>
  );
}
