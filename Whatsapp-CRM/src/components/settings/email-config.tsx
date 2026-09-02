'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Copy, CheckCircle2, Loader2, Zap, AlertTriangle, RotateCcw, Info, Terminal,
  Globe, KeyRound, Mail, Wifi, WifiOff, ChevronDown, ChevronUp, UserRound, Webhook,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useConfirm } from '@/hooks/use-confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { tileAccent } from '@/components/settings/settings-ui-kit';

const MASKED = '••••••••••••••••';

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(' ') }

function FieldRow({ id, label, icon: Icon, children, hint }: {
  id?: string; label: React.ReactNode; icon: React.ElementType; children: React.ReactNode; hint?: React.ReactNode
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

function SectionCard({ title, description, icon: Icon, accent, children }: {
  title: string; description?: string; icon: React.ElementType; accent: { bg: string; icon: string }; children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-start gap-3 px-6 py-4 border-b border-slate-100">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: accent.bg }}>
          <Icon className="h-4.5 w-4.5" style={{ color: accent.icon }} />
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-semibold text-slate-800">{title}</h3>
          {description && <p className="text-[12px] text-slate-500 mt-0.5">{description}</p>}
        </div>
      </div>
      <div className="px-6 py-5 space-y-4">{children}</div>
    </div>
  )
}

export function EmailConfig() {
  const { accountId } = useAuth();
  const confirm = useConfirm();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [hasConfig, setHasConfig] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [statusMessage, setStatusMessage] = useState('');
  const [resetReason, setResetReason] = useState<'token_corrupted' | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [copiedField, setCopiedField] = useState<'webhook' | 'mx' | null>(null);

  const [apiKey, setApiKey] = useState('');
  const [apiKeyEdited, setApiKeyEdited] = useState(false);
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');
  const [inboundParseHost, setInboundParseHost] = useState('');
  const [inboundSecret, setInboundSecret] = useState('');

  const webhookUrl = typeof window !== 'undefined' && inboundSecret
    ? `${window.location.origin}/api/email/webhook/${inboundSecret}`
    : '';
  const isLocalhost = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || (webhookUrl !== '' && !webhookUrl.startsWith('https://'))
  );

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/email/config');
      const payload = await res.json();
      const data = payload.config ?? null;
      setHasConfig(Boolean(data));
      if (data) {
        setApiKey(MASKED);
        setApiKeyEdited(false);
        setFromEmail(data.from_email || '');
        setFromName(data.from_name || '');
        setInboundParseHost(data.inbound_parse_host || '');
        setInboundSecret(data.inbound_secret || '');
      }
      setConnectionStatus(payload.connected ? 'connected' : (data ? 'disconnected' : 'unknown'));
      setResetReason(payload.reason === 'token_corrupted' ? 'token_corrupted' : null);
      setStatusMessage(payload.message || '');
    } catch {
      setConnectionStatus('unknown');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (accountId) fetchConfig(); }, [accountId, fetchConfig]);

  const handleSave = async () => {
    if (!hasConfig && (!apiKey.trim() || !fromEmail.trim())) {
      toast.error('API key and From Email are required');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/email/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKeyEdited || !hasConfig ? apiKey : undefined,
          from_email: fromEmail,
          from_name: fromName || null,
          inbound_parse_host: inboundParseHost || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to save'); return; }
      if (data.inbound_secret) setInboundSecret(data.inbound_secret);
      toast.success('Email configuration saved');
      fetchConfig();
    } catch {
      toast.error('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      await fetchConfig();
      toast.success('Connection test complete — see status above');
    } finally {
      setTesting(false);
    }
  };

  const handleReset = async () => {
    const ok = await confirm({ title: 'Reset email configuration?', description: 'This removes your saved SendGrid credentials. You will need to re-enter them.' });
    if (!ok) return;
    setResetting(true);
    try {
      await fetch('/api/email/config', { method: 'DELETE' });
      toast.success('Configuration reset');
      setHasConfig(false);
      setApiKey('');
      setApiKeyEdited(false);
      setInboundSecret('');
      setConnectionStatus('unknown');
      fetchConfig();
    } finally {
      setResetting(false);
    }
  };

  const handleCopy = (text: string, field: 'webhook' | 'mx') => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast.success('Copied');
    setTimeout(() => setCopiedField(null), 1500);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
  }

  const isConnected = connectionStatus === 'connected';
  const mxTarget = 'mx.sendgrid.net';

  return (
    <div className="space-y-5">
      {/* ── Status Bar ── */}
      <div className={cn(
        'rounded-2xl border px-5 py-4 flex items-center gap-4',
        isConnected ? 'bg-emerald-50 border-emerald-200' : resetReason === 'token_corrupted' ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'
      )}>
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', isConnected ? 'bg-emerald-100' : 'bg-slate-200')}>
          {isConnected ? <Wifi className="h-5 w-5 text-emerald-600" /> : <WifiOff className="h-5 w-5 text-slate-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className={cn('text-[14px] font-semibold', isConnected ? 'text-emerald-800' : 'text-slate-700')}>
            {isConnected ? 'Email Connected (SendGrid)' : 'Not Connected'}
          </p>
          <p className={cn('text-[12px] mt-0.5', isConnected ? 'text-emerald-600' : 'text-slate-500')}>
            {statusMessage || 'Configure your SendGrid credentials below to get started.'}
          </p>
        </div>
        {hasConfig && (
          <Button variant="outline" size="sm" onClick={handleTest} disabled={testing} className="h-8 text-[12px] border-slate-200 bg-white shrink-0">
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            Test
          </Button>
        )}
      </div>

      {resetReason === 'token_corrupted' && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-[13px] font-semibold text-amber-800">Stored API key can&apos;t be decrypted</p>
            <p className="text-[12px] text-amber-700 mt-0.5">{statusMessage}</p>
            <Button variant="outline" size="sm" onClick={handleReset} disabled={resetting} className="h-7 mt-2 text-[11px] border-amber-300 bg-white">
              {resetting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
              Reset Configuration
            </Button>
          </div>
        </div>
      )}

      {/* ── Credentials ── */}
      <SectionCard title="SendGrid Credentials" description="From your SendGrid dashboard → Settings → API Keys." icon={KeyRound} accent={tileAccent(0)}>
        <FieldRow id="email-api-key" label="API Key" icon={KeyRound}>
          <Input
            id="email-api-key"
            type="password"
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); setApiKeyEdited(true); }}
            onFocus={() => { if (apiKey === MASKED) { setApiKey(''); setApiKeyEdited(true); } }}
            placeholder="SG.xxxxxxxx"
            className="h-9 text-[13px] font-mono border-slate-200"
          />
        </FieldRow>
        <div className="grid grid-cols-2 gap-4">
          <FieldRow id="email-from" label="From Email" icon={Mail} hint="Must be a SendGrid-verified sender.">
            <Input id="email-from" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="support@yourbusiness.com" className="h-9 text-[13px] border-slate-200" />
          </FieldRow>
          <FieldRow id="email-from-name" label="From Name" icon={UserRound}>
            <Input id="email-from-name" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Your Business" className="h-9 text-[13px] border-slate-200" />
          </FieldRow>
        </div>
        <FieldRow id="email-inbound-host" label="Inbound Parse Subdomain" icon={Globe} hint="e.g. reply.yourbusiness.com — the MX-configured subdomain SendGrid delivers inbound mail to.">
          <Input id="email-inbound-host" value={inboundParseHost} onChange={(e) => setInboundParseHost(e.target.value)} placeholder="reply.yourbusiness.com" className="h-9 text-[13px] font-mono border-slate-200" />
        </FieldRow>
        <div className="flex items-center gap-2 pt-1">
          <Button onClick={handleSave} disabled={saving} className="h-9 text-[13px] bg-indigo-600 hover:bg-indigo-700 text-white">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : 'Save Configuration'}
          </Button>
          {hasConfig && (
            <Button variant="outline" size="sm" onClick={handleReset} disabled={resetting} className="h-9 text-[12px] border-slate-200">
              <RotateCcw className="h-3.5 w-3.5" />Reset
            </Button>
          )}
        </div>
      </SectionCard>

      {/* ── Webhook ── */}
      <SectionCard title="Inbound Parse Webhook" description="SendGrid's Inbound Parse has no signature header — this URL's token is the security check, so keep it private." icon={Webhook} accent={tileAccent(2)}>
        {isLocalhost && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[13px] font-semibold text-amber-800">Localhost can&apos;t be reached by SendGrid</p>
                <p className="text-[12px] text-amber-700 mt-0.5 leading-relaxed">Inbound Parse needs a public HTTPS URL — sandbox mode (outbound only) doesn&apos;t help here. Use ngrok for local testing.</p>
              </div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-white p-3 space-y-2">
              <div className="flex items-center gap-1.5">
                <Terminal className="h-3.5 w-3.5 text-amber-600" />
                <p className="text-[12px] font-semibold text-amber-700">Quick setup with ngrok</p>
              </div>
              <ol className="space-y-1.5 text-[12px] text-slate-700">
                {['Install ngrok from ngrok.com (free)', 'Run: ngrok http 3000', 'Copy the https://xxxx.ngrok.io URL', 'Use it as the webhook URL below when configuring Inbound Parse'].map((step, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700 mt-0.5">{i + 1}</span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
        {inboundSecret ? (
          <div className="space-y-1.5">
            <Label className="text-[13px] font-medium text-slate-700 flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 text-slate-400" />
              Webhook URL
              {isLocalhost && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-600">Not public</span>}
            </Label>
            <div className="flex gap-2">
              <Input readOnly value={webhookUrl} className="h-9 text-[13px] bg-slate-50 border-slate-200 font-mono text-slate-600" />
              <Button variant="outline" size="icon" onClick={() => handleCopy(webhookUrl, 'webhook')} className="h-9 w-9 shrink-0 border-slate-200" title="Copy URL">
                {copiedField === 'webhook' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-[12px] text-slate-400">Save your configuration first — the webhook URL includes a per-account security token generated at that point.</p>
        )}
        {inboundParseHost && (
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-2">
            <p className="text-[12px] font-semibold text-slate-700 flex items-center gap-1.5"><Info className="h-3.5 w-3.5 text-slate-400" />MX record needed</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[12px] bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-600">{inboundParseHost} MX 10 {mxTarget}</code>
              <Button variant="outline" size="icon" onClick={() => handleCopy(mxTarget, 'mx')} className="h-8 w-8 shrink-0 border-slate-200" title="Copy MX target">
                {copiedField === 'mx' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}
      </SectionCard>

      {/* ── Setup guide ── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <button type="button" onClick={() => setShowSetup((p) => !p)} className="w-full flex items-center justify-between px-6 py-4 text-left">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 text-slate-400" />
            <span className="text-[13px] font-semibold text-slate-700">Setup guide</span>
          </div>
          {showSetup ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </button>
        {showSetup && (
          <div className="px-6 pb-5">
            <ol className="space-y-1.5 text-[12px] text-slate-600">
              {[
                'Sign up at sendgrid.com and create an API key with Mail Send permission.',
                'Verify a sender identity (single sender or domain authentication) — this becomes your From Email.',
                'Paste the API key and From Email above and save.',
                'Add the MX record shown above for your chosen inbound subdomain (e.g. reply.yourbusiness.com).',
                'In SendGrid → Settings → Inbound Parse, add that hostname and paste the Webhook URL above.',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="shrink-0 font-semibold text-slate-400">{i + 1}.</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
