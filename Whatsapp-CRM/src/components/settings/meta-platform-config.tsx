'use client';

import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ChevronDown, ChevronUp, ExternalLink, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const MASKED = '••••••••••••••••';

/**
 * One-time, platform-wide setup for Embedded Signup — the Meta "Tech
 * Provider" App's own ID/Secret/Configuration ID, NOT a per-tenant config.
 * Owner-only. Collapsed by default since most visits to Settings > WhatsApp
 * are a tenant connecting their own number, not the platform operator.
 */
export function MetaPlatformConfig() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [appId, setAppId] = useState('');
  const [configId, setConfigId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [secretEdited, setSecretEdited] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/platform/meta-config');
      const data = await res.json();
      if (res.ok && data.configured) {
        setConfigured(true);
        setAppId(data.app_id ?? '');
        setConfigId(data.config_id ?? '');
        setAppSecret(MASKED);
        setSecretEdited(false);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (open) load(); }, [open]);

  async function onSave() {
    if (!appId.trim() || !configId.trim()) { toast.error('App ID and Configuration ID are required'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/platform/meta-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: appId.trim(),
          config_id: configId.trim(),
          app_secret: secretEdited ? appSecret.trim() : MASKED,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to save'); return; }
      toast.success('Platform Meta App saved — Embedded Signup is now live for every tenant');
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <button type="button" onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-slate-50 transition-colors">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="h-4 w-4 text-slate-400" />
          <div>
            <h3 className="text-[14px] font-semibold text-slate-800">Platform Meta App (Embedded Signup)</h3>
            <p className="text-[12px] text-slate-500 mt-0.5">
              {configured ? 'Configured — the "Connect with Facebook" button is live.' : 'One-time setup, done once for the whole platform, not per tenant.'}
            </p>
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>

      {open && (
        <div className="border-t border-slate-100 px-6 py-5 space-y-4">
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
          ) : (
            <>
              <p className="text-[12px] text-slate-500 leading-relaxed">
                These three values come from your own Meta App&apos;s dashboard, after it&apos;s approved as a{' '}
                <a href="https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers" target="_blank" rel="noopener noreferrer" className="text-[#5B6CF9] hover:underline inline-flex items-center gap-0.5">
                  Tech Provider <ExternalLink className="h-3 w-3" />
                </a>. Set once here — every tenant who clicks &quot;Connect with Facebook&quot; uses this same App.
              </p>

              <div className="space-y-1.5">
                <Label className="text-[13px] font-medium text-slate-700">App ID</Label>
                <Input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="1234567890123456"
                  className="h-9 text-[13px] font-mono border-slate-200 focus:border-[#5B6CF9] focus:ring-[#5B6CF9]/20" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[13px] font-medium text-slate-700">App Secret</Label>
                <Input
                  type="password"
                  value={appSecret}
                  onFocus={() => { if (!secretEdited) { setAppSecret(''); setSecretEdited(true); } }}
                  onChange={(e) => setAppSecret(e.target.value)}
                  placeholder="From App Dashboard → Settings → Basic"
                  className="h-9 text-[13px] font-mono border-slate-200 focus:border-[#5B6CF9] focus:ring-[#5B6CF9]/20"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[13px] font-medium text-slate-700">Configuration ID</Label>
                <Input value={configId} onChange={(e) => setConfigId(e.target.value)} placeholder="From Facebook Login for Business → Configurations"
                  className="h-9 text-[13px] font-mono border-slate-200 focus:border-[#5B6CF9] focus:ring-[#5B6CF9]/20" />
                <p className="text-[11px] text-slate-400">Create this using the &quot;WhatsApp Embedded Signup Configuration With 60 Expiration Token&quot; template.</p>
              </div>

              <div className="flex justify-end pt-1">
                <Button onClick={onSave} disabled={saving} className="h-9 px-5 text-[13px] bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white">
                  {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : 'Save'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
