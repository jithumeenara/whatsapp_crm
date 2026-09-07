'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  IndianRupee, AlertTriangle, Loader2, Trash2, Eye, EyeOff, ExternalLink, ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmIconDialog } from '@/components/ui/confirm-icon-dialog';

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(' ') }

interface NumberLite { id: string; label: string | null; phone_number_id: string; is_default: boolean }
interface GatewayConfig {
  id: string; whatsapp_config_id: string; gateway: string;
  vpa: string | null; mcc: string | null; pc: string | null;
  status: string; created_at: string;
}

const GATEWAYS: { value: string; label: string; built: boolean }[] = [
  { value: 'razorpay', label: 'Razorpay', built: true },
  { value: 'payu', label: 'PayU', built: false },
  { value: 'billdesk', label: 'Billdesk', built: false },
  { value: 'zaakpay', label: 'Zaakpay', built: false },
];

export function PaymentsTab() {
  const [loading, setLoading] = useState(true);
  const [numbers, setNumbers] = useState<NumberLite[]>([]);
  const [configs, setConfigs] = useState<GatewayConfig[]>([]);
  const [selectedNumberId, setSelectedNumberId] = useState('');

  const [gateway, setGateway] = useState('razorpay');
  const [keyId, setKeyId] = useState('');
  const [keySecret, setKeySecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [vpa, setVpa] = useState('');
  const [mcc, setMcc] = useState('');
  const [pc, setPc] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/whatsapp/payments/config');
      const data = await res.json();
      setNumbers(data.numbers ?? []);
      setConfigs(data.configs ?? []);
      if (!selectedNumberId && data.numbers?.length) {
        const def = data.numbers.find((n: NumberLite) => n.is_default) ?? data.numbers[0];
        setSelectedNumberId(def.id);
      }
    } catch {
      toast.error('Failed to load payment settings.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedConfig = configs.find((c) => c.whatsapp_config_id === selectedNumberId);

  useEffect(() => {
    if (selectedConfig) {
      setGateway(selectedConfig.gateway);
      setVpa(selectedConfig.vpa ?? '');
      setMcc(selectedConfig.mcc ?? '');
      setPc(selectedConfig.pc ?? '');
    } else {
      setGateway('razorpay');
      setVpa(''); setMcc(''); setPc('');
    }
    setKeyId(''); setKeySecret('');
  }, [selectedConfig]);

  async function handleSave() {
    if (!selectedNumberId) { toast.error('Connect a WhatsApp number first.'); return; }
    if (!selectedConfig && (!keyId.trim() || !keySecret.trim())) {
      toast.error('Key ID and Key Secret are required for the first save.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/whatsapp/payments/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          whatsapp_config_id: selectedNumberId,
          gateway,
          key_id: keyId.trim() || undefined,
          key_secret: keySecret.trim() || undefined,
          vpa: vpa.trim() || undefined,
          mcc: mcc.trim() || undefined,
          pc: pc.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to save.'); return; }
      toast.success(data.message || 'Saved.');
      await load();
    } catch {
      toast.error('Failed to save — network error.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await fetch(`/api/whatsapp/payments/config?whatsapp_config_id=${selectedNumberId}`, { method: 'DELETE' });
      toast.success('Gateway disconnected.');
      setConfirmOpen(false);
      await load();
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
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
          <IndianRupee className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-[15px] font-semibold text-slate-900">In-Chat Payments (India)</h2>
          <p className="text-[12.5px] text-slate-500">Collect UPI payments directly inside WhatsApp via an order_details message.</p>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[12.5px] text-amber-800">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-semibold">Requires Meta&apos;s explicit approval — not self-serve.</p>
          <p className="mt-1">
            Meta enables WhatsApp Payments per WABA through a manual support case (type &quot;WaBiz: Business Payments API&quot;),
            not an API flag. Everything below saves and works technically, but nothing will actually send until that
            approval lands for this number. India only.
          </p>
        </div>
      </div>

      {numbers.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center text-[13px] text-slate-500">
          Connect a WhatsApp number in Settings &gt; Channels first.
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          {numbers.length > 1 && (
            <div>
              <Label className="mb-1 text-[12px] text-slate-600">Number</Label>
              <select
                value={selectedNumberId}
                onChange={(e) => setSelectedNumberId(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-100"
              >
                {numbers.map((n) => <option key={n.id} value={n.id}>{n.label || n.phone_number_id}</option>)}
              </select>
            </div>
          )}

          {selectedConfig && (
            <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[12px] text-slate-500">
              <span className={cn('h-1.5 w-1.5 rounded-full', 'bg-amber-500')} />
              Status: <span className="font-medium text-slate-700">{selectedConfig.status.replace(/_/g, ' ')}</span>
            </div>
          )}

          <div>
            <Label className="mb-1 text-[12px] text-slate-600">Gateway</Label>
            <select
              value={gateway}
              onChange={(e) => setGateway(e.target.value)}
              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-100"
            >
              {GATEWAYS.map((g) => (
                <option key={g.value} value={g.value}>{g.label}{g.built ? '' : ' (adapter not built yet)'}</option>
              ))}
            </select>
            {!GATEWAYS.find((g) => g.value === gateway)?.built && (
              <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-600">
                <AlertTriangle className="h-3 w-3" />
                Saves fine, but only Razorpay can actually send a payment request today.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="mb-1 text-[12px] text-slate-600">Key ID</Label>
              <Input value={keyId} onChange={(e) => setKeyId(e.target.value)} placeholder={selectedConfig ? '••••••••' : ''} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="mb-1 text-[12px] text-slate-600">Key Secret</Label>
              <div className="relative">
                <Input
                  type={showSecret ? 'text' : 'password'}
                  value={keySecret}
                  onChange={(e) => setKeySecret(e.target.value)}
                  placeholder={selectedConfig ? '••••••••' : ''}
                  className="h-9 pr-9 text-sm"
                />
                <button type="button" onClick={() => setShowSecret((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-slate-400">UPI Intent mode fields — obtained from your payment gateway.</p>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="mb-1 text-[12px] text-slate-600">VPA</Label>
              <Input value={vpa} onChange={(e) => setVpa(e.target.value)} placeholder="business@upi" className="h-9 text-sm" />
            </div>
            <div>
              <Label className="mb-1 text-[12px] text-slate-600">MCC</Label>
              <Input value={mcc} onChange={(e) => setMcc(e.target.value)} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="mb-1 text-[12px] text-slate-600">PC</Label>
              <Input value={pc} onChange={(e) => setPc(e.target.value)} className="h-9 text-sm" />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <IndianRupee className="h-3.5 w-3.5" />}
              {saving ? 'Saving…' : selectedConfig ? 'Save changes' : 'Connect gateway'}
            </Button>
            {selectedConfig && (
              <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)} className="gap-1.5 border-red-200 text-red-600 hover:bg-red-50">
                <Trash2 className="h-3.5 w-3.5" />
                Disconnect
              </Button>
            )}
          </div>

          <a
            href="https://developers.facebook.com/documentation/business-messaging/whatsapp/payments/payments-in/overview/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11.5px] text-slate-400 hover:text-slate-600"
          >
            <ExternalLink className="h-3 w-3" />
            Meta&apos;s WhatsApp Payments (India) docs
          </a>
        </div>
      )}

      <ConfirmIconDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        icon={Trash2}
        tone="danger"
        title="Disconnect this payment gateway?"
        description="Past payment records stay in your CRM — only the connection is removed."
        actionLabel="Disconnect"
        actionPendingLabel="Disconnecting…"
        onConfirm={handleDisconnect}
        pending={disconnecting}
      />
    </div>
  );
}
