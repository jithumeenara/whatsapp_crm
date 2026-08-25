'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Copy, CheckCircle2, Loader2, Zap, AlertTriangle, RotateCcw, Info, Terminal,
  Globe, KeyRound, Hash, Wifi, WifiOff, ChevronDown, ChevronUp, MessageSquare, ShieldCheck,
  Smartphone, Send, Webhook,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useConfirm } from '@/hooks/use-confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const MASKED = '••••••••••••••••';

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';
type SmsProvider = 'msg91' | 'textbee';

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

const PROVIDER_META: Record<SmsProvider, { label: string; keyLabel: string }> = {
  msg91: { label: 'MSG91', keyLabel: 'Auth Key' },
  textbee: { label: 'TextBee', keyLabel: 'API Key' },
};

export function SmsConfig() {
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

  // Provider tab — switching before saving just changes which fields show;
  // the actual saved provider only changes once "Save Configuration" runs.
  const [provider, setProvider] = useState<SmsProvider>('msg91');
  const [savedProvider, setSavedProvider] = useState<SmsProvider | null>(null);

  const [authKey, setAuthKey] = useState('');
  const [authKeyEdited, setAuthKeyEdited] = useState(false);
  const [senderId, setSenderId] = useState('');
  const [route, setRoute] = useState('4');
  const [dltEntityId, setDltEntityId] = useState('');
  const [dltTemplateId, setDltTemplateId] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [textbeeWebhookRegistered, setTextbeeWebhookRegistered] = useState(false);

  const [testNumber, setTestNumber] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

  const webhookUrl = typeof window !== 'undefined' && webhookSecret
    ? `${window.location.origin}/api/sms/webhook/${webhookSecret}`
    : '';
  const isLocalhost = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || (webhookUrl !== '' && !webhookUrl.startsWith('https://'))
  );

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sms/config');
      const payload = await res.json();
      const data = payload.config ?? null;
      setHasConfig(Boolean(data));
      if (data) {
        const p: SmsProvider = data.provider === 'textbee' ? 'textbee' : 'msg91';
        setProvider(p);
        setSavedProvider(p);
        setAuthKey(MASKED);
        setAuthKeyEdited(false);
        setSenderId(data.sender_id || '');
        setRoute(data.route || '4');
        setDltEntityId(data.dlt_entity_id || '');
        setDeviceId(data.device_id || '');
        setWebhookSecret(data.webhook_secret || '');
        setTextbeeWebhookRegistered(Boolean(data.textbee_webhook_registered));
      } else {
        setSavedProvider(null);
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

  function switchProvider(p: SmsProvider) {
    if (p === provider) return;
    setProvider(p);
    // A saved secret for the OTHER provider should never be silently reused
    // as-is for this one (different service, different key) — clear it so
    // the masked placeholder doesn't imply a key that isn't actually valid
    // here yet, unless the account is already saved on this exact provider.
    if (savedProvider !== p) {
      setAuthKey('');
      setAuthKeyEdited(true);
    } else {
      setAuthKey(MASKED);
      setAuthKeyEdited(false);
    }
  }

  const handleSave = async () => {
    if (!authKey.trim() || (hasConfig && provider === savedProvider && !authKeyEdited && authKey === MASKED)) {
      if (!(hasConfig && provider === savedProvider)) {
        toast.error(provider === 'textbee' ? 'API key is required' : 'Auth key is required');
        return;
      }
    }
    setSaving(true);
    try {
      const usingSavedKey = hasConfig && provider === savedProvider && !authKeyEdited && authKey === MASKED;
      const res = await fetch('/api/sms/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          auth_key: usingSavedKey ? undefined : authKey,
          sender_id: senderId || null,
          route,
          dlt_entity_id: dltEntityId || null,
          dlt_template_id: dltTemplateId || null,
          device_id: deviceId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to save'); return; }
      if (data.webhook_secret) setWebhookSecret(data.webhook_secret);
      if (data.webhook_warning) toast.warning(data.webhook_warning, { duration: 8000 });
      toast.success(`${PROVIDER_META[provider].label} configuration saved`);
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

  const handleSendTest = async () => {
    if (!testNumber.trim()) { toast.error('Enter a phone number to send the test message to'); return; }
    setSendingTest(true);
    try {
      const res = await fetch('/api/sms/config/test-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testNumber.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to send test message'); return; }
      toast.success(data.message || 'Test message sent');
    } catch {
      toast.error('Failed to send test message');
    } finally {
      setSendingTest(false);
    }
  };

  const handleReset = async () => {
    const ok = await confirm({ title: 'Reset SMS configuration?', description: `This removes your saved ${PROVIDER_META[savedProvider ?? provider].label} credentials. You will need to re-enter them.` });
    if (!ok) return;
    setResetting(true);
    try {
      await fetch('/api/sms/config', { method: 'DELETE' });
      toast.success('Configuration reset');
      setHasConfig(false);
      setSavedProvider(null);
      setAuthKey('');
      setAuthKeyEdited(false);
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
  const activeProviderLabel = PROVIDER_META[savedProvider ?? provider].label;

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
            {isConnected ? `SMS Connected (${activeProviderLabel})` : 'Not Connected'}
          </p>
          <p className={cn('text-[12px] mt-0.5', isConnected ? 'text-emerald-600' : 'text-slate-500')}>
            {statusMessage || 'Pick a provider and enter your credentials below to get started.'}
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
            <p className="text-[13px] font-semibold text-amber-800">Stored key can&apos;t be decrypted</p>
            <p className="text-[12px] text-amber-700 mt-0.5">{statusMessage}</p>
            <Button variant="outline" size="sm" onClick={handleReset} disabled={resetting} className="h-7 mt-2 text-[11px] border-amber-300 bg-white">
              {resetting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
              Reset Configuration
            </Button>
          </div>
        </div>
      )}

      {/* ── Provider tabs ── */}
      <div className="flex gap-1.5 rounded-xl bg-slate-100 p-1">
        {(['msg91', 'textbee'] as SmsProvider[]).map((p) => (
          <button key={p} type="button" onClick={() => switchProvider(p)}
            className={cn('flex-1 rounded-lg py-2 text-[13px] font-semibold transition-all',
              provider === p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
            {PROVIDER_META[p].label}
            {savedProvider === p && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle" />}
          </button>
        ))}
      </div>

      {/* ── Credentials ── */}
      {provider === 'msg91' ? (
        <SectionCard title="MSG91 Credentials" description="From your MSG91 dashboard → API → Auth Key.">
          <FieldRow id="sms-auth-key" label="Auth Key" icon={KeyRound}>
            <Input
              id="sms-auth-key"
              type="password"
              value={authKey}
              onChange={(e) => { setAuthKey(e.target.value); setAuthKeyEdited(true); }}
              onFocus={() => { if (authKey === MASKED) { setAuthKey(''); setAuthKeyEdited(true); } }}
              placeholder="Your MSG91 auth key"
              className="h-9 text-[13px] font-mono border-slate-200"
            />
          </FieldRow>
          <div className="grid grid-cols-2 gap-4">
            <FieldRow id="sms-sender" label="Sender ID" icon={Hash} hint="6-char DLT-approved sender ID (e.g. ACSTIK).">
              <Input id="sms-sender" value={senderId} onChange={(e) => setSenderId(e.target.value)} placeholder="ACSTIK" className="h-9 text-[13px] border-slate-200" />
            </FieldRow>
            <FieldRow id="sms-route" label="Route" icon={MessageSquare} hint="MSG91 transactional route (default 4).">
              <Input id="sms-route" value={route} onChange={(e) => setRoute(e.target.value)} placeholder="4" className="h-9 text-[13px] border-slate-200" />
            </FieldRow>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FieldRow id="sms-dlt-entity" label="DLT Entity ID" icon={ShieldCheck} hint="Your registered DLT Principal Entity ID (India compliance).">
              <Input id="sms-dlt-entity" value={dltEntityId} onChange={(e) => setDltEntityId(e.target.value)} placeholder="Optional" className="h-9 text-[13px] border-slate-200" />
            </FieldRow>
            <FieldRow id="sms-dlt-template" label="DLT Template ID" icon={ShieldCheck} hint="Default template ID for outbound messages, if required.">
              <Input id="sms-dlt-template" value={dltTemplateId} onChange={(e) => setDltTemplateId(e.target.value)} placeholder="Optional" className="h-9 text-[13px] border-slate-200" />
            </FieldRow>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button onClick={handleSave} disabled={saving} className="h-9 text-[13px] bg-indigo-600 hover:bg-indigo-700 text-white">
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : 'Save Configuration'}
            </Button>
            {hasConfig && savedProvider === 'msg91' && (
              <Button variant="outline" size="sm" onClick={handleReset} disabled={resetting} className="h-9 text-[12px] border-slate-200">
                <RotateCcw className="h-3.5 w-3.5" />Reset
              </Button>
            )}
          </div>
        </SectionCard>
      ) : (
        <SectionCard title="TextBee Credentials" description="From your TextBee dashboard → API Keys. Uses your Android phone as the SMS gateway — see textbee.dev/docs.">
          <FieldRow id="sms-api-key" label="API Key" icon={KeyRound}>
            <Input
              id="sms-api-key"
              type="password"
              value={authKey}
              onChange={(e) => { setAuthKey(e.target.value); setAuthKeyEdited(true); }}
              onFocus={() => { if (authKey === MASKED) { setAuthKey(''); setAuthKeyEdited(true); } }}
              placeholder="Your TextBee API key"
              className="h-9 text-[13px] font-mono border-slate-200"
            />
          </FieldRow>
          <FieldRow id="sms-device-id" label="Device ID" icon={Smartphone} hint="Optional — defaults to your default device, or your most recently active enabled device.">
            <Input id="sms-device-id" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="Optional — from TextBee dashboard → Devices" className="h-9 text-[13px] border-slate-200" />
          </FieldRow>
          <div className="flex items-center gap-2 pt-1">
            <Button onClick={handleSave} disabled={saving} className="h-9 text-[13px] bg-indigo-600 hover:bg-indigo-700 text-white">
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : 'Save Configuration'}
            </Button>
            {hasConfig && savedProvider === 'textbee' && (
              <Button variant="outline" size="sm" onClick={handleReset} disabled={resetting} className="h-9 text-[12px] border-slate-200">
                <RotateCcw className="h-3.5 w-3.5" />Reset
              </Button>
            )}
          </div>
        </SectionCard>
      )}

      {/* ── Send test message ── */}
      {hasConfig && (
        <SectionCard title="Send Test Message" description={`Sends a real SMS through ${activeProviderLabel} to confirm the whole pipeline works end to end.`}>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <FieldRow id="sms-test-number" label="Phone number" icon={Send}>
                <Input id="sms-test-number" value={testNumber} onChange={(e) => setTestNumber(e.target.value)} placeholder="+91XXXXXXXXXX" className="h-9 text-[13px] font-mono border-slate-200" />
              </FieldRow>
            </div>
            <Button onClick={handleSendTest} disabled={sendingTest} className="h-9 text-[13px] bg-slate-900 hover:bg-slate-800 text-white shrink-0">
              {sendingTest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send Test
            </Button>
          </div>
        </SectionCard>
      )}

      {/* ── Webhook ── */}
      <SectionCard
        title="Webhook Configuration"
        description={provider === 'textbee'
          ? 'Auto-registered with TextBee on save — inbound SMS replies flow straight into your Inbox.'
          : "Paste this URL into your MSG91 dashboard's inbound SMS webhook setting."}
      >
        {isLocalhost && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[13px] font-semibold text-amber-800">Localhost can&apos;t be reached by {activeProviderLabel}</p>
                <p className="text-[12px] text-amber-700 mt-0.5 leading-relaxed">You need a public HTTPS URL. Use ngrok for quick local testing.</p>
              </div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-white p-3 space-y-2">
              <div className="flex items-center gap-1.5">
                <Terminal className="h-3.5 w-3.5 text-amber-600" />
                <p className="text-[12px] font-semibold text-amber-700">Quick setup with ngrok</p>
              </div>
              <ol className="space-y-1.5 text-[12px] text-slate-700">
                {['Install ngrok from ngrok.com (free)', 'Run: ngrok http 3000', 'Copy the https://xxxx.ngrok.io URL', 'Save your SMS configuration again once running behind that URL so the webhook re-registers against it.'].map((step, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700 mt-0.5">{i + 1}</span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
        {webhookSecret ? (
          <div className="space-y-1.5">
            <Label className="text-[13px] font-medium text-slate-700 flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 text-slate-400" />
              Inbound Webhook URL
              {isLocalhost && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-600">Not public</span>}
            </Label>
            <div className="flex gap-2">
              <Input readOnly value={webhookUrl} className="h-9 text-[13px] bg-slate-50 border-slate-200 font-mono text-slate-600" />
              <Button variant="outline" size="icon" onClick={handleCopyWebhookUrl} className="h-9 w-9 shrink-0 border-slate-200" title="Copy URL">
                {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            {provider === 'textbee' && !isLocalhost && (
              <p className={cn('text-[11px] flex items-center gap-1.5', textbeeWebhookRegistered ? 'text-emerald-600' : 'text-amber-600')}>
                {textbeeWebhookRegistered ? <CheckCircle2 className="h-3 w-3 shrink-0" /> : <AlertTriangle className="h-3 w-3 shrink-0" />}
                {textbeeWebhookRegistered
                  ? 'Registered with TextBee — signed with HMAC-SHA256, verified on every inbound request.'
                  : "Not yet registered with TextBee — save again, or add it manually in TextBee's dashboard → Webhooks."}
              </p>
            )}
            {provider === 'msg91' && !isLocalhost && (
              <p className="text-[11px] text-emerald-600 flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3 shrink-0" />Public HTTPS URL — MSG91 can reach it.
              </p>
            )}
          </div>
        ) : (
          <p className="text-[12px] text-slate-400">Save your configuration first — the webhook URL includes a per-account security token generated at that point.</p>
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
              {(provider === 'msg91' ? [
                'Sign up at msg91.com and copy your Auth Key from API → Authkey.',
                'Register a 6-character Sender ID and complete India DLT registration (Principal Entity ID + Template IDs) — required for reliable delivery to Indian numbers.',
                'Paste the Auth Key, Sender ID, and DLT Entity ID above and save.',
                'In your MSG91 dashboard, set the inbound SMS webhook to the URL above so replies flow back into this CRM.',
              ] : [
                'Install the TextBee app on an Android phone (a spare phone with a SIM works well) and sign in at textbee.dev to register it as a device.',
                'On that phone, turn on Receive SMS / Enable Receiving in the TextBee app settings — otherwise inbound messages never reach you.',
                'Copy your API Key from the TextBee dashboard → API Keys, paste it above, and save.',
                'The inbound webhook is registered with TextBee automatically on save (needs a public HTTPS URL, not localhost) — no manual dashboard step needed.',
                'Send a test message below to confirm outbound works, then text that number from another phone to confirm inbound lands in your Inbox.',
              ]).map((step, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="shrink-0 font-semibold text-slate-400">{i + 1}.</span>
                  {step}
                </li>
              ))}
            </ol>
            {provider === 'textbee' && (
              <a href="https://textbee.dev/docs" target="_blank" rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-indigo-600 hover:text-indigo-800">
                <Webhook className="h-3.5 w-3.5" /> Full TextBee docs ↗
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
