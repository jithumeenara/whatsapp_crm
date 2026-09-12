'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Megaphone, MousePointerClick, FileSpreadsheet, Sparkles, LineChart,
  Clock, Eye, EyeOff, CheckCircle2, AlertTriangle, Loader2, RotateCcw,
  Pencil, Hash, Building2, Lock, WifiOff, Zap, Trash2, Database,
  Users2, RefreshCw, Code2, Copy, ClipboardCheck, Globe, Target,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmIconDialog } from '@/components/ui/confirm-icon-dialog';
import { Switch } from '@/components/ui/switch';
import { EmbeddedSignupButton } from '@/components/settings/embedded-signup-button';

type Provider = 'meta' | 'google';

const META_BLUE = '#0866FF';
const META_BLUE_SOFT = '#EAF2FF';
const MASKED_TOKEN = '••••••••••••••••';

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(' ') }

interface AdsConfig {
  id: string
  waba_id: string
  ad_account_id: string | null
  business_id: string | null
  dataset_id: string | null
  automatic_events_enabled: boolean
  status: string
  connected_at: string | null
  test_error: string | null
}

/** Two-provider rail — same pill-strip shape as Channels' ChannelRail,
 *  deliberately built to grow: Google Ads sits here already, greyed out,
 *  rather than being bolted on as an afterthought once it's real. */
function ProviderRail({ provider, onSelect }: { provider: Provider; onSelect: (p: Provider) => void }) {
  return (
    <div className="scroll-styled overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
      <div className="flex min-w-max items-center gap-1">
        <button
          type="button"
          onClick={() => onSelect('meta')}
          className={cn(
            'flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-colors',
            provider === 'meta' ? 'bg-[#EAF2FF] text-[#0866FF]' : 'text-slate-500 hover:bg-slate-50',
          )}
        >
          <Megaphone className="h-4 w-4" />
          Meta
        </button>
        <button
          type="button"
          disabled
          title="Coming later"
          className="flex cursor-not-allowed items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-slate-300"
        >
          Google Ads
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-400">SOON</span>
        </button>
      </div>
    </div>
  );
}

const FEATURES = [
  {
    icon: MousePointerClick,
    title: 'Click-to-WhatsApp attribution',
    body: "Know exactly which ad started every WhatsApp conversation, and report back when it turns into a real lead or a closed deal — not just a click.",
  },
  {
    icon: FileSpreadsheet,
    title: 'Lead Ads, synced automatically',
    body: 'Every Instant Form submission lands in Leads within seconds, mapped to a real contact — no manual export, no missed 90-day retention window.',
  },
  {
    icon: Sparkles,
    title: 'Automatic event detection',
    body: "Meta reads ad-originated conversations and flags leads and sales on its own, so attribution works from day one — before any automation is set up.",
  },
  {
    icon: LineChart,
    title: 'Ad spend, tied to real revenue',
    body: "See what each campaign actually produced in closed deals — not just clicks and cost-per-lead.",
  },
];

/** A label/value row in the connected summary — same shape used across
 *  every other channel's read-only credentials view this session. */
function InfoRow({ icon: Icon, label, children, right }: {
  icon: React.ElementType; label: string; children: React.ReactNode; right?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3.5 px-6 py-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: META_BLUE_SOFT }}>
        <Icon className="h-4 w-4" style={{ color: META_BLUE }} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium text-slate-400">{label}</p>
        <div className="text-[13.5px] font-semibold text-slate-800 mt-0.5 truncate">{children}</div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

function MetaAdsOverview() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [tokenEdited, setTokenEdited] = useState(false);

  const [config, setConfig] = useState<AdsConfig | null>(null);
  const [connected, setConnected] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  // Only relevant before a connection exists — once config is saved
  // (either way) the picker gets out of the way, same as every other
  // channel's Quick/Manual pattern in this app.
  const [connectMethod, setConnectMethod] = useState<'quick' | 'manual'>('quick');

  const [wabaId, setWabaId] = useState('');
  const [adAccountId, setAdAccountId] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [automaticEvents, setAutomaticEvents] = useState(true);

  async function fetchConfig() {
    setLoading(true);
    try {
      const res = await fetch('/api/meta-ads/config');
      const payload = await res.json();
      setConnected(!!payload.connected);
      setStatusMessage(payload.message || '');
      const data = payload.config ?? null;
      setConfig(data);
      if (data) {
        setWabaId(data.waba_id || '');
        setAdAccountId(data.ad_account_id || '');
        setBusinessId(data.business_id || '');
        setAutomaticEvents(data.automatic_events_enabled);
        setAccessToken(MASKED_TOKEN);
        setTokenEdited(false);
      } else {
        setWabaId(''); setAdAccountId(''); setBusinessId(''); setAccessToken('');
      }
    } catch {
      toast.error('Failed to load Meta Ads configuration');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchConfig(); }, []);

  const showForm = !config || editing;

  function cancelEdit() {
    setEditing(false);
    if (config) {
      setWabaId(config.waba_id || '');
      setAdAccountId(config.ad_account_id || '');
      setBusinessId(config.business_id || '');
      setAccessToken(MASKED_TOKEN);
      setTokenEdited(false);
    }
  }

  async function handleSave() {
    if (!wabaId.trim()) { toast.error('WhatsApp Business Account ID is required'); return; }
    if (!config && !accessToken.trim()) { toast.error('Access Token is required'); return; }
    if (config && !tokenEdited) { toast.error('Re-enter the Access Token to save changes'); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/meta-ads/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          waba_id: wabaId.trim(),
          ad_account_id: adAccountId.trim() || null,
          business_id: businessId.trim() || null,
          access_token: accessToken.trim(),
          automatic_events_enabled: automaticEvents,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to save'); return; }
      toast.success(data.message || 'Meta Ads connected');
      setEditing(false);
      await fetchConfig();
    } catch {
      toast.error('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      await fetchConfig();
      toast.success('Connection refreshed');
    } finally {
      setTesting(false);
    }
  }

  async function performReset() {
    setResetting(true);
    try {
      const res = await fetch('/api/meta-ads/config', { method: 'DELETE' });
      if (!res.ok) { toast.error('Failed to reset configuration'); return; }
      toast.success('Meta Ads configuration cleared');
      setResetConfirmOpen(false);
      await fetchConfig();
    } catch {
      toast.error('Failed to reset configuration');
    } finally {
      setResetting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: META_BLUE }} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-[#EAF2FF] via-[#F3F7FF] to-[#EFF6FF] px-7 py-9">
        <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
          <span
            className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-white shadow-md ring-1 ring-black/5"
            style={{ color: META_BLUE }}
          >
            <Megaphone className="h-9 w-9" />
          </span>
          <div className="min-w-0 flex-1">
            <span className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold',
              connected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600',
            )}>
              {connected ? <CheckCircle2 className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {connected ? 'Connected' : 'Not connected'}
            </span>
            <h2 className="mt-3 text-[19px] font-bold text-slate-900">Meta Ads</h2>
            <p className="mt-1 text-[13px] text-slate-500 max-w-lg">
              {connected
                ? (statusMessage || 'Facebook & Instagram advertising is connected to this CRM.')
                : 'Connect Facebook & Instagram advertising — Click-to-WhatsApp attribution, Lead Ads sync, and a real ROI dashboard.'}
            </p>
          </div>
        </div>
      </div>

      {/* Campaign-objective guidance — this app doesn't create campaigns
          (that still happens in Ads Manager), but a wrong objective is one
          of the most common, costly Click-to-Message setup mistakes, so
          this is shown regardless of connection status. */}
      <div
        className="flex items-start gap-3 rounded-2xl border px-5 py-4"
        style={{ borderColor: `${META_BLUE}33`, background: META_BLUE_SOFT }}
      >
        <Target className="mt-0.5 h-4 w-4 shrink-0" style={{ color: META_BLUE }} />
        <div className="text-[12.5px]" style={{ color: '#0d3a8c' }}>
          <p className="font-semibold">Setting up a campaign? Choose Engagement, not Traffic.</p>
          <p className="mt-1 text-slate-600">
            When creating a Click-to-WhatsApp or Click-to-Instagram campaign in Meta Ads Manager, pick the{' '}
            <b>Engagement</b> objective with the WhatsApp/Instagram destination — not Traffic or Awareness.
            Traffic optimizes for link taps, not for someone actually starting a conversation, and is Meta&apos;s
            own documented example of a common, costly mistake. This app doesn&apos;t create campaigns for you —
            that still happens in Ads Manager — this is guidance only.
          </p>
        </div>
      </div>

      {/* Quick Connect / Manual Connect — only relevant pre-connection */}
      {!config && (
        <div className="scroll-styled overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
          <div className="flex min-w-max items-center gap-1">
            <button
              type="button"
              onClick={() => setConnectMethod('quick')}
              className={cn(
                'flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-colors',
                connectMethod === 'quick' ? 'bg-[#EAF2FF] text-[#0866FF]' : 'text-slate-500 hover:bg-slate-50',
              )}
            >
              Quick Connect
              <span className={cn(
                'rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold',
                connectMethod === 'quick' ? 'bg-[#0866FF]/10 text-[#0866FF]' : 'bg-slate-200 text-slate-500',
              )}>
                Recommended
              </span>
            </button>
            <button
              type="button"
              onClick={() => setConnectMethod('manual')}
              className={cn(
                'rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-colors',
                connectMethod === 'manual' ? 'bg-[#EAF2FF] text-[#0866FF]' : 'text-slate-500 hover:bg-slate-50',
              )}
            >
              Manual Connect
            </button>
          </div>
        </div>
      )}

      {!config && connectMethod === 'quick' ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EAF2FF]">
            <Megaphone className="h-6 w-6" style={{ color: META_BLUE }} />
          </span>
          <h3 className="text-[16px] font-semibold text-slate-900">Connect with Facebook</h3>
          <p className="max-w-sm text-[12.5px] text-slate-500">
            Uses the exact same sign-in as WhatsApp Quick Connect. If this Meta App&apos;s permissions
            include ads access, your ad account and Conversions API dataset connect automatically —
            no tokens to copy.
          </p>
          <EmbeddedSignupButton
            onConnected={fetchConfig}
            className="mt-1 h-11 rounded-xl bg-[#0866FF] px-5 text-[14px] font-semibold text-white hover:bg-[#0655d1]"
          />
          <p className="mt-1 text-[11px] text-slate-400">
            Already connected WhatsApp this way? Click again to check for ad account access.
          </p>
        </div>
      ) : (config || connectMethod === 'manual') && (
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-start gap-3 px-6 py-4 border-b border-slate-100">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: META_BLUE_SOFT }}>
            <Lock className="h-4.5 w-4.5" style={{ color: META_BLUE }} />
          </span>
          <div className="flex-1 min-w-0">
            <h3 className="text-[14px] font-semibold text-slate-800">API Credentials</h3>
            <p className="text-[12px] text-slate-500 mt-0.5">
              {showForm ? 'Paste the access token from a System User with ads_management and whatsapp_business_manage_events permissions.' : 'Saved and encrypted — click Edit to change any of these.'}
            </p>
          </div>
          {config && !editing && (
            <Button type="button" variant="outline" onClick={() => setEditing(true)} className="h-8 px-3.5 text-[12.5px] border-slate-200 shrink-0">
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          )}
        </div>

        {!showForm ? (
          <div className="divide-y divide-slate-100">
            <InfoRow icon={Hash} label="WhatsApp Business Account ID">
              <span className="font-mono">{config?.waba_id}</span>
            </InfoRow>
            <InfoRow icon={Building2} label="Ad Account ID">
              {config?.ad_account_id ? <span className="font-mono">{config.ad_account_id}</span> : <span className="text-slate-400 font-normal">Not set</span>}
            </InfoRow>
            <InfoRow icon={Lock} label="Access Token">
              •••••••••••••••• <span className="text-slate-400 font-normal">(saved)</span>
            </InfoRow>
            <InfoRow
              icon={Database}
              label="Conversions API dataset"
              right={config?.dataset_id
                ? <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-600"><CheckCircle2 className="h-3 w-3" />Ready</span>
                : <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-600"><AlertTriangle className="h-3 w-3" />Not created yet</span>}
            >
              {config?.dataset_id ? <span className="font-mono text-[12px]">{config.dataset_id}</span> : (config?.test_error || 'Will be created automatically once permissions allow')}
            </InfoRow>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-[13px] font-medium text-slate-700">
                  <Hash className="h-3.5 w-3.5 text-slate-400" />
                  WhatsApp Business Account ID
                </Label>
                <Input value={wabaId} onChange={(e) => setWabaId(e.target.value)} placeholder="e.g. 100234567890456"
                  className="h-9 text-[13px] border-slate-200 font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-[13px] font-medium text-slate-700">
                  <Building2 className="h-3.5 w-3.5 text-slate-400" />
                  Ad Account ID <span className="text-slate-400 font-normal">(optional)</span>
                </Label>
                <Input value={adAccountId} onChange={(e) => setAdAccountId(e.target.value)} placeholder="e.g. act_1234567890"
                  className="h-9 text-[13px] border-slate-200 font-mono" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-[13px] font-medium text-slate-700">
                <Lock className="h-3.5 w-3.5 text-slate-400" />
                Access Token
              </Label>
              <div className="relative">
                <Input
                  type={showToken ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={accessToken}
                  onChange={(e) => { setAccessToken(e.target.value); setTokenEdited(true); }}
                  onFocus={() => { if (accessToken === MASKED_TOKEN) { setAccessToken(''); setTokenEdited(true); } }}
                  placeholder="Enter your access token"
                  className="h-9 text-[13px] border-slate-200 pr-10 font-mono"
                />
                <button type="button" onClick={() => setShowToken(!showToken)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {config && !tokenEdited && <p className="text-[11px] text-slate-400">Token hidden for security. Click to re-enter.</p>}
              <p className="text-[11px] text-slate-400">
                Needs <code className="font-mono">ads_management</code>, <code className="font-mono">whatsapp_business_manage_events</code>, and <code className="font-mono">leads_retrieval</code> — see Meta App Review requirements.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div>
                <p className="text-[13px] font-semibold text-slate-700">Automatic event detection</p>
                <p className="text-[11.5px] text-slate-500 mt-0.5">Let Meta detect leads and sales from ad conversations automatically.</p>
              </div>
              <Switch
                checked={automaticEvents}
                onCheckedChange={(v) => setAutomaticEvents(v)}
                className="shrink-0 data-[checked]:bg-[#0866FF]"
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 px-6 py-3 border-t border-slate-100 bg-slate-50/70">
          {showForm && (
            <Button type="button" onClick={handleSave} disabled={saving} className="h-9 px-5 text-[13px] text-white" style={{ background: META_BLUE }}>
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : 'Save Configuration'}
            </Button>
          )}
          {showForm && config && (
            <Button type="button" variant="outline" onClick={cancelEdit} disabled={saving} className="h-9 text-[13px] border-slate-200">Cancel</Button>
          )}
          {config && !showForm && (
            <Button type="button" variant="outline" onClick={handleTest} disabled={testing} className="h-9 text-[13px] border-slate-200">
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Test
            </Button>
          )}
          {config && (
            <Button type="button" variant="outline" onClick={() => setResetConfirmOpen(true)} disabled={resetting}
              className="h-9 text-[12px] border-red-200 text-red-600 hover:bg-red-50 ml-auto">
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
          )}
        </div>
      </div>
      )}

      {config && <LeadAdFormsManager />}
      {config && <CustomAudiencesPanel />}
      {config && <PixelPanel />}

      {/* Feature grid */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-[14px] font-semibold text-slate-800">What this unlocks</h3>
          <p className="text-[12px] text-slate-500 mt-0.5">Everything below runs on Meta&apos;s own APIs — nothing here is a third-party workaround.</p>
        </div>
        <div className="grid grid-cols-1 gap-px bg-slate-100 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-white px-6 py-5">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: META_BLUE_SOFT }}>
                  <f.icon className="h-4 w-4" style={{ color: META_BLUE }} />
                </span>
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold text-slate-800">{f.title}</p>
                  <p className="mt-1 text-[12.5px] text-slate-500 leading-relaxed">{f.body}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <ConfirmIconDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        icon={Trash2}
        tone="danger"
        title="Reset Meta Ads config?"
        description="This deletes the saved credentials and dataset link so you can re-enter them."
        actionLabel="Reset"
        actionPendingLabel="Resetting…"
        onConfirm={performReset}
        pending={resetting}
      />
    </div>
  );
}

interface LeadFormRow { id: string; name: string; is_active: boolean; submission_count: number; platform_counts?: Record<string, number> }

/** Small platform-breakdown badges for one form's leads — "mixed" and
 *  unresolved are labeled plainly rather than guessed into a single
 *  platform, since Meta genuinely gives no per-lead signal for either. */
function PlatformBreakdown({ counts }: { counts?: Record<string, number> }) {
  if (!counts || Object.keys(counts).length === 0) return null;
  const order: { key: string; label: string; className: string }[] = [
    { key: 'facebook', label: 'FB', className: 'bg-blue-50 text-blue-700' },
    { key: 'instagram', label: 'IG', className: 'bg-pink-50 text-[#b93a89]' },
    { key: 'mixed', label: 'Mixed', className: 'bg-slate-100 text-slate-500' },
    { key: 'unresolved', label: 'Unresolved', className: 'bg-slate-100 text-slate-400' },
  ];
  return (
    <div className="flex shrink-0 items-center gap-1">
      {order.filter((o) => counts[o.key]).map((o) => (
        <span
          key={o.key}
          title={o.key === 'mixed' ? "Ad set targets multiple platforms — Meta doesn't report which one this lead came from" : undefined}
          className={cn('rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold', o.className)}
        >
          {o.label} {counts[o.key]}
        </span>
      ))}
    </div>
  );
}
interface DiscoveredForm { meta_form_id: string; name: string; tracked: boolean; is_active: boolean; submission_count: number }

/** Fixes a real gap: forms used to only appear reactively, the first
 *  time a submission arrived. Now tries the "browse every form on the
 *  Page" discover endpoint first (needs Facebook connected) — showing
 *  untracked forms with an Enable button — falling back to the plain
 *  tracked-only list if Facebook isn't connected or Meta rejects the
 *  call, so this never dead-ends into an empty screen for no reason. */
function LeadAdFormsManager() {
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'discover' | 'tracked-only'>('tracked-only');
  const [discoverReason, setDiscoverReason] = useState('');
  const [pageId, setPageId] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredForm[]>([]);
  const [forms, setForms] = useState<LeadFormRow[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const discoverRes = await fetch('/api/meta-ads/lead-forms/discover');
      const discoverData = await discoverRes.json();
      if (discoverData.discoverable) {
        setMode('discover');
        setPageId(discoverData.page_id);
        setDiscovered(discoverData.forms ?? []);
      } else {
        setMode('tracked-only');
        setDiscoverReason(discoverData.reason ?? '');
        const res = await fetch('/api/meta-ads/lead-forms');
        const data = await res.json();
        setForms(data.forms ?? []);
      }
    } catch {
      toast.error('Failed to load Lead Ads forms');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function enableDiscovered(form: DiscoveredForm) {
    if (!pageId) return;
    setSavingId(form.meta_form_id);
    try {
      const res = await fetch('/api/meta-ads/lead-forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta_form_id: form.meta_form_id, name: form.name, page_id: pageId }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Now syncing "${form.name}"`);
      setDiscovered((prev) => prev.map((f) => (f.meta_form_id === form.meta_form_id ? { ...f, tracked: true, is_active: true } : f)));
    } catch {
      toast.error('Failed to enable this form');
    } finally {
      setSavingId(null);
    }
  }

  async function toggleActive(form: LeadFormRow) {
    setSavingId(form.id);
    setForms((prev) => prev.map((f) => (f.id === form.id ? { ...f, is_active: !f.is_active } : f)));
    try {
      const res = await fetch('/api/meta-ads/lead-forms', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: form.id, is_active: !form.is_active }),
      });
      if (!res.ok) throw new Error();
      toast.success(!form.is_active ? 'Form syncing resumed' : 'Form syncing paused');
    } catch {
      toast.error('Failed to update — reverting');
      setForms((prev) => prev.map((f) => (f.id === form.id ? { ...f, is_active: form.is_active } : f)));
    } finally {
      setSavingId(null);
    }
  }

  async function toggleDiscoveredActive(form: DiscoveredForm) {
    setSavingId(form.meta_form_id);
    const next = !form.is_active;
    setDiscovered((prev) => prev.map((f) => (f.meta_form_id === form.meta_form_id ? { ...f, is_active: next } : f)));
    try {
      const res = await fetch('/api/meta-ads/lead-forms', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta_form_id: form.meta_form_id, is_active: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error('Failed to update — reverting');
      setDiscovered((prev) => prev.map((f) => (f.meta_form_id === form.meta_form_id ? { ...f, is_active: !next } : f)));
    } finally {
      setSavingId(null);
    }
  }

  async function rename(form: LeadFormRow, name: string) {
    if (!name.trim() || name === form.name) return;
    try {
      await fetch('/api/meta-ads/lead-forms', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: form.id, name }),
      });
      setForms((prev) => prev.map((f) => (f.id === form.id ? { ...f, name } : f)));
    } catch {
      toast.error('Failed to rename form');
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-start gap-3 px-6 py-4 border-b border-slate-100">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: META_BLUE_SOFT }}>
          <FileSpreadsheet className="h-4.5 w-4.5" style={{ color: META_BLUE }} />
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-semibold text-slate-800">Lead Ads Forms</h3>
          <p className="text-[12px] text-slate-500 mt-0.5">
            {mode === 'discover' ? 'Every Instant Form on your connected Page — pick which ones sync.' : 'Discovered automatically the first time each form gets a submission.'}
          </p>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : mode === 'discover' ? (
        discovered.length === 0 ? (
          <p className="px-6 py-8 text-center text-[12.5px] text-slate-400">No Instant Forms found on this Page yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {discovered.map((form) => (
              <div key={form.meta_form_id} className="flex items-center gap-3 px-6 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-slate-800 truncate">{form.name}</p>
                  {form.tracked && <p className="text-[11.5px] text-slate-400">{form.submission_count} lead{form.submission_count === 1 ? '' : 's'}</p>}
                </div>
                {form.tracked ? (
                  <Switch
                    checked={form.is_active}
                    disabled={savingId === form.meta_form_id}
                    onCheckedChange={() => toggleDiscoveredActive(form)}
                    className="shrink-0 data-[checked]:bg-[#0866FF]"
                  />
                ) : (
                  <Button type="button" variant="outline" size="sm" disabled={savingId === form.meta_form_id}
                    onClick={() => enableDiscovered(form)} className="h-8 shrink-0 text-[12px] border-slate-200">
                    {savingId === form.meta_form_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Enable'}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )
      ) : forms.length === 0 ? (
        <div className="px-6 py-8 text-center">
          <p className="text-[12.5px] text-slate-400">No Lead Ads forms yet — they&apos;ll show up here the moment someone submits one.</p>
          {discoverReason && <p className="mt-1 text-[11px] text-slate-400">{discoverReason}</p>}
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {forms.map((form) => (
            <div key={form.id} className="flex items-center gap-3 px-6 py-3.5">
              <Input
                defaultValue={form.name}
                onBlur={(e) => rename(form, e.target.value)}
                className="h-8 flex-1 text-[13px] border-transparent bg-transparent px-0 font-semibold text-slate-800 hover:border-slate-200 focus:border-slate-200 focus:bg-white focus:px-2"
              />
              <span className="shrink-0 text-[11.5px] text-slate-400">{form.submission_count} lead{form.submission_count === 1 ? '' : 's'}</span>
              <PlatformBreakdown counts={form.platform_counts} />
              <Switch
                checked={form.is_active}
                disabled={savingId === form.id}
                onCheckedChange={() => toggleActive(form)}
                className="shrink-0 data-[checked]:bg-[#0866FF]"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface SegmentSyncRow {
  id: string
  name: string
  description: string | null
  sync: { meta_audience_id: string; synced_count: number; last_synced_at: string | null; last_error: string | null } | null
}

/** Push a CRM Segment to Meta as a hashed Custom Audience — retargeting/
 *  lookalike seeding for the customers already in this CRM. */
function CustomAudiencesPanel() {
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [segments, setSegments] = useState<SegmentSyncRow[]>([]);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/meta-ads/audiences');
      const data = await res.json();
      setReady(!!data.ready);
      setSegments(data.segments ?? []);
    } catch {
      toast.error('Failed to load audiences');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function sync(segmentId: string) {
    setSyncingId(segmentId);
    try {
      const res = await fetch('/api/meta-ads/audiences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segment_id: segmentId }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Sync failed'); return; }
      toast.success(`Synced ${data.synced_count} contact${data.synced_count === 1 ? '' : 's'} to Meta`);
      await load();
    } catch {
      toast.error('Sync failed');
    } finally {
      setSyncingId(null);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-start gap-3 px-6 py-4 border-b border-slate-100">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: META_BLUE_SOFT }}>
          <Users2 className="h-4.5 w-4.5" style={{ color: META_BLUE }} />
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-semibold text-slate-800">Custom Audiences</h3>
          <p className="text-[12px] text-slate-500 mt-0.5">Push a Segment to Meta for retargeting — hashed, never raw contact data.</p>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : !ready ? (
        <p className="px-6 py-8 text-center text-[12.5px] text-slate-400">Add an Ad Account ID above to enable audience syncing.</p>
      ) : segments.length === 0 ? (
        <p className="px-6 py-8 text-center text-[12.5px] text-slate-400">No Segments yet — create one under Segments first.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {segments.map((seg) => (
            <div key={seg.id} className="flex items-center gap-3 px-6 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-slate-800 truncate">{seg.name}</p>
                <p className="text-[11.5px] text-slate-400 truncate">
                  {seg.sync
                    ? seg.sync.last_error
                      ? <span className="text-red-500">{seg.sync.last_error}</span>
                      : `${seg.sync.synced_count} contacts · synced ${seg.sync.last_synced_at ? new Date(seg.sync.last_synced_at).toLocaleDateString('en-IN') : 'never'}`
                    : 'Not synced yet'}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={syncingId === seg.id}
                onClick={() => sync(seg.id)}
                className="h-8 text-[12px] border-slate-200 shrink-0"
              >
                {syncingId === seg.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {seg.sync ? 'Re-sync' : 'Sync now'}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Standard Meta Pixel + web Conversions API — for a client's own
 *  website, distinct from everything else on this page (which is all
 *  WhatsApp-side). Generates a real, working snippet: the standard
 *  Pixel base code, plus a small server-relay helper that calls
 *  /api/meta-ads/track alongside every fbq() call with a shared
 *  event_id, which is what lets Meta deduplicate the browser and
 *  server copies of one event. */
function PixelPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pixelId, setPixelId] = useState('');
  const [savedPixelId, setSavedPixelId] = useState<string | null>(null);
  const [webEventsSecret, setWebEventsSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<'pixel' | 'relay' | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/meta-ads/pixel');
      const data = await res.json();
      setPixelId(data.pixel_id || '');
      setSavedPixelId(data.pixel_id || null);
      setWebEventsSecret(data.web_events_secret || null);
    } catch {
      toast.error('Failed to load Pixel settings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function save() {
    if (!pixelId.trim()) { toast.error('Enter a Pixel ID'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/meta-ads/pixel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pixel_id: pixelId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to save'); return; }
      toast.success('Pixel saved — snippet ready below');
      setSavedPixelId(data.pixel_id);
      setWebEventsSecret(data.web_events_secret);
    } catch {
      toast.error('Failed to save Pixel ID');
    } finally {
      setSaving(false);
    }
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const trackUrl = `${origin}/api/meta-ads/track?secret=${webEventsSecret ?? '<SECRET>'}`;

  const pixelSnippet = savedPixelId ? `<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${savedPixelId}');
fbq('track', 'PageView');
</script>
<!-- End Meta Pixel Code -->` : '';

  const relaySnippet = savedPixelId ? `<script>
// Sends a matching server-side event for deduplication — call this
// instead of a bare fbq('track', ...) whenever you want Meta's
// Conversions API to also see the event (recommended for anything
// beyond PageView, e.g. a form submit or a purchase).
function sendWhatsAppCrmEvent(eventName, customData, userData) {
  var eventId = eventName + '-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  fbq('track', eventName, customData || {}, { eventID: eventId });
  fetch('${trackUrl}', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_name: eventName,
      event_id: eventId,
      event_source_url: window.location.href,
      custom_data: customData || {},
      user_data: userData || {} // { email: '...', phone: '...' } if you have it
    })
  });
}

// Example — call when a purchase completes:
// sendWhatsAppCrmEvent('Purchase', { currency: 'INR', value: 999 }, { email: customerEmail });
</script>` : '';

  function copy(which: 'pixel' | 'relay', text: string) {
    navigator.clipboard.writeText(text);
    setCopied(which);
    toast.success('Copied');
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-start gap-3 px-6 py-4 border-b border-slate-100">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: META_BLUE_SOFT }}>
          <Globe className="h-4.5 w-4.5" style={{ color: META_BLUE }} />
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-semibold text-slate-800">Website Tracking (Pixel)</h3>
          <p className="text-[12px] text-slate-500 mt-0.5">For a client&apos;s own website — separate from everything else on this page, which is WhatsApp-only.</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : (
        <div className="px-6 py-5 space-y-5">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label className="flex items-center gap-1.5 text-[13px] font-medium text-slate-700">
                <Hash className="h-3.5 w-3.5 text-slate-400" />
                Pixel ID
              </Label>
              <Input value={pixelId} onChange={(e) => setPixelId(e.target.value)} placeholder="e.g. 1234567890123456"
                className="h-9 text-[13px] border-slate-200 font-mono" />
            </div>
            <Button type="button" onClick={save} disabled={saving} className="h-9 px-4 text-[13px] text-white shrink-0" style={{ background: META_BLUE }}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
            </Button>
          </div>

          {savedPixelId ? (
            <>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700"><Code2 className="h-3.5 w-3.5 text-slate-400" />Base Pixel code</p>
                  <button type="button" onClick={() => copy('pixel', pixelSnippet)} className="flex items-center gap-1 text-[11.5px] font-medium text-slate-500 hover:text-slate-800">
                    {copied === 'pixel' ? <ClipboardCheck className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied === 'pixel' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="overflow-x-auto rounded-xl bg-slate-900 px-4 py-3 text-[11.5px] leading-relaxed text-slate-100 font-mono">{pixelSnippet}</pre>
                <p className="mt-1.5 text-[11px] text-slate-400">Paste this once, right after the opening <code className="font-mono">&lt;head&gt;</code> tag of every page.</p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700"><Code2 className="h-3.5 w-3.5 text-slate-400" />Server-relay helper (for real conversions)</p>
                  <button type="button" onClick={() => copy('relay', relaySnippet)} className="flex items-center gap-1 text-[11.5px] font-medium text-slate-500 hover:text-slate-800">
                    {copied === 'relay' ? <ClipboardCheck className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied === 'relay' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="overflow-x-auto rounded-xl bg-slate-900 px-4 py-3 text-[11.5px] leading-relaxed text-slate-100 font-mono">{relaySnippet}</pre>
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Paste after the base Pixel code, then call <code className="font-mono">sendWhatsAppCrmEvent(...)</code> on real actions (a form submit, a completed order) —
                  it fires the browser event and a matching server event together, so Meta counts it once instead of twice.
                </p>
              </div>
            </>
          ) : (
            <p className="text-[12px] text-slate-400">Save a Pixel ID to generate the snippet.</p>
          )}
        </div>
      )}
    </div>
  );
}

function GoogleAdsComingSoon() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
        <Megaphone className="h-6 w-6 text-slate-400" />
      </span>
      <p className="text-[14px] font-semibold text-slate-700">Google Ads is coming after Meta Ads</p>
      <p className="max-w-xs text-[12.5px] text-slate-500">
        Same idea — one connection, lead sync, and spend tied to real revenue. Not started yet.
      </p>
    </div>
  );
}

export function AdsTab() {
  const [provider, setProvider] = useState<Provider>('meta');

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <ProviderRail provider={provider} onSelect={setProvider} />
      {provider === 'meta' ? <MetaAdsOverview /> : <GoogleAdsComingSoon />}
      <p className="text-center text-[11px] text-slate-400">
        <Clock className="mr-1 inline h-3 w-3" />
        Full ads access requires Meta App Review — the status above reflects whatever your token can do right now.
      </p>
    </div>
  );
}
