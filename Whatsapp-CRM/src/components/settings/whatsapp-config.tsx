'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Eye, EyeOff, Copy, ClipboardCheck, CheckCircle2, XCircle, Loader2, ExternalLink,
  Zap, AlertTriangle, RotateCcw, Info, Terminal, Globe, KeyRound,
  Hash, Building2, Lock, Shield, CheckCheck, ChevronDown, ChevronUp,
  Wifi, WifiOff, RefreshCw, ArrowLeft, Phone, CalendarClock, UserRound,
  Settings2, CircleHelp, Gauge, MousePointerClick, Send, BookOpen, Pencil,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useAuth } from '@/hooks/use-auth';
import { useConfirm } from '@/hooks/use-confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { WhatsAppConfig as WhatsAppConfigType } from '@/types';
import { KeysDialog } from '@/components/flows/keys-dialog';
import { EmbeddedSignupButton } from '@/components/settings/embedded-signup-button';
import { ConnectChannelScreen } from '@/components/settings/connect-channel-screen';
import { WhatsAppIcon } from '@/components/icons/brand-icons';
import { Stepper } from '@/components/settings/settings-ui-kit';

const MASKED_TOKEN = '••••••••••••••••';

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';
type ResetReason = 'token_corrupted' | 'meta_api_error' | null;

/** Live metadata Meta returns for the connected number. */
type PhoneInfo = {
  id: string;
  display_phone_number: string;
  verified_name?: string;
  quality_rating?: string;
  messaging_limit_tier?: string;
};

/** Our OWN send counts — not Meta's official quota usage. */
type Usage = { sentLast24h: number; sentLast30d: number };

/** The exact WhatsApp Business Profile Meta has on file — About text and
 *  profile photo, distinct from the connection credentials above. */
type BusinessProfile = { about: string; profile_picture_url?: string };

/** Meta's messaging tiers → the real cap each one allows per rolling
 *  24 hours (business-initiated conversations). */
const TIER_CAP: Record<string, number> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1_000,
  TIER_10K: 10_000,
  TIER_100K: 100_000,
};

function tierLabel(tier?: string): string {
  if (!tier) return 'Not reported by Meta';
  if (tier === 'TIER_UNLIMITED') return 'Unlimited';
  const cap = TIER_CAP[tier];
  return cap ? `${cap.toLocaleString()} / 24h` : tier;
}

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

/** One of the four stats along the bottom of the connected hero. */
function HeroStat({ icon: Icon, label, value, tone }: {
  icon: React.ElementType
  label: string
  value: string
  tone?: 'emerald'
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
        tone === 'emerald' ? 'bg-emerald-100' : 'bg-slate-100',
      )}>
        <Icon className={cn('h-3.5 w-3.5', tone === 'emerald' ? 'text-emerald-600' : 'text-slate-500')} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] text-slate-400">{label}</p>
        <p className={cn(
          'truncate text-[13px] font-semibold',
          tone === 'emerald' ? 'text-emerald-600' : 'text-slate-800',
        )}>
          {value}
        </p>
      </div>
    </div>
  )
}

/** A label/value pair in the Business details grid. */
function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={cn('mt-0.5 truncate text-[13.5px] font-semibold text-slate-800', mono && 'font-mono text-[12.5px]')}>
        {value}
      </p>
    </div>
  )
}

/** One row in the read-only credentials summary — same shape as Profile's
 *  InfoRow (icon square, label above value, optional pill on the right),
 *  kept local since it's only used here. */
function CredentialRow({ icon: Icon, label, right, children }: {
  icon: React.ElementType
  label: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3.5 px-6 py-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#EEF0FF]">
        <Icon className="h-4 w-4 text-[#5B6CF9]" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium text-slate-400">{label}</p>
        <div className="text-[13.5px] font-semibold text-slate-800 mt-0.5 truncate">{children}</div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  )
}

/** Small green/amber configured-or-not pill for a CredentialRow's right side. */
function ConfiguredPill({ ok, label }: { ok: boolean; label: string }) {
  return ok ? (
    <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-600">
      <CheckCircle2 className="h-3 w-3" /> {label}
    </span>
  ) : (
    <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-600">
      <AlertTriangle className="h-3 w-3" /> {label}
    </span>
  )
}

/** A section's icon-square accent — defaults to the app's standard brand
 *  violet (matching Security/Profile), overridable for the rare card that
 *  needs to signal something else (e.g. amber for the PIN-security tile). */
function SectionCard({ icon: Icon, accentBg = '#EEF0FF', accentColor = '#5B6CF9', title, description, statusPill, children, footer }: {
  icon?: React.ElementType
  accentBg?: string
  accentColor?: string
  title: string
  description?: string
  statusPill?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-start gap-3 px-6 py-4 border-b border-slate-100">
        {Icon && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: accentBg }}>
            <Icon className="h-4.5 w-4.5" style={{ color: accentColor }} />
          </span>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-semibold text-slate-800">{title}</h3>
          {description && <p className="text-[12px] text-slate-500 mt-0.5 leading-relaxed">{description}</p>}
        </div>
        {statusPill && <div className="shrink-0">{statusPill}</div>}
      </div>
      <div className="px-6 py-5 space-y-4">{children}</div>
      {footer && (
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/70 rounded-b-2xl">
          {footer}
        </div>
      )}
    </div>
  )
}

export function WhatsAppConfig({ defaultConnectMethod = 'quick' }: { defaultConnectMethod?: 'quick' | 'manual' }) {
  const { userId, accountId, loading: authLoading, profileLoading } = useAuth();
  const confirm = useConfirm();
  const reduceMotion = useReducedMotion();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [keysDialogOpen, setKeysDialogOpen] = useState(false);
  const [connectMethod, setConnectMethod] = useState<'quick' | 'manual'>(defaultConnectMethod);
  // The API Credentials card opens on a read-only summary once a config
  // exists (mirrors Profile's Personal Information card) — this only
  // controls whether the summary shows instead; the actual form always
  // renders when there's no config yet at all (nothing to summarize).
  const [credentialsEditing, setCredentialsEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [config, setConfig] = useState<WhatsAppConfigType | null>(null);
  const [phoneInfo, setPhoneInfo] = useState<PhoneInfo | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [businessProfile, setBusinessProfile] = useState<BusinessProfile | null>(null);
  // The connected view opens on the at-a-glance overview; "Manage
  // Connection" switches to the full credential/webhook/test panels
  // (everything that used to be the whole connected view).
  const [overviewMode, setOverviewMode] = useState(true);
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
  // No config yet → there's nothing to summarize, the form is always on.
  const showCredentialsForm = !config || credentialsEditing;

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
      setPhoneInfo(payload.phone_info ?? null);
      setUsage(payload.usage ?? null);

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

  // The exact configured WhatsApp Business Profile (About text + profile
  // photo) for the overview's Business details card — a separate endpoint
  // from the connection config above, so it's fetched once we know we're
  // actually connected rather than bundled into fetchConfig.
  useEffect(() => {
    if (connectionStatus !== 'connected') { setBusinessProfile(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/whatsapp/profile');
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json.profile) {
          setBusinessProfile({ about: json.profile.about ?? '', profile_picture_url: json.profile.profile_picture_url });
        }
      } catch {
        // Business Profile is a nice-to-have on the overview — the
        // connection status itself doesn't depend on it.
      }
    })();
    return () => { cancelled = true; };
  }, [connectionStatus]);

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
      setCredentialsEditing(false);
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
      setCredentialsEditing(false);
    } catch {
      toast.error('Failed to reset configuration');
    } finally {
      setResetting(false);
    }
  }

  /** Discards in-progress edits to an existing config and returns to the
   *  read-only summary — mirrors Profile's Personal Information Cancel. */
  function cancelCredentialsEdit() {
    setCredentialsEditing(false);
    if (config) {
      setPhoneNumberId(config.phone_number_id || '');
      setWabaId(config.waba_id || '');
      setAccessToken(MASKED_TOKEN);
      setVerifyToken('');
      setPin('');
      setTokenEdited(false);
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

  // ── Connected overview ── the at-a-glance dashboard shown once the
  // channel is live. Everything on it comes from data we actually have:
  // Meta's own phone metadata (name/number/quality/messaging tier), our
  // stored registration + subscription timestamps, and our own send
  // counts — nothing here is placeholder or sample data.
  if (isConnected && overviewMode) {
    const health = [
      {
        label: 'API status',
        value: isConnected ? 'Healthy' : 'Failing',
        ok: isConnected,
        icon: Wifi,
      },
      {
        label: 'Message receiving',
        value: isRegistered ? 'Registered' : 'Not registered',
        ok: isRegistered,
        icon: CheckCheck,
      },
      {
        label: 'Webhook',
        value: config?.subscribed_apps_at ? 'Active' : 'Not subscribed',
        ok: Boolean(config?.subscribed_apps_at),
        icon: Globe,
      },
      {
        label: 'Quality rating',
        value: phoneInfo?.quality_rating
          ? phoneInfo.quality_rating.charAt(0) + phoneInfo.quality_rating.slice(1).toLowerCase()
          : 'Not reported',
        ok: !phoneInfo?.quality_rating || phoneInfo.quality_rating.toUpperCase() === 'GREEN',
        icon: Gauge,
      },
    ];
    const allHealthy = health.every((h) => h.ok);
    const tierCap = phoneInfo?.messaging_limit_tier
      ? (phoneInfo.messaging_limit_tier === 'TIER_UNLIMITED' ? null : TIER_CAP[phoneInfo.messaging_limit_tier] ?? null)
      : null;
    const usedPct = tierCap && usage ? Math.min(100, Math.round((usage.sentLast24h / tierCap) * 100)) : null;

    return (
      <div className="space-y-5">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-br from-[#F0FDF5] via-[#F6FEF9] to-[#EEFBF3] p-7">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            <div className="relative shrink-0">
              <span className="flex h-28 w-28 items-center justify-center rounded-full bg-white shadow-[0_10px_30px_rgba(16,185,129,0.18)] ring-8 ring-emerald-50">
                <WhatsAppIcon className="h-16 w-16" />
              </span>
              <span className="absolute -right-1 bottom-1 flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 ring-4 ring-white">
                <CheckCircle2 className="h-5 w-5 text-white" />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-bold text-emerald-700">
                  Connected
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
                  {config?.connect_method === 'quick'
                    ? <><MousePointerClick className="h-3 w-3" />via Quick Connect</>
                    : <><Settings2 className="h-3 w-3" />via Manual Setup</>}
                </span>
              </div>
              <h2 className="mt-3 text-[22px] font-bold tracking-tight text-slate-900">WhatsApp is connected</h2>
              <p className="mt-1.5 text-[13px] text-slate-500">
                Your WhatsApp Business account is connected and ready to use.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOverviewMode(false)}
                  className="h-10 px-4 text-[13px] border-slate-200 bg-white"
                >
                  <Settings2 className="h-4 w-4" />
                  Manage Connection
                </Button>
                <Button
                  type="button"
                  onClick={handleReset}
                  disabled={resetting}
                  className="h-10 px-4 text-[13px] bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {resetting ? <><Loader2 className="h-4 w-4 animate-spin" />Disconnecting…</> : 'Disconnect'}
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 rounded-xl border border-emerald-100 bg-white/70 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
            <HeroStat icon={CheckCircle2} label="Connection status" value="Active" tone="emerald" />
            <HeroStat icon={Phone} label="Phone number" value={phoneInfo?.display_phone_number ?? '—'} />
            <HeroStat
              icon={CalendarClock}
              label="Connected on"
              value={config?.connected_at
                ? new Date(config.connected_at).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
                : config?.registered_at
                ? new Date(config.registered_at).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
                : '—'}
            />
            <HeroStat icon={UserRound} label="Connected by" value={config?.connected_by ?? '—'} />
          </div>
        </div>

        {/* Connection health */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[14px] font-semibold text-slate-800">Connection health</h3>
              <p className="text-[12px] text-slate-500 mt-0.5">
                {allHealthy ? 'Everything looks good — your connection is working properly.' : 'One or more checks need attention.'}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleVerifyRegistration}
              disabled={verifyingRegistration}
              className="h-9 px-3.5 text-[12.5px] border-slate-200 shrink-0"
            >
              {verifyingRegistration ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Run test again
            </Button>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {health.map((h) => (
              <div key={h.label} className="rounded-xl border border-slate-100 bg-white px-4 py-3.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11.5px] text-slate-400">{h.label}</p>
                  {h.ok
                    ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />}
                </div>
                <p className={cn('mt-1 text-[13.5px] font-semibold', h.ok ? 'text-emerald-600' : 'text-amber-600')}>
                  {h.value}
                </p>
              </div>
            ))}
          </div>

          <div className={cn(
            'mt-4 flex items-center gap-2 rounded-xl border px-4 py-3 text-[12.5px]',
            allHealthy ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-amber-100 bg-amber-50 text-amber-700',
          )}>
            {allHealthy ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
            {allHealthy ? 'All checks passed' : 'Some checks need attention — open Manage Connection for detail.'}
          </div>

          {/* Detailed probe output, only after an explicit "Run test again" */}
          {registrationProbe && (
            <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 space-y-2">
              <p className="text-[12px] font-semibold text-slate-700">
                Latest diagnostic —{' '}
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
                      ? <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                      : <span className="h-3.5 w-3.5 rounded-full border border-slate-300 shrink-0 inline-block" />}
                    <code className="text-slate-600">{k}</code>
                  </li>
                ))}
              </ul>
              {(registrationProbe.errors ?? []).length > 0 && (
                <ul className="space-y-0.5 text-[11px] text-rose-500">
                  {registrationProbe.errors?.map((e, i) => <li key={i}>• {e}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Business details */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[14px] font-semibold text-slate-800">WhatsApp Business details</h3>
              <p className="text-[12px] text-slate-500 mt-0.5">Your connected WhatsApp Business account information.</p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOverviewMode(false)}
              className="h-9 px-3.5 text-[12.5px] border-slate-200 shrink-0"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Edit details
            </Button>
          </div>
          <div className="mt-5 flex items-start gap-5">
            {businessProfile?.profile_picture_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={businessProfile.profile_picture_url}
                alt="WhatsApp Business profile photo"
                className="hidden h-14 w-14 shrink-0 rounded-2xl object-cover ring-1 ring-slate-100 sm:block"
              />
            ) : (
              <span className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 sm:flex">
                <Building2 className="h-6 w-6 text-emerald-600" />
              </span>
            )}
            <div className="grid flex-1 grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
              <DetailField label="Business name" value={phoneInfo?.verified_name ?? '—'} />
              <DetailField label="Phone number" value={phoneInfo?.display_phone_number ?? '—'} />
              <DetailField label="WhatsApp Business ID" value={config?.waba_id ?? '—'} mono />
              <DetailField label="Phone number ID" value={config?.phone_number_id ?? '—'} mono />
              {businessProfile?.about && (
                <div className="min-w-0 sm:col-span-2">
                  <p className="text-[11px] text-slate-400">About</p>
                  <p className="mt-0.5 text-[13.5px] font-medium text-slate-700">{businessProfile.about}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Messaging limits */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
          <h3 className="text-[14px] font-semibold text-slate-800">Messaging limits</h3>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Your Meta messaging tier, alongside what this CRM has actually sent.
          </p>

          <div className="mt-5 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[11.5px] text-slate-400">Sent in the last 24 hours</p>
                {usedPct !== null && <span className="text-[11.5px] text-slate-400">{usedPct}% of tier</span>}
              </div>
              <p className="mt-1 text-[17px] font-bold text-slate-900">
                {usage ? usage.sentLast24h.toLocaleString() : '—'}
                {tierCap && <span className="text-[13px] font-medium text-slate-400"> / {tierCap.toLocaleString()}</span>}
              </p>
              {usedPct !== null && (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${usedPct}%` }} />
                </div>
              )}
            </div>
            <div>
              <p className="text-[11.5px] text-slate-400">Sent in the last 30 days</p>
              <p className="mt-1 text-[17px] font-bold text-slate-900">
                {usage ? usage.sentLast30d.toLocaleString() : '—'}
              </p>
              <p className="mt-2 text-[11.5px] text-slate-400">
                Meta tier: <span className="font-medium text-slate-600">{tierLabel(phoneInfo?.messaging_limit_tier)}</span>
              </p>
            </div>
          </div>

          <div className="mt-5 flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-[11.5px] text-slate-500">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-400" />
            <span>
              Counts are this CRM&apos;s own sent messages, not Meta&apos;s official conversation quota — Meta counts
              business-initiated <em>conversations</em> in a rolling 24-hour window, which their tier above caps.
            </span>
          </div>
        </div>

        {/* Help */}
        <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EEF0FF] text-[#5B6CF9]">
              <CircleHelp className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[13px] font-semibold text-slate-800">Need help with WhatsApp?</p>
              <p className="mt-0.5 text-[12px] text-slate-500">Meta&apos;s Cloud API documentation covers setup and troubleshooting.</p>
            </div>
          </div>
          <a
            href="https://developers.facebook.com/docs/whatsapp/cloud-api"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-[12.5px] font-semibold text-[#5B6CF9] transition hover:bg-slate-50"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View documentation
          </a>
        </div>

        <p className="flex items-center justify-center gap-1.5 pt-1 text-[11px] text-slate-400">
          <Lock className="h-3 w-3" />
          Your access token is encrypted at rest and never shown in full.
        </p>

        <KeysDialog open={keysDialogOpen} onOpenChange={setKeysDialogOpen} />
      </div>
    );
  }

  const blobMotion = reduceMotion
    ? {}
    : { animate: { y: [0, -18, 0], x: [0, 12, 0] }, transition: { duration: 7, repeat: Infinity, ease: 'easeInOut' as const } };
  const blobMotion2 = reduceMotion
    ? {}
    : { animate: { y: [0, 14, 0], x: [0, -10, 0] }, transition: { duration: 8.5, repeat: Infinity, ease: 'easeInOut' as const } };

  return (
    <div className="space-y-5">
      {!isConnected && (
        <ConnectChannelScreen
          icon={WhatsAppIcon}
          channelName="WhatsApp"
          method={connectMethod}
          onMethodChange={setConnectMethod}
          quickConnect={<EmbeddedSignupButton onConnected={() => fetchConfig('')} />}
          manualConnect={null}
        />
      )}

      {(isConnected || connectMethod === 'manual') && (
      <>
      {isConnected && (
        <Button
          type="button"
          variant="outline"
          onClick={() => setOverviewMode(true)}
          className="h-9 px-3.5 text-[12.5px] border-slate-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to overview
        </Button>
      )}

      {/* ── Hero — same gradient-card language as the Profile page's hero:
          soft violet gradient, ambient floating blobs, centered identity
          (icon instead of an avatar photo) and a status pill. ── */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-[#EEF0FF] via-[#F4F3FD] to-[#ECEAFB] px-6 py-9">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <motion.div className="absolute -left-12 -top-12 h-44 w-44 rounded-full bg-white/50 blur-2xl" {...blobMotion} />
          <motion.div className="absolute -right-6 bottom-2 h-24 w-24 rounded-full bg-white/40 blur-xl" {...blobMotion2} />
          <div className="absolute right-8 top-7 grid grid-cols-5 gap-2 opacity-40">
            {Array.from({ length: 20 }).map((_, i) => (
              <span key={i} className="h-1 w-1 rounded-full bg-[#5B6CF9]" />
            ))}
          </div>
          <svg className="absolute inset-x-0 bottom-0 h-16 w-full opacity-30" preserveAspectRatio="none" viewBox="0 0 400 60">
            <path d="M0 40 Q 100 10 200 35 T 400 30" fill="none" stroke="#5B6CF9" strokeWidth="1" />
          </svg>
        </div>

        <div className="relative flex flex-col items-center text-center">
          <span className="flex h-24 w-24 items-center justify-center rounded-full bg-white ring-4 ring-white shadow-md">
            <WhatsAppIcon className="h-12 w-12" />
          </span>
          <h2 className="mt-4 text-[19px] font-bold text-slate-900">WhatsApp API Setup</h2>
          <p className="text-[13px] text-slate-500 mt-1 max-w-sm">
            Manually manage the Meta WhatsApp Business API credentials behind this connection.
          </p>
          <div className={cn(
            'flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold mt-3',
            isConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600',
          )}>
            {isConnected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {isConnected ? 'Connected' : 'Not connected'}
          </div>
        </div>
      </div>

      {!isConnected && connectMethod === 'manual' && (
        <div className="flex items-center justify-center gap-2 pt-1 pb-2 text-[11.5px] font-medium text-slate-400">
          {[
            { n: 1, label: 'Add credentials' },
            { n: 2, label: 'Configure webhook' },
            { n: 3, label: 'Test connection' },
          ].map((step, i, arr) => (
            <span key={step.n} className="flex items-center gap-2">
              <span className="flex items-center gap-1.5">
                <span className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                  step.n === 1 ? 'bg-[#5B6CF9] text-white' : 'bg-slate-100 text-slate-400',
                )}>
                  {step.n}
                </span>
                <span className={step.n === 1 ? 'text-[#5B6CF9]' : undefined}>{step.label}</span>
              </span>
              {i < arr.length - 1 && <span className="h-px w-6 bg-slate-200" />}
            </span>
          ))}
        </div>
      )}

      {/* ── Status ── One merged green box once both connected AND
          registered (this used to be two separate stacked green boxes
          saying almost the same thing). While only one of the two is true
          yet, keep them as distinct boxes since they're reporting genuinely
          different states. */}
      {isConnected && isRegistered ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100">
            <Wifi className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-emerald-800">WhatsApp Connected &amp; Registered</p>
            <p className="text-[12px] mt-0.5 text-emerald-600">
              Authenticated with Meta and subscribed since{' '}
              {config?.registered_at ? new Date(config.registered_at).toLocaleString() : 'unknown'}. Meta will deliver events.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestConnection}
              disabled={testing}
              className="h-8 text-[12px] border-emerald-200 bg-white"
            >
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Test
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleVerifyRegistration}
              disabled={verifyingRegistration}
              className="h-8 text-[12px] border-emerald-200 bg-white"
            >
              {verifyingRegistration ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
              Verify
            </Button>
          </div>
        </div>
      ) : (
      <>
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
      </>
      )}

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
            <p className="text-[13px] font-semibold text-amber-800">Stored token can&apos;t be decrypted</p>
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

      {/* Registration status — folded into the merged green box above once
          both connected and registered, so this only covers the remaining
          "connected but not yet registered" / "not connected yet" states. */}
      {config && !(isConnected && isRegistered) && (
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

      {/* ── Config sections as tiles — API Credentials and Webhook get the
          full row (many fields / a lot of content), Encryption and Send
          Test Message sit side-by-side as smaller tiles. ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="lg:col-span-2">
      <SectionCard
        icon={KeyRound}
        title="API Credentials"
        description={showCredentialsForm
          ? "Enter your Meta WhatsApp Business API credentials from Meta Developers."
          : "Saved and encrypted — click Edit to change any of these."}
        statusPill={config && !credentialsEditing ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setCredentialsEditing(true)}
            className="h-8 px-3.5 text-[12.5px] border-slate-200"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        ) : undefined}
        footer={(showCredentialsForm || config) ? (
          <div className="flex flex-wrap items-center gap-2">
            {showCredentialsForm && (
              <Button
                onClick={handleSave}
                disabled={saving}
                className="h-9 px-5 text-[13px] bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white"
              >
                {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : 'Save Configuration'}
              </Button>
            )}
            {showCredentialsForm && !config && (
              <p className="text-[12px] text-slate-500">Save credentials first to test connection.</p>
            )}
            {showCredentialsForm && config && (
              <Button
                type="button"
                variant="outline"
                onClick={cancelCredentialsEdit}
                disabled={saving}
                className="h-9 text-[13px] border-slate-200"
              >
                Cancel
              </Button>
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
        ) : undefined}
      >
        {!showCredentialsForm ? (
          <div className="-mx-6 -my-5 divide-y divide-slate-100">
            <CredentialRow icon={Hash} label="Phone Number ID">
              <span className="font-mono">{config?.phone_number_id}</span>
            </CredentialRow>
            <CredentialRow icon={Building2} label="WhatsApp Business Account ID">
              {config?.waba_id ? <span className="font-mono">{config.waba_id}</span> : <span className="text-slate-400 font-normal">Not set</span>}
            </CredentialRow>
            <CredentialRow icon={Lock} label="Permanent Access Token">
              •••••••••••••••• <span className="text-slate-400 font-normal">(saved)</span>
            </CredentialRow>
            <CredentialRow
              icon={Shield}
              label="Webhook Verify Token"
              right={<ConfiguredPill ok={!!config?.has_verify_token} label={config?.has_verify_token ? 'Configured' : 'Not set'} />}
            >
              {config?.has_verify_token ? '••••••••' : '—'}
            </CredentialRow>
            <CredentialRow
              icon={KeyRound}
              label="2-Step Verification"
              right={<ConfiguredPill ok={isRegistered} label={isRegistered ? 'Registered' : 'Required'} />}
            >
              {isRegistered ? 'PIN accepted by Meta' : 'Not yet registered with Meta'}
            </CredentialRow>
          </div>
        ) : (
        <>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        </div>

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
        </>
        )}
      </SectionCard>
      </div>

      {/* ── Encryption Keys ── */}
      <SectionCard
        icon={Shield}
        title="WhatsApp Flows Encryption"
        description="RSA-2048 key pair for Meta WhatsApp Flows. If flow forms show errors, resync here."
      >
        <Button variant="outline" className="h-9 text-[13px] gap-2 border-slate-200" onClick={() => setKeysDialogOpen(true)}>
          <KeyRound className="h-4 w-4" />
          Manage Encryption Keys
        </Button>
      </SectionCard>

      {/* ── Test Message ── */}
      {config && (
        <SectionCard
          icon={Send}
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

      {/* ── Webhook ── */}
      <div className="lg:col-span-2">
      <SectionCard
        icon={Globe}
        title="Webhook Configuration"
        description="Paste this URL into Meta Developers → WhatsApp → Configuration → Webhooks."
      >
        {isLocalhost && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[13px] font-semibold text-amber-800">Localhost can&apos;t be reached by Meta</p>
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

        <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-2.5">
          <p className="text-[12px] font-semibold text-slate-700 flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5 text-slate-400" />
            How to configure in Meta
          </p>
          <ol className="space-y-2">
            {[
              'Meta Developers → Your App → WhatsApp → Configuration',
              'Click Edit under Webhook',
              'Paste the Callback URL above',
              'Enter the same Verify Token from the form',
              'Click Verify and Save',
              'Subscribe to the messages field',
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[12px] text-slate-600">
                <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-[#EEF0FF] text-[10px] font-bold text-[#5B6CF9] mt-px">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      </SectionCard>
      </div>
      </div>

      {/* ── Setup guide (collapsible) ── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setShowSetup((p) => !p)}
          className="w-full flex items-center gap-3 px-6 py-4 text-left transition-colors hover:bg-slate-50/70"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#EEF0FF]">
            <BookOpen className="h-4.5 w-4.5 text-[#5B6CF9]" />
          </span>
          <div className="flex-1 min-w-0">
            <h3 className="text-[14px] font-semibold text-slate-800">Setup Guide</h3>
            <p className="text-[12px] text-slate-500 mt-0.5">Step-by-step Meta WhatsApp API setup instructions</p>
          </div>
          {showSetup
            ? <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" />
            : <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />}
        </button>

        {showSetup && (
          <div className="border-t border-slate-100 px-6 py-5">
            <Stepper
              steps={[
                {
                  title: 'Create a Meta App',
                  children: 'Go to developers.facebook.com → "My Apps" → "Create App" → select "Business" as the app type → fill in the details and create.',
                },
                {
                  title: 'Add WhatsApp Product',
                  children: 'In your app dashboard, click "Add Product", find "WhatsApp" and click "Set Up", then follow the wizard to link your business.',
                },
                {
                  title: 'Get API Credentials',
                  children: 'Go to WhatsApp → API Setup. Copy your Phone Number ID and WhatsApp Business Account ID, then generate a Permanent Access Token from Business Settings → System Users.',
                },
                {
                  title: 'Configure Webhooks',
                  children: 'Go to WhatsApp → Configuration in Meta Developers, click Edit on the Webhook section, paste your Callback URL (above), enter the same Verify Token, click Verify and Save, then subscribe to the messages field.',
                },
              ]}
            />
            <a
              href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-[#5B6CF9] hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Meta WhatsApp API Documentation
            </a>
          </div>
        )}
      </div>

      </>
      )}

      <KeysDialog open={keysDialogOpen} onOpenChange={setKeysDialogOpen} />
    </div>
  );
}
