'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Copy, CheckCircle2, Loader2, Zap, AlertTriangle, RotateCcw, Info, Terminal,
  Globe, KeyRound, Hash, Wifi, WifiOff, ChevronDown, ChevronUp, Radio, Clock,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useConfirm } from '@/hooks/use-confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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

function SectionCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100">
        <h3 className="text-[14px] font-semibold text-slate-800">{title}</h3>
        {description && <p className="text-[12px] text-slate-500 mt-0.5">{description}</p>}
      </div>
      <div className="px-6 py-5 space-y-4">{children}</div>
    </div>
  )
}

export function RcsConfig() {
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
  const [copied, setCopied] = useState(false);

  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [authTokenEdited, setAuthTokenEdited] = useState(false);
  const [messagingServiceSid, setMessagingServiceSid] = useState('');
  const [rcsAgentId, setRcsAgentId] = useState('');
  const [fromNumber, setFromNumber] = useState('');

  const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/rcs/webhook` : '';
  const isLocalhost = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || !webhookUrl.startsWith('https://')
  );

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rcs/config');
      const payload = await res.json();
      const data = payload.config ?? null;
      setHasConfig(Boolean(data));
      if (data) {
        setAccountSid(data.account_sid || '');
        setAuthToken(MASKED);
        setAuthTokenEdited(false);
        setMessagingServiceSid(data.messaging_service_sid || '');
        setRcsAgentId(data.rcs_agent_id || '');
        setFromNumber(data.from_number || '');
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
    if (!hasConfig && (!accountSid.trim() || !authToken.trim())) {
      toast.error('Account SID and Auth Token are required');
      return;
    }
    if (!messagingServiceSid.trim() && !fromNumber.trim()) {
      toast.error('Either a Messaging Service SID or a From Number is required');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/rcs/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_sid: accountSid,
          auth_token: authTokenEdited || !hasConfig ? authToken : undefined,
          messaging_service_sid: messagingServiceSid || null,
          from_number: fromNumber || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to save'); return; }
      toast.success('RCS configuration saved');
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
    const ok = await confirm({ title: 'Reset RCS configuration?', description: 'This removes your saved Twilio credentials. You will need to re-enter them.' });
    if (!ok) return;
    setResetting(true);
    try {
      await fetch('/api/rcs/config', { method: 'DELETE' });
      toast.success('Configuration reset');
      setHasConfig(false);
      setAuthToken('');
      setAuthTokenEdited(false);
      setConnectionStatus('unknown');
      fetchConfig();
    } finally {
      setResetting(false);
    }
  };

  const handleCopyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    toast.success('Webhook URL copied');
    setTimeout(() => setCopied(false), 1500);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
  }

  const isConnected = connectionStatus === 'connected';

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
            {isConnected ? 'RCS Connected (Twilio)' : 'Not Connected'}
          </p>
          <p className={cn('text-[12px] mt-0.5', isConnected ? 'text-emerald-600' : 'text-slate-500')}>
            {statusMessage || 'Configure your Twilio credentials below to get started.'}
          </p>
        </div>
        {hasConfig && (
          <Button variant="outline" size="sm" onClick={handleTest} disabled={testing} className="h-8 text-[12px] border-slate-200 bg-white shrink-0">
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            Test
          </Button>
        )}
      </div>

      <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-4 flex items-start gap-3">
        <Clock className="h-4.5 w-4.5 text-indigo-500 mt-0.5 shrink-0" />
        <p className="text-[12px] text-indigo-700 leading-relaxed">
          Real carrier/agent approval for RCS is a separate process on Twilio&apos;s side and typically takes
          <strong> 4-6 weeks</strong>. Messages still send via SMS/MMS fallback while approval is pending — configure
          and test the connection below now, and start the RCS agent approval application in your Twilio console
          right away so it&apos;s ready when the code is.
        </p>
      </div>

      {resetReason === 'token_corrupted' && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-[13px] font-semibold text-amber-800">Stored auth token can&apos;t be decrypted</p>
            <p className="text-[12px] text-amber-700 mt-0.5">{statusMessage}</p>
            <Button variant="outline" size="sm" onClick={handleReset} disabled={resetting} className="h-7 mt-2 text-[11px] border-amber-300 bg-white">
              {resetting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
              Reset Configuration
            </Button>
          </div>
        </div>
      )}

      {/* ── Credentials ── */}
      <SectionCard title="Twilio Credentials" description="From your Twilio Console → Account → API keys & tokens.">
        <div className="grid grid-cols-2 gap-4">
          <FieldRow id="rcs-account-sid" label="Account SID" icon={Hash}>
            <Input id="rcs-account-sid" value={accountSid} onChange={(e) => setAccountSid(e.target.value)} placeholder="ACxxxxxxxxxxxxxxxx" className="h-9 text-[13px] font-mono border-slate-200" />
          </FieldRow>
          <FieldRow id="rcs-auth-token" label="Auth Token" icon={KeyRound}>
            <Input
              id="rcs-auth-token"
              type="password"
              value={authToken}
              onChange={(e) => { setAuthToken(e.target.value); setAuthTokenEdited(true); }}
              onFocus={() => { if (authToken === MASKED) { setAuthToken(''); setAuthTokenEdited(true); } }}
              placeholder="Your Twilio auth token"
              className="h-9 text-[13px] font-mono border-slate-200"
            />
          </FieldRow>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FieldRow id="rcs-messaging-service" label="Messaging Service SID" icon={Radio} hint="Recommended — lets Twilio pick RCS/SMS/MMS automatically per recipient.">
            <Input id="rcs-messaging-service" value={messagingServiceSid} onChange={(e) => setMessagingServiceSid(e.target.value)} placeholder="MGxxxxxxxxxxxxxxxx" className="h-9 text-[13px] font-mono border-slate-200" />
          </FieldRow>
          <FieldRow id="rcs-from-number" label="From Number (fallback)" icon={Hash} hint="Used only if no Messaging Service SID is set.">
            <Input id="rcs-from-number" value={fromNumber} onChange={(e) => setFromNumber(e.target.value)} placeholder="+15551234567" className="h-9 text-[13px] font-mono border-slate-200" />
          </FieldRow>
        </div>
        <FieldRow id="rcs-agent-id" label="RCS Agent ID" icon={Radio} hint="Fill this in once Twilio/Google approves your RCS agent.">
          <Input id="rcs-agent-id" value={rcsAgentId} onChange={(e) => setRcsAgentId(e.target.value)} placeholder="Optional, pending approval" className="h-9 text-[13px] font-mono border-slate-200" />
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
      <SectionCard title="Webhook Configuration" description="Set this as the Messaging Service's inbound webhook URL in Twilio Console.">
        {isLocalhost && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[13px] font-semibold text-amber-800">Localhost can&apos;t be reached by Twilio</p>
                <p className="text-[12px] text-amber-700 mt-0.5 leading-relaxed">You need a public HTTPS URL. Use ngrok for quick local testing — Twilio Console also has a request-replay tool for testing without a live agent.</p>
              </div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-white p-3 space-y-2">
              <div className="flex items-center gap-1.5">
                <Terminal className="h-3.5 w-3.5 text-amber-600" />
                <p className="text-[12px] font-semibold text-amber-700">Quick setup with ngrok</p>
              </div>
              <ol className="space-y-1.5 text-[12px] text-slate-700">
                {['Install ngrok from ngrok.com (free)', 'Run: ngrok http 3000', 'Copy the https://xxxx.ngrok.io URL', 'Use https://xxxx.ngrok.io/api/rcs/webhook as your Messaging Service webhook URL'].map((step, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700 mt-0.5">{i + 1}</span>
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
            Webhook URL
            {isLocalhost && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-600">Not public</span>}
          </Label>
          <div className="flex gap-2">
            <Input readOnly value={webhookUrl} className="h-9 text-[13px] bg-slate-50 border-slate-200 font-mono text-slate-600" />
            <Button variant="outline" size="icon" onClick={handleCopyWebhookUrl} className="h-9 w-9 shrink-0 border-slate-200" title="Copy URL">
              {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          {!isLocalhost && (
            <p className="text-[11px] text-emerald-600 flex items-center gap-1.5">
              <CheckCircle2 className="h-3 w-3 shrink-0" />Public HTTPS URL — Twilio can reach it.
            </p>
          )}
        </div>
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
                'Sign up at twilio.com and copy your Account SID and Auth Token from the Console dashboard.',
                'Create a Messaging Service and add a phone number to its sender pool.',
                'Apply for RCS Business Messaging in the Twilio Console — approval typically takes 4-6 weeks; start this early.',
                'Paste the Account SID, Auth Token, and Messaging Service SID above and save.',
                'Set the Webhook URL above as the Messaging Service’s "Incoming Messages" webhook.',
                'Once approved, paste the RCS Agent ID above so rich content (buttons, cards) becomes available.',
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
