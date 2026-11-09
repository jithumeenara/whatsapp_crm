'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ImageIcon, Loader2, Save, Trash2, Upload, Globe2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CountryCombobox } from '@/components/shared/country-combobox';
import { FormCombobox } from '@/components/data/form-combobox';
import { apiFetch, errorText } from '@/lib/api-fetch';
import {
  REPORT_LANGUAGES,
  countryByIso,
  currencyName,
  listCurrencies,
} from '@/lib/countries';

/**
 * Country, currency, tax number, report language and logo: what a report's
 * header prints (name and address come from Company Details above).
 *
 * Choosing a country fills in its currency, which can still be changed. When
 * the currency is changed the panel says what it does and what it does not:
 * deals and reports that already exist keep the currency they were made in;
 * the new one applies from today.
 */

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

interface Loaded {
  country_iso: string | null;
  currency: string | null;
  tax_id: string | null;
  report_language: string;
  has_logo: boolean;
  currency_effective_from: string | null;
}

const CURRENCIES = listCurrencies();

export function BusinessHeaderPanel() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState('');
  const [country, setCountry] = useState('');
  const [currency, setCurrency] = useState('');
  const [taxId, setTaxId] = useState('');
  const [language, setLanguage] = useState('en');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [logo, setLogo] = useState({ has: false, version: 0 });
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/business-profile');
      const data = (await res.json()) as Loaded;
      setLoaded(data);
      setCountry(data.country_iso ?? '');
      setCurrency(data.currency ?? '');
      setTaxId(data.tax_id ?? '');
      setLanguage(data.report_language || 'en');
      setLogo((l) => ({ has: data.has_logo, version: l.version }));
      setLoadError('');
    } catch (err) {
      console.error('[business-profile] load failed:', err);
      setLoadError(errorText(err, 'Could not load the business header details.'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const picked = countryByIso(country);
  const currencyChanged = loaded !== null && Boolean(loaded.currency) && currency !== loaded.currency;

  function chooseCountry(iso: string) {
    const next = countryByIso(iso);
    setCountry(iso);
    // The country's own currency, unless the owner already chose another one
    // on purpose (it differs from the previous country's).
    const before = countryByIso(country);
    if (next && (!currency || currency === before?.currency)) setCurrency(next.currency);
    setSaved(false);
    setConfirming(false);
  }

  async function save(confirmed = false) {
    // Changing the currency needs a second, explicit step.
    if (currencyChanged && !confirmed) {
      setConfirming(true);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch('/api/business-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          country_iso: country || null,
          currency: currency || undefined,
          tax_id: taxId,
          report_language: language,
        }),
      });
      await res.json().catch(() => null);
      setConfirming(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await load();
    } catch (err) {
      console.error('[business-profile] save failed:', err);
      setError(errorText(err, 'Could not save.'));
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File | undefined) {
    if (!file || logoBusy) return;
    setLogoError('');
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      setLogoError('The logo must be a PNG or JPEG image.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError('The logo must be 2 MB or smaller.');
      return;
    }
    setLogoBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await apiFetch('/api/business-profile/logo', { method: 'POST', body: form });
      setLogo((l) => ({ has: true, version: l.version + 1 }));
    } catch (err) {
      console.error('[business-profile] logo upload failed:', err);
      setLogoError(errorText(err, 'Could not upload the logo.'));
    } finally {
      setLogoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeLogo() {
    if (logoBusy) return;
    setLogoBusy(true);
    setLogoError('');
    try {
      await apiFetch('/api/business-profile/logo', { method: 'DELETE' });
      setLogo((l) => ({ has: false, version: l.version + 1 }));
    } catch (err) {
      console.error('[business-profile] logo remove failed:', err);
      setLogoError(errorText(err, 'Could not remove the logo.'));
    } finally {
      setLogoBusy(false);
    }
  }

  if (loadError) {
    return (
      <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-[13px] text-rose-700">
        {loadError}{' '}
        <button type="button" onClick={load} className="font-medium underline">
          Try again
        </button>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-10 shadow-sm">
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-label="Loading" />
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="business-header-title">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden="true">
          <Globe2 className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <h3 id="business-header-title" className="text-[15px] font-semibold text-slate-900">Country, currency and report header</h3>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">
            Printed at the top of every report PDF, with your business name and address from Company Details.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="bh-country" className="block text-[12.5px] font-medium text-slate-700">Country</label>
            <CountryCombobox id="bh-country" value={country} onChange={chooseCountry} disabled={saving} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="bh-currency" className="block text-[12.5px] font-medium text-slate-700">Currency</label>
            <FormCombobox
              id="bh-currency"
              value={currency}
              options={CURRENCIES}
              onChange={(v) => { setCurrency(v); setSaved(false); setConfirming(false); }}
              placeholder="Choose a currency"
              searchPlaceholder="Code or name, e.g. INR or rupee"
              noMatch="No matching currency."
              disabled={saving}
              labelOf={(code) => `${code} · ${currencyName(code)}`}
            />
            {picked && currency !== picked.currency && (
              <button
                type="button"
                onClick={() => setCurrency(picked.currency)}
                className="text-[11.5px] font-medium text-primary underline-offset-2 hover:underline"
              >
                Use {picked.name}&apos;s currency ({picked.currency})
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="bh-tax" className="block text-[12.5px] font-medium text-slate-700">GST / tax number</label>
            <Input
              id="bh-tax"
              value={taxId}
              onChange={(e) => { setTaxId(e.target.value); setSaved(false); }}
              maxLength={40}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="Optional"
              className="h-10 rounded-xl border-slate-200 text-[13px]"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="bh-language" className="block text-[12.5px] font-medium text-slate-700">Report language</label>
            <FormCombobox
              id="bh-language"
              value={language}
              options={REPORT_LANGUAGES.map((l) => l.code)}
              onChange={(v) => { setLanguage(v); setSaved(false); }}
              placeholder="English"
              searchPlaceholder="Search languages"
              noMatch="No matching language."
              disabled={saving}
              labelOf={(code) => {
                const l = REPORT_LANGUAGES.find((x) => x.code === code);
                return l ? (l.code === 'en' ? l.name : `${l.native} (${l.name})`) : code;
              }}
            />
            <p className="text-[11px] leading-relaxed text-slate-400">English unless you choose another.</p>
          </div>
        </div>

        <div className="space-y-2">
          <span className="block text-[12.5px] font-medium text-slate-700">Logo</span>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-16 w-40 items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50">
              {logo.has ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/business-profile/logo?v=${logo.version}`}
                  alt="Your business logo"
                  width={160}
                  height={64}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="flex items-center gap-1.5 text-[12px] text-slate-400">
                  <ImageIcon className="h-4 w-4" aria-hidden="true" /> No logo yet
                </span>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              id="bh-logo"
              onChange={(e) => uploadLogo(e.target.files?.[0])}
            />
            <Button type="button" variant="outline" size="sm" disabled={logoBusy} onClick={() => fileRef.current?.click()} className="rounded-xl">
              {logoBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Upload className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
              {logo.has ? 'Replace logo' : 'Upload logo'}
            </Button>
            {logo.has && (
              <Button type="button" variant="ghost" size="sm" disabled={logoBusy} onClick={removeLogo} className="rounded-xl text-rose-600">
                <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Remove
              </Button>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-slate-400">PNG or JPEG, up to 2&nbsp;MB. A wide logo on a plain background looks best.</p>
          {logoError && <p role="alert" className="text-[12px] text-rose-600">{logoError}</p>}
        </div>

        {confirming && currencyChanged && (
          <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-[12.5px] leading-relaxed text-amber-900">
            Change currency from <strong>{loaded.currency}</strong> to <strong>{currency}</strong>? Deals and reports that
            already exist keep {loaded.currency}; {currency} applies from today. Reports that cover both show each currency
            on its own line and never add them together.
            <div className="mt-2.5 flex gap-2">
              <Button type="button" size="sm" disabled={saving} onClick={() => save(true)} className="rounded-xl">
                Yes, change to {currency}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setConfirming(false)} className="rounded-xl">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {error && <p role="alert" className="text-[12.5px] text-rose-600">{error}</p>}

        <div className="flex items-center justify-end gap-3">
          {saved && (
            <span className="flex items-center gap-1.5 text-[12.5px] text-emerald-600" role="status">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Saved
            </span>
          )}
          <Button type="button" onClick={() => save()} disabled={saving} className="rounded-xl">
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            Save
          </Button>
        </div>
      </div>
    </section>
  );
}
