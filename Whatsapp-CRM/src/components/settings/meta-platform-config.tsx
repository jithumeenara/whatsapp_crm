'use client';

import React, { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ChevronDown, ChevronUp, Copy, ExternalLink, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch, errorText } from '@/lib/api-fetch';

const MASKED = '••••••••••••••••';
const INPUT = 'h-9 text-[13px] font-mono border-slate-200 focus:border-[#5B6CF9] focus:ring-[#5B6CF9]/20';

interface Props {
  /** Expanded on mount — used by its own dedicated Settings tab, where
   *  there's no reason to hide it behind a click. Defaults closed when
   *  embedded elsewhere. */
  defaultOpen?: boolean;
}

interface Addresses { redirect_uri: string | null; instagram_webhook: string | null; messenger_webhook: string | null }

/**
 * One-time, server-wide Meta App setup — NOT per tenant. Server owner only
 * (the API checks). One Facebook Login for Business configuration per
 * channel, each optional: WhatsApp (Embedded Signup), Instagram (Connect
 * Instagram), Messenger (Connect Messenger). Shows the exact addresses to
 * paste in the Meta dashboard, taken from this server's own setting.
 */
export function MetaPlatformConfig({ defaultOpen = false }: Props) {
  const uid = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [appId, setAppId] = useState('');
  const [configId, setConfigId] = useState('');
  const [igConfigId, setIgConfigId] = useState('');
  const [fbConfigId, setFbConfigId] = useState('');
  const [adsConfigId, setAdsConfigId] = useState('');
  const [catalogConfigId, setCatalogConfigId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [secretEdited, setSecretEdited] = useState(false);
  const [addresses, setAddresses] = useState<Addresses | null>(null);
  const [hasVerifyToken, setHasVerifyToken] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await apiFetch('/api/platform/meta-config');
      const data = (await res.json()) as Partial<Addresses> & {
        configured?: boolean; app_id?: string; config_id?: string; instagram_config_id?: string; messenger_config_id?: string; ads_config_id?: string; catalog_config_id?: string; has_verify_token?: boolean
      };
      setAddresses({ redirect_uri: data.redirect_uri ?? null, instagram_webhook: data.instagram_webhook ?? null, messenger_webhook: data.messenger_webhook ?? null });
      if (data.configured) {
        setConfigured(true);
        setAppId(data.app_id ?? '');
        setConfigId(data.config_id ?? '');
        setIgConfigId(data.instagram_config_id ?? '');
        setFbConfigId(data.messenger_config_id ?? '');
        setAdsConfigId(data.ads_config_id ?? '');
        setCatalogConfigId(data.catalog_config_id ?? '');
        setHasVerifyToken(data.has_verify_token === true);
        setAppSecret(MASKED);
        setSecretEdited(false);
      }
    } catch (err) {
      console.error('[platform meta app] load failed:', err);
      toast.error(errorText(err, 'Could not load the Meta App settings.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (open) void load(); }, [open]);

  async function onSave() {
    if (saving) return;
    if (!appId.trim()) { toast.error('Enter the App ID.'); return; }
    if (!configId.trim() && !igConfigId.trim() && !fbConfigId.trim() && !adsConfigId.trim() && !catalogConfigId.trim()) {
      toast.error('Add at least one configuration ID.');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/platform/meta-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: appId.trim(),
          config_id: configId.trim(),
          instagram_config_id: igConfigId.trim(),
          messenger_config_id: fbConfigId.trim(),
          ads_config_id: adsConfigId.trim(),
          catalog_config_id: catalogConfigId.trim(),
          app_secret: secretEdited ? appSecret.trim() : MASKED,
        }),
      });
      toast.success('Meta App saved.');
      await load();
    } catch (err) {
      console.error('[platform meta app] save failed:', err);
      toast.error(errorText(err, 'Could not save the Meta App settings.'));
    } finally {
      setSaving(false);
    }
  }

  async function generateToken() {
    if (generating) return;
    setGenerating(true);
    try {
      const res = await apiFetch('/api/platform/meta-config/verify-token', { method: 'POST' });
      const data = (await res.json()) as { verify_token?: string };
      if (!data.verify_token) throw new Error('No token came back. Try again.');
      setNewToken(data.verify_token);
      setHasVerifyToken(true);
      toast.success('New verify token saved. Copy it into Meta now — it is shown only once.');
    } catch (err) {
      console.error('[platform meta app] verify token failed:', err);
      toast.error(errorText(err, 'Could not make a new verify token.'));
    } finally {
      setGenerating(false);
    }
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); toast.success('Copied.'); }
    catch { toast.error('Could not copy. Select the text and copy it by hand.'); }
  }

  const digitsOnly = (v: string) => v.replace(/\D/g, '');

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-slate-50">
        <div className="flex min-w-0 items-center gap-2.5">
          <ShieldCheck className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold text-slate-800">Platform Meta App</h3>
            <p className="mt-0.5 text-[12px] text-slate-500">
              {configured ? 'Configured. Each channel’s connect button appears once its configuration ID is set.' : 'One-time setup for the whole server, not per workspace.'}
            </p>
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-slate-400" aria-hidden="true" /> : <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" />}
      </button>

      {open && (
        <div className="space-y-5 border-t border-slate-100 px-6 py-5">
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label="Loading" /></div>
          ) : (
            <>
              <p className="text-[12px] leading-relaxed text-slate-500">
                Values from your Meta App&apos;s dashboard. Set once here: every workspace on this server uses this App. Each
                configuration is optional; a channel&apos;s connect button appears only when its own configuration ID is set.{' '}
                <a href="https://developers.facebook.com/docs/facebook-login/facebook-login-for-business" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[#4A5CE8] hover:underline">
                  Facebook Login for Business <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              </p>

              <div className="space-y-1.5">
                <Label htmlFor={`${uid}-app`} className="text-[13px] font-medium text-slate-700">App ID</Label>
                <Input id={`${uid}-app`} name="meta-app-id" autoComplete="off" inputMode="numeric" value={appId} onChange={(e) => setAppId(digitsOnly(e.target.value))} placeholder="1234567890123456" className={INPUT} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`${uid}-secret`} className="text-[13px] font-medium text-slate-700">App Secret</Label>
                <Input
                  id={`${uid}-secret`}
                  name="meta-app-secret"
                  type="password"
                  autoComplete="new-password"
                  value={appSecret}
                  onFocus={() => { if (!secretEdited) { setAppSecret(''); setSecretEdited(true); } }}
                  onChange={(e) => setAppSecret(e.target.value)}
                  placeholder="From App Dashboard → App settings → Basic"
                  className={INPUT}
                />
              </div>

              <ConfigField id={`${uid}-wa`} label="WhatsApp configuration ID" value={configId} onChange={(v) => setConfigId(digitsOnly(v))}
                help={<>Optional. Turns on <strong>Connect WhatsApp</strong>. Create it from the &quot;WhatsApp Embedded Signup&quot; template.</>} />

              <ConfigField id={`${uid}-ig`} label="Instagram configuration ID" value={igConfigId} onChange={(v) => setIgConfigId(digitsOnly(v))}
                help={<>Optional. Turns on <strong>Connect Instagram</strong>. Assets: <strong>Instagram accounts</strong> only. Permissions: instagram_basic, instagram_manage_messages, instagram_manage_comments, instagram_content_publish, instagram_manage_insights, business_management. Token: system-user, never expires.</>} />

              <ConfigField id={`${uid}-fb`} label="Messenger configuration ID" value={fbConfigId} onChange={(v) => setFbConfigId(digitsOnly(v))}
                help={<>Optional. Turns on <strong>Connect Messenger</strong>. Assets: <strong>Pages</strong> only. Permissions: pages_show_list, pages_manage_metadata, pages_messaging, pages_read_engagement, business_management. Token: system-user, never expires.</>} />

              <ConfigField id={`${uid}-ads`} label="Ads configuration ID" value={adsConfigId} onChange={(v) => setAdsConfigId(digitsOnly(v))}
                help={<>Optional. Turns on <strong>Connect Ads</strong> (several ad accounts). Assets: <strong>Ad accounts</strong> only, task Analyze. Permissions: ads_read, business_management. Token: system-user, never expires.</>} />

              <ConfigField id={`${uid}-cat`} label="Catalog configuration ID" value={catalogConfigId} onChange={(v) => setCatalogConfigId(digitsOnly(v))}
                help={<>Optional. Turns on <strong>Connect Catalog</strong> (several catalogs). Assets: <strong>Catalogs</strong> only. Permissions: catalog_management, business_management. Token: system-user, never expires.</>} />

              {addresses && (addresses.redirect_uri || addresses.instagram_webhook) && (
                <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p className="text-[12px] font-semibold text-slate-700">Paste these in the Meta dashboard</p>
                  {addresses.redirect_uri && <CopyRow label="Valid OAuth Redirect URI (Facebook Login for Business → Settings)" value={addresses.redirect_uri} onCopy={copy} />}
                  {addresses.instagram_webhook && <CopyRow label="Instagram webhook callback URL" value={addresses.instagram_webhook} onCopy={copy} />}
                  {addresses.messenger_webhook && <CopyRow label="Messenger (Page) webhook callback URL" value={addresses.messenger_webhook} onCopy={copy} />}
                  <div className="min-w-0 border-t border-slate-200 pt-2">
                    <p className="text-[11px] text-slate-500">Webhook verify token (the same one for the Instagram and the Page webhook)</p>
                    {newToken ? (
                      <>
                        <CopyRow label="New verify token — shown only once" value={newToken} onCopy={copy} />
                        <p className="mt-1 text-[11px] text-amber-800">Paste it in Meta now and press Verify and save. After you leave this page it cannot be shown again (make a new one if needed).</p>
                      </>
                    ) : (
                      <p className="mt-0.5 text-[12px] text-slate-700">{hasVerifyToken ? 'Saved (hidden for safety).' : 'Not set yet.'}</p>
                    )}
                    {configured && (
                      <Button type="button" variant="outline" size="sm" disabled={generating} onClick={() => void generateToken()} className="mt-2 h-8 text-[12px]">
                        {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                        {hasVerifyToken ? 'Make a new token' : 'Generate token'}
                      </Button>
                    )}
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-1">
                <Button type="button" onClick={() => void onSave()} disabled={saving} className="h-9 bg-[#4A5CE8] px-5 text-[13px] text-white hover:bg-[#3D4FD6]">
                  {saving ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Saving…</> : 'Save'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ConfigField({ id, label, value, onChange, help }: Readonly<{ id: string; label: string; value: string; onChange: (v: string) => void; help: React.ReactNode }>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[13px] font-medium text-slate-700">{label}</Label>
      <Input id={id} name={id} autoComplete="off" inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Optional" className={INPUT} />
      <p className="text-[11px] leading-relaxed text-slate-500">{help}</p>
    </div>
  );
}

function CopyRow({ label, value, onCopy }: Readonly<{ label: string; value: string; onCopy: (v: string) => void }>) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-slate-500">{label}</p>
      <div className="mt-0.5 flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-700" title={value}>{value}</code>
        <button type="button" onClick={() => onCopy(value)} aria-label={`Copy ${label}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200 hover:text-slate-800">
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
