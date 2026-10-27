'use client';

/**
 * Below a staff alert's template picker: what each {{1}}, {{2}}… of the
 * chosen template carries — customer name, number, what they said, a link
 * to the chat, the time — a preview with sample values, and a test alert.
 *
 * Named variables ({{customer_name}}) fill themselves; for numbered ones
 * the business picks, starting from what the AI kit recorded on the
 * template or the old fixed order.
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Send, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch, errorText } from '@/lib/api-fetch';
import { useAuth } from '@/hooks/use-auth';
import { hasMinRole } from '@/lib/auth/roles';
import {
  ALERT_FIELD_LABEL,
  ALERT_FIELD_SAMPLE,
  ALERT_KINDS,
  cleanMapping,
  fitOrder,
  resolveAlertParams,
  templateVariables,
  type AlertField,
  type AlertKind,
} from '@/lib/whatsapp/alert-fields';

interface TemplateLite { name: string; body_text: string; variable_fields?: unknown; status?: string }

const SELECT =
  'w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12.5px] text-slate-800 focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30';

export function AlertTemplateFields(props: Readonly<{ kind: AlertKind; templateName: string | null }>) {
  // Alert settings are an admin's; below that there is nothing to show.
  const { accountRole } = useAuth();
  if (!hasMinRole(accountRole ?? 'viewer', 'admin')) return null;
  return <AlertTemplateFieldsInner {...props} />;
}

function AlertTemplateFieldsInner({ kind, templateName }: Readonly<{ kind: AlertKind; templateName: string | null }>) {
  const [templates, setTemplates] = useState<TemplateLite[] | null>(null);
  const [saved, setSaved] = useState<AlertField[] | null>(null);
  // An edit belongs to one template and one starting point.
  const [draft, setDraft] = useState<{ key: string; fields: AlertField[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ sent: number; failed: Array<{ to: string; error: string }> } | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let live = true;
    Promise.all([
      apiFetch('/api/whatsapp/templates?status=APPROVED', { cache: 'no-store' }).then((r) => r.json()),
      apiFetch(`/api/alerts/template-fields?kind=${kind}&template=${encodeURIComponent(templateName ?? '')}`, { cache: 'no-store' }).then((r) => r.json()),
    ])
      .then(([t, m]: [{ templates?: TemplateLite[] }, { params?: unknown }]) => {
        if (!live) return;
        setTemplates(Array.isArray(t.templates) ? t.templates : []);
        setSaved(cleanMapping(m.params));
      })
      .catch((err) => {
        console.error('[alert template fields] load failed:', err);
        if (live) { setTemplates([]); setLoadError(errorText(err, 'Could not load the template.')); }
      });
    return () => { live = false; };
  }, [kind, templateName]);

  const template = templates?.find((t) => t.name === templateName) ?? null;
  const vars = useMemo(() => templateVariables(template?.body_text), [template?.body_text]);
  const fields = ALERT_KINDS[kind].fields;

  // The mapping shown: what was saved, else what the AI kit recorded, else
  // the old order — fitted to this template's number of variables.
  const start = useMemo<AlertField[]>(() => {
    const n = vars.keys.length;
    const base = cleanMapping(saved, n) ?? cleanMapping(template?.variable_fields, n) ?? ALERT_KINDS[kind].legacy;
    return fitOrder(base, n, kind);
  }, [saved, template?.variable_fields, vars.keys.length, kind]);
  const key = `${templateName}|${start.join(',')}`;
  const current = draft?.key === key ? draft.fields : start;
  const dirty = !vars.named && current.join(',') !== (cleanMapping(saved, vars.keys.length) ?? start).join(',');

  const preview = useMemo(() => {
    if (!template) return '';
    const p = resolveAlertParams({ body: template.body_text, values: ALERT_FIELD_SAMPLE, kind, mapping: current, templateFields: template.variable_fields });
    let i = 0;
    return template.body_text.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_m, k: string) =>
      'byName' in p ? (p.byName[k] ?? '-') : (p.positional[vars.keys.indexOf(k) >= 0 ? vars.keys.indexOf(k) : i++] ?? '-'));
  }, [template, kind, current, vars.keys]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/alerts/template-fields', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, template: templateName, params: current }),
      });
      const j = (await res.json()) as { params?: unknown };
      setSaved(cleanMapping(j.params));
      toast.success('Alert variables saved');
    } catch (err) {
      console.error('[alert template fields] save failed:', err);
      toast.error(errorText(err, 'Could not save.'));
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiFetch('/api/alerts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      setTestResult((await res.json()) as { sent: number; failed: Array<{ to: string; error: string }> });
    } catch (err) {
      console.error('[alert template fields] test failed:', err);
      toast.error(errorText(err, 'Could not send the test alert.'));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3.5">
      {templateName && templates === null && (
        <p className="flex items-center gap-2 text-[12.5px] text-slate-500"><Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> Loading the template…</p>
      )}
      {loadError && <p role="alert" className="text-[12.5px] text-rose-700">{loadError}</p>}
      {templateName && templates && !template && (
        <p className="text-[12.5px] text-amber-800">“{templateName}” is not an approved template on this account. Sync templates from Meta, or choose another.</p>
      )}

      {template && vars.keys.length === 0 && (
        <p className="text-[12.5px] text-slate-600">This template has no variables: every alert will say the same thing.</p>
      )}

      {template && vars.named && (
        <div className="space-y-1">
          <p className="text-[12.5px] font-medium text-slate-700">The template’s variables fill themselves:</p>
          <ul className="text-[12px] text-slate-600">
            {vars.keys.map((k) => <li key={k}><code className="rounded bg-slate-100 px-1">{`{{${k}}}`}</code></li>)}
          </ul>
        </div>
      )}

      {template && !vars.named && vars.keys.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12.5px] font-medium text-slate-700">What each variable carries</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {vars.keys.map((k, i) => (
              <div key={k} className="flex items-center gap-2">
                <label htmlFor={`alert-var-${kind}-${i}`} className="w-12 shrink-0 font-mono text-[12px] text-slate-500">{`{{${k}}}`}</label>
                <select id={`alert-var-${kind}-${i}`} className={SELECT} value={current[i]}
                  onChange={(e) => setDraft({ key, fields: current.map((f, j) => (j === i ? (e.target.value as AlertField) : f)) })}>
                  {fields.map((f) => <option key={f} value={f}>{ALERT_FIELD_LABEL[f]}</option>)}
                </select>
              </div>
            ))}
          </div>
          {dirty && (
            <button type="button" onClick={() => void save()} disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
              {saving && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />} Save variables
            </button>
          )}
        </div>
      )}

      {template && vars.keys.length > 0 && (
        <div>
          <p className="mb-1 text-[11.5px] font-medium uppercase tracking-wide text-slate-500">Preview</p>
          <p className="whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-700">{preview}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <button type="button" onClick={() => void sendTest()} disabled={testing || dirty}
          title={dirty ? 'Save the variables first' : undefined}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
          {testing ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
          Send test alert
        </button>
        <span className="text-[11.5px] text-slate-500">Uses your saved settings and sample values.</span>
      </div>
      {testResult && (
        <div aria-live="polite" className="space-y-1 text-[12.5px]">
          {testResult.sent > 0 && (
            <p className="flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="size-4" aria-hidden /> Sent to {testResult.sent} number{testResult.sent !== 1 ? 's' : ''}.</p>
          )}
          {testResult.failed.map((f) => (
            <p key={f.to} className="flex items-start gap-1.5 text-rose-700"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> {f.to}: {f.error}</p>
          ))}
        </div>
      )}
    </div>
  );
}
