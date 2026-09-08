'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  ShoppingBag, AlertTriangle, Loader2, RefreshCw,
  Building2, Hash, Package, Trash2, Search, Eye, EyeOff, Save,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmIconDialog } from '@/components/ui/confirm-icon-dialog';
import { EmbeddedSignupButton } from '@/components/settings/embedded-signup-button';

const META_BLUE = '#0866FF';
const META_BLUE_SOFT = '#EAF2FF';

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(' ') }

interface CatalogConfig {
  id: string;
  catalog_id: string;
  business_id: string | null;
  default_pipeline_id: string | null;
  default_stage_id: string | null;
  status: string;
  last_synced_at: string | null;
  last_tested_at: string | null;
  test_error: string | null;
  connected_at: string | null;
  product_count: number;
}

interface PipelineLite { id: string; name: string; stages: { id: string; name: string }[] }
interface DiscoveredCatalog { id: string; name: string }

function InfoRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-[12px] text-slate-500">{label}</span>
      <span className={cn('text-[13px] font-medium text-slate-800 text-right', mono && 'font-mono')}>{value}</span>
    </div>
  );
}

export function CatalogTab() {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [config, setConfig] = useState<CatalogConfig | null>(null);
  const [message, setMessage] = useState('');

  const [pipelines, setPipelines] = useState<PipelineLite[]>([]);
  const [pipelineId, setPipelineId] = useState('');
  const [stageId, setStageId] = useState('');
  const [savingDefaults, setSavingDefaults] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [connectMethod, setConnectMethod] = useState<'quick' | 'manual'>('quick');

  // Manual Connect form
  const [businessId, setBusinessId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [catalogId, setCatalogId] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredCatalog[] | null>(null);
  const [connecting, setConnecting] = useState(false);

  async function fetchConfig() {
    setLoading(true);
    try {
      const res = await fetch('/api/catalog/config');
      const data = await res.json();
      setConnected(!!data.connected);
      setConfig(data.config ?? null);
      setMessage(data.message ?? '');
      setPipelineId(data.config?.default_pipeline_id ?? '');
      setStageId(data.config?.default_stage_id ?? '');
    } catch {
      setMessage('Failed to load Catalog configuration.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchConfig();
    fetch('/api/pipelines')
      .then((r) => r.json())
      .then((d) => setPipelines(Array.isArray(d.pipelines) ? d.pipelines : []))
      .catch(() => {});
  }, []);

  const selectedPipeline = pipelines.find((p) => p.id === pipelineId);

  async function handleDiscover() {
    if (!businessId.trim() || !accessToken.trim()) {
      toast.error('Business ID and Access Token are required to discover catalogs.');
      return;
    }
    setDiscovering(true);
    setDiscovered(null);
    try {
      const res = await fetch('/api/catalog/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId.trim(), access_token: accessToken.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Discovery failed.');
        return;
      }
      setDiscovered(data.catalogs ?? []);
      if (data.catalogs?.length === 1) setCatalogId(data.catalogs[0].id);
      if (!data.catalogs?.length) toast.info('No catalogs found for that Business ID.');
    } catch {
      toast.error('Discovery failed — network error.');
    } finally {
      setDiscovering(false);
    }
  }

  async function handleConnect() {
    if (!catalogId.trim() || !accessToken.trim()) {
      toast.error('Catalog ID and Access Token are required.');
      return;
    }
    setConnecting(true);
    try {
      const res = await fetch('/api/catalog/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalog_id: catalogId.trim(), business_id: businessId.trim() || undefined, access_token: accessToken.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Connection failed.');
        return;
      }
      toast.success('Catalog connected.');
      setAccessToken('');
      await fetchConfig();
    } catch {
      toast.error('Connection failed — network error.');
    } finally {
      setConnecting(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch('/api/catalog/products/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Sync failed.');
        return;
      }
      toast.success(`Synced ${data.pulled} product${data.pulled === 1 ? '' : 's'} from Meta.`);
      await fetchConfig();
    } catch {
      toast.error('Sync failed — network error.');
    } finally {
      setSyncing(false);
    }
  }

  async function handleSaveDefaults() {
    setSavingDefaults(true);
    try {
      const res = await fetch('/api/catalog/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          catalog_id: config?.catalog_id,
          default_pipeline_id: pipelineId || null,
          default_stage_id: stageId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to save.');
        return;
      }
      toast.success('Saved.');
      await fetchConfig();
    } catch {
      toast.error('Failed to save — network error.');
    } finally {
      setSavingDefaults(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await fetch('/api/catalog/config', { method: 'DELETE' });
      toast.success('Catalog disconnected.');
      setConfirmOpen(false);
      await fetchConfig();
    } catch {
      toast.error('Failed to disconnect.');
    } finally {
      setDisconnecting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
          <ShoppingBag className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-[15px] font-semibold text-slate-900">WhatsApp Catalog</h2>
          <p className="text-[12.5px] text-slate-500">Sell products, share a browsable catalog, and turn cart orders into deals — all inside WhatsApp.</p>
        </div>
      </div>

      {!connected || !config ? (
        <>
          {/* Quick Connect / Manual Connect — same pill-switcher shape as the Ads tab.
              Two even halves on phones (the "Recommended" badge dropping under its
              label) instead of a min-w-max row, which overflowed the card and left
              "Manual Connect" clipped behind a scrollbar. */}
          <div className="rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm sm:overflow-x-auto">
            <div className="grid grid-cols-2 gap-1 sm:flex sm:min-w-max sm:items-center">
              <button
                type="button"
                onClick={() => setConnectMethod('quick')}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-2 text-[13px] font-semibold transition-colors sm:flex-row sm:gap-1.5 sm:px-4 sm:py-2.5',
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
                  'rounded-xl px-2 py-2 text-[13px] font-semibold transition-colors sm:px-4 sm:py-2.5',
                  connectMethod === 'manual' ? 'bg-[#EAF2FF] text-[#0866FF]' : 'text-slate-500 hover:bg-slate-50',
                )}
              >
                Manual Connect
              </button>
            </div>
          </div>

          {message && (
            <div className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-[12.5px] text-amber-700">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {message}
            </div>
          )}

          {connectMethod === 'quick' ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: META_BLUE_SOFT }}>
                <ShoppingBag className="h-6 w-6" style={{ color: META_BLUE }} />
              </span>
              <h3 className="text-[16px] font-semibold text-slate-900">Connect with Facebook</h3>
              <p className="max-w-sm text-[12.5px] text-slate-500">
                Uses the exact same sign-in as WhatsApp Quick Connect. If your Business owns exactly one
                product catalog, it connects automatically — no tokens to copy. If it owns more than one,
                switch to Manual Connect to pick which one.
              </p>
              <EmbeddedSignupButton
                onConnected={fetchConfig}
                className="mt-1 h-11 rounded-xl bg-[#0866FF] px-5 text-[14px] font-semibold text-white hover:bg-[#0655d1]"
              />
              <p className="mt-1 text-[11px] text-slate-400">
                Already connected WhatsApp this way? Click again to check for catalog access.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
              <div>
                <Label className="mb-1 flex items-center gap-1.5 text-[12px] text-slate-600"><Building2 className="h-3.5 w-3.5" /> Business ID</Label>
                <Input value={businessId} onChange={(e) => setBusinessId(e.target.value)} placeholder="e.g. 123456789012345" className="h-9 text-sm" />
              </div>
              <div>
                <Label className="mb-1 flex items-center gap-1.5 text-[12px] text-slate-600"><Hash className="h-3.5 w-3.5" /> Access Token</Label>
                <div className="relative">
                  <Input
                    type={showToken ? 'text' : 'password'}
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    placeholder="System user token with catalog_management"
                    className="h-9 pr-9 text-sm"
                  />
                  <button type="button" onClick={() => setShowToken((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              <Button variant="outline" size="sm" onClick={handleDiscover} disabled={discovering} className="gap-1.5">
                {discovering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                Find my catalogs
              </Button>

              {discovered && discovered.length > 0 && (
                <div className="space-y-1.5 rounded-xl border border-slate-200 p-2">
                  {discovered.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCatalogId(c.id)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition-colors',
                        catalogId === c.id ? 'bg-sky-100 text-sky-800' : 'hover:bg-slate-50 text-slate-700',
                      )}
                    >
                      <span>{c.name}</span>
                      <span className="font-mono text-[11px] text-slate-400">{c.id}</span>
                    </button>
                  ))}
                </div>
              )}

              <div>
                <Label className="mb-1 flex items-center gap-1.5 text-[12px] text-slate-600"><Package className="h-3.5 w-3.5" /> Catalog ID</Label>
                <Input value={catalogId} onChange={(e) => setCatalogId(e.target.value)} placeholder="Pick one above, or paste it directly" className="h-9 font-mono text-sm" />
              </div>

              <Button size="sm" onClick={handleConnect} disabled={connecting} className="w-full gap-1.5">
                {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShoppingBag className="h-3.5 w-3.5" />}
                {connecting ? 'Connecting…' : 'Connect Catalog'}
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={cn('h-2 w-2 rounded-full', config.status === 'connected' ? 'bg-emerald-500' : 'bg-amber-500')} />
                <span className="text-[13px] font-semibold text-slate-800">
                  {config.status === 'connected' ? 'Connected' : 'Needs attention'}
                </span>
              </div>
              <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing} className="gap-1.5">
                {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {syncing ? 'Syncing…' : 'Sync products from Meta'}
              </Button>
            </div>
            {message && !message.startsWith('Connected') && (
              <p className="mb-2 text-[12px] text-amber-600">{message}</p>
            )}
            <div className="divide-y divide-slate-100">
              <InfoRow label="Catalog ID" value={config.catalog_id} mono />
              {config.business_id && <InfoRow label="Business ID" value={config.business_id} mono />}
              <InfoRow label="Products" value={config.product_count} />
              <InfoRow
                label="Last synced"
                value={config.last_synced_at ? new Date(config.last_synced_at).toLocaleString() : 'Never'}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
            <div>
              <p className="text-[13px] font-semibold text-slate-800">Auto-create deals from orders</p>
              <p className="text-[12px] text-slate-500">
                Optional. When a customer completes a cart order, a deal is created here automatically. Leave blank to just record orders without creating deals.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select
                value={pipelineId}
                onChange={(e) => { setPipelineId(e.target.value); setStageId(''); }}
                className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-100"
              >
                <option value="">No pipeline (don&apos;t auto-create)</option>
                {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                disabled={!selectedPipeline}
                className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-100 disabled:opacity-50"
              >
                <option value="">Select stage…</option>
                {selectedPipeline?.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <Button size="sm" variant="outline" onClick={handleSaveDefaults} disabled={savingDefaults} className="gap-1.5">
              {savingDefaults ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save
            </Button>
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-red-100 bg-red-50/50 p-4">
            <div>
              <p className="text-[13px] font-medium text-red-700">Disconnect Catalog</p>
              <p className="text-[11.5px] text-red-500">Products and past orders stay in your CRM — only the connection is removed.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)} className="gap-1.5 border-red-200 text-red-600 hover:bg-red-100">
              <Trash2 className="h-3.5 w-3.5" />
              Disconnect
            </Button>
          </div>
        </>
      )}

      <ConfirmIconDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        icon={Trash2}
        tone="danger"
        title="Disconnect Catalog?"
        description="You'll need to reconnect (Quick or Manual Connect) before you can send catalog or product messages again."
        actionLabel="Disconnect"
        actionPendingLabel="Disconnecting…"
        onConfirm={handleDisconnect}
        pending={disconnecting}
      />
    </div>
  );
}
