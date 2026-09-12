'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Loader2, Save, CheckCircle2, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/**
 * The business's own details.
 *
 * This is the single biggest lever on reply quality that isn't the
 * knowledge base: without it the AI has no idea what the company is, so
 * every account's bot sounds like the same template. It feeds the
 * customer-facing prompt (as "the business you work for") and the Admin
 * assistant's prompt (as "the account whose data you're reading").
 *
 * Category and section are pickers with an Other box each, because a
 * fixed list would file a driving school under "educational institution"
 * and a diagnostic lab under "healthcare, other" — and the AI would then
 * describe the business that way to customers.
 */

interface CompanyProfile {
  legal_name: string | null;
  display_name: string | null;
  category: string | null;
  category_other: string | null;
  section: string | null;
  section_other: string | null;
  about: string | null;
  services: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  working_hours: string | null;
  languages: string | null;
}

type Form = Record<keyof CompanyProfile, string>;

const EMPTY: Form = {
  legal_name: '', display_name: '', category: '', category_other: '', section: '', section_other: '',
  about: '', services: '', website: '', email: '', phone: '', address: '', city: '', state: '',
  country: '', working_hours: '', languages: '',
};

export function CompanyProfilePanel() {
  const [form, setForm] = useState<Form>(EMPTY);
  const [categories, setCategories] = useState<string[]>([]);
  const [sections, setSections] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/company-profile');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not load company details.');
      setCategories(data.categories ?? []);
      setSections(data.sections ?? {});
      if (data.profile) {
        setForm((prev) => {
          const next = { ...prev };
          for (const key of Object.keys(EMPTY) as Array<keyof Form>) {
            next[key] = data.profile[key] ?? '';
          }
          return next;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load company details.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sectionOptions = useMemo(
    () => (form.category ? sections[form.category] ?? ['Other'] : []),
    [form.category, sections],
  );

  function set(field: keyof Form, value: string) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // Changing category invalidates whatever section was picked under
      // the old one — leaving "Dental" selected under "Real Estate"
      // would end up in the prompt.
      if (field === 'category') {
        next.section = '';
        next.section_other = '';
      }
      return next;
    });
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/company-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not save.');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-10 shadow-sm">
        <Loader2 className="h-5 w-5 animate-spin text-[#5B6CF9]" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#EEF0FF] text-[#5B6CF9]">
          <Building2 className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-slate-900">Company Details</h3>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">
            Used by the AI to answer as your business rather than as a generic assistant.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name (shown to customers)">
            <Input
              value={form.display_name}
              onChange={(e) => set('display_name', e.target.value)}
              placeholder="ACSTI Kerala"
              className="h-10 rounded-xl border-slate-200 text-[13px]"
            />
          </Field>
          <Field label="Registered / legal name">
            <Input
              value={form.legal_name}
              onChange={(e) => set('legal_name', e.target.value)}
              placeholder="Optional"
              className="h-10 rounded-xl border-slate-200 text-[13px]"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">
            <Select value={form.category || undefined} onValueChange={(v) => v && set('category', v)}>
              <SelectTrigger className="h-10 w-full rounded-xl border-slate-200 text-[13px]">
                <SelectValue placeholder="Choose an industry" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.category === 'Other' && (
              <Input
                value={form.category_other}
                onChange={(e) => set('category_other', e.target.value)}
                placeholder="Type your industry"
                className="mt-2 h-10 rounded-xl border-slate-200 text-[13px]"
              />
            )}
          </Field>

          <Field label="Section">
            <Select
              value={form.section || undefined}
              onValueChange={(v) => v && set('section', v)}
              disabled={!form.category}
            >
              <SelectTrigger className="h-10 w-full rounded-xl border-slate-200 text-[13px]">
                <SelectValue placeholder={form.category ? 'Choose a section' : 'Pick a category first'} />
              </SelectTrigger>
              <SelectContent>
                {sectionOptions.map((sec) => (
                  <SelectItem key={sec} value={sec}>{sec}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.section === 'Other' && (
              <Input
                value={form.section_other}
                onChange={(e) => set('section_other', e.target.value)}
                placeholder="Type what you do"
                className="mt-2 h-10 rounded-xl border-slate-200 text-[13px]"
              />
            )}
          </Field>
        </div>

        <Field
          label="About the business"
          hint="One paragraph in your own words — the single most useful field here for reply quality."
        >
          <Textarea
            value={form.about}
            onChange={(e) => set('about', e.target.value)}
            rows={3}
            placeholder="We train students in industrial safety and fire safety across Kerala, with campuses in…"
            className="resize-none rounded-xl border-slate-200 text-[13px]"
          />
        </Field>

        <Field label="Main services / products" hint="Comma separated.">
          <Input
            value={form.services}
            onChange={(e) => set('services', e.target.value)}
            placeholder="Fire &amp; Safety Diploma, Industrial Safety, NEBOSH, Placement support"
            className="h-10 rounded-xl border-slate-200 text-[13px]"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} className="h-10 rounded-xl border-slate-200 text-[13px]" />
          </Field>
          <Field label="Email">
            <Input value={form.email} onChange={(e) => set('email', e.target.value)} className="h-10 rounded-xl border-slate-200 text-[13px]" />
          </Field>
          <Field label="Website">
            <Input value={form.website} onChange={(e) => set('website', e.target.value)} className="h-10 rounded-xl border-slate-200 text-[13px]" />
          </Field>
        </div>

        <Field label="Address">
          <Input value={form.address} onChange={(e) => set('address', e.target.value)} className="h-10 rounded-xl border-slate-200 text-[13px]" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="City">
            <Input value={form.city} onChange={(e) => set('city', e.target.value)} className="h-10 rounded-xl border-slate-200 text-[13px]" />
          </Field>
          <Field label="State">
            <Input value={form.state} onChange={(e) => set('state', e.target.value)} className="h-10 rounded-xl border-slate-200 text-[13px]" />
          </Field>
          <Field label="Country">
            <Input value={form.country} onChange={(e) => set('country', e.target.value)} className="h-10 rounded-xl border-slate-200 text-[13px]" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Working hours" hint="Free text — real hours have exceptions.">
            <Input
              value={form.working_hours}
              onChange={(e) => set('working_hours', e.target.value)}
              placeholder="9am-6pm Mon-Sat, closed 1-2pm"
              className="h-10 rounded-xl border-slate-200 text-[13px]"
            />
          </Field>
          <Field label="Languages you serve customers in">
            <Input
              value={form.languages}
              onChange={(e) => set('languages', e.target.value)}
              placeholder="Malayalam, English, Hindi"
              className="h-10 rounded-xl border-slate-200 text-[13px]"
            />
          </Field>
        </div>

        <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-3.5 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <p className="text-[11.5px] leading-relaxed text-slate-500">
            These details are sent to the AI with every customer reply. Phone, email and website are shared with
            customers when relevant; the Admin assistant sees the rest as background for your data.
          </p>
        </div>

        {error && (
          <p className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-[12.5px] font-medium text-rose-700">{error}</p>
        )}

        <div className="flex items-center justify-between gap-3">
          {saved ? (
            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
              Saved
            </span>
          ) : (
            <span />
          )}
          <Button
            onClick={save}
            disabled={saving}
            className="h-9 gap-2 rounded-xl bg-[#5B6CF9] px-5 text-[13px] font-semibold text-white hover:bg-[#4a5ce8]"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save company details
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[12.5px] font-medium text-slate-700">{label}</Label>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-slate-400">{hint}</p>}
    </div>
  );
}
