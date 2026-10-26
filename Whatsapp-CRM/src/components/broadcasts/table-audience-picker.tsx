'use client';

/**
 * Broadcast audience "From a table": the people in one of the account's
 * Data Store tables (or a Google Sheet synced to one) whose column meets a
 * rule — "MDP Registrations: Fee status is Not paid". Any business: a
 * registration list, appointments, orders.
 *
 * One rule, said back as a sentence with the live count, how many rows
 * matched, how many of their numbers are not contacts yet, and when the
 * sheet last synced. The count uses the same rule as the send.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { apiFetch, errorText } from '@/lib/api-fetch';
import { cn } from '@/lib/utils';

export type TableOp = 'is' | 'is_not' | 'contains' | 'is_empty' | 'is_not_empty';
export interface TableRule {
  tableId: string;
  fieldKey: string;
  operator: TableOp;
  value?: string;
}

interface TableLite { id: string; name: string; _count?: { records: number } }
interface FieldLite { field_key: string; label: string; field_type: string }
interface CountAnswer { count: number; rows: number; notContacts: number; sync: { at: string | null; error: string | null } | null }

/** Same list as the server (table-audience.ts): no secrets, files or layout. */
const FILTERABLE = new Set([
  'text', 'textarea', 'number', 'email', 'phone', 'url', 'date', 'time', 'datetime', 'boolean',
  'select', 'radio', 'country', 'state', 'district', 'address', 'hidden',
]);

const OPS: { op: TableOp; label: string }[] = [
  { op: 'is', label: 'is' },
  { op: 'is_not', label: 'is not' },
  { op: 'contains', label: 'contains' },
  { op: 'is_empty', label: 'is blank' },
  { op: 'is_not_empty', label: 'is filled in' },
];
const needsValue = (op: TableOp) => op === 'is' || op === 'is_not' || op === 'contains';

const SELECT =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30';

export function tableSentence(tableName: string, fieldLabel: string, op: TableOp, value?: string): string {
  const v = `“${(value ?? '').trim()}”`;
  const rule =
    op === 'is' ? `is ${v}` :
    op === 'is_not' ? `is not ${v} (blank included)` :
    op === 'contains' ? `contains ${v}` :
    op === 'is_empty' ? 'is blank' : 'is filled in';
  return `People in “${tableName}” whose ${fieldLabel} ${rule}`;
}

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export function TableAudiencePicker({
  rule,
  onChange,
}: Readonly<{
  rule: TableRule | undefined;
  /** The rule (undefined until complete), its sentence and its count. */
  onChange: (rule: TableRule | undefined, label: string | undefined, count: number | null) => void;
}>) {
  const [tables, setTables] = useState<TableLite[] | null>(null);
  const [tablesError, setTablesError] = useState('');
  const [tableId, setTableId] = useState(rule?.tableId ?? '');
  const [fields, setFields] = useState<FieldLite[]>([]);
  const [columnsError, setColumnsError] = useState('');
  const [fieldKey, setFieldKey] = useState(rule?.fieldKey ?? '');
  const [op, setOp] = useState<TableOp>(rule?.operator ?? 'is');
  const [value, setValue] = useState(rule?.value ?? '');
  const [values, setValues] = useState<Array<{ value: string; count: number }>>([]);
  const [answer, setAnswer] = useState<CountAnswer | null>(null);
  const [counting, setCounting] = useState(false);
  const [countError, setCountError] = useState('');
  const seq = useRef(0);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // The account's tables.
  useEffect(() => {
    let live = true;
    apiFetch('/api/data-tables', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { tables?: TableLite[] }) => { if (live) setTables(Array.isArray(j.tables) ? j.tables : []); })
      .catch((err) => {
        console.error('[broadcast table audience] tables failed:', err);
        if (live) { setTables([]); setTablesError(errorText(err, 'Could not load your tables.')); }
      });
    return () => { live = false; };
  }, []);

  // The chosen table's columns.
  useEffect(() => {
    if (!tableId) return;
    let live = true;
    apiFetch(`/api/data-tables/${tableId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { table?: { fields?: FieldLite[] } }) => {
        if (!live) return;
        setColumnsError('');
        setFields((j.table?.fields ?? []).filter((f) => FILTERABLE.has(f.field_type)));
      })
      .catch((err) => {
        console.error('[broadcast table audience] columns failed:', err);
        if (live) setColumnsError(errorText(err, 'Could not load the columns.'));
      });
    return () => { live = false; };
  }, [tableId]);

  // The values the chosen column holds (a status, a batch…), when few.
  useEffect(() => {
    if (!tableId || !fieldKey) return;
    let live = true;
    apiFetch(`/api/broadcasts/table-values?tableId=${encodeURIComponent(tableId)}&fieldKey=${encodeURIComponent(fieldKey)}`)
      .then((r) => r.json())
      .then((j: { values?: Array<{ value: string; count: number }> }) => { if (live) setValues(Array.isArray(j.values) ? j.values : []); })
      .catch((err) => { console.error('[broadcast table audience] values failed:', err); if (live) setValues([]); });
    return () => { live = false; };
  }, [tableId, fieldKey]);

  const table = tables?.find((t) => t.id === tableId);
  const field = fields.find((f) => f.field_key === fieldKey);
  const complete = !!table && !!field && (!needsValue(op) || value.trim().length > 0);
  const sentence = complete ? tableSentence(table.name, field.label, op, value) : undefined;

  // The live count — debounced; only the newest answer is shown.
  useEffect(() => {
    // Until this rule is counted, there is no rule: Next stays locked, so
    // a quick click can never send to the previous rule's people.
    onChangeRef.current(undefined, undefined, null);
    if (!complete) return;
    const current: TableRule = { tableId, fieldKey, operator: op, ...(needsValue(op) ? { value: value.trim() } : {}) };
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      setCounting(true);
      setCountError('');
      try {
        const res = await apiFetch('/api/broadcasts/audience-count', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'table', table: current }),
        });
        const j = (await res.json()) as CountAnswer;
        if (mine !== seq.current) return;
        setAnswer(j);
        onChangeRef.current(current, sentence, j.count ?? 0);
      } catch (err) {
        console.error('[broadcast table audience] count failed:', err);
        if (mine !== seq.current) return;
        setAnswer(null);
        setCountError(errorText(err, 'Could not count the audience.'));
        onChangeRef.current(undefined, undefined, null);
      } finally {
        if (mine === seq.current) setCounting(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [complete, tableId, fieldKey, op, value, sentence]);

  if (tables === null) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-[13px] text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Loading your tables…
      </div>
    );
  }
  if (tables.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-[13px] text-slate-500">
        {tablesError || 'No tables yet. Create one under Data, or link a Google Sheet to a table.'}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div role="group" aria-labelledby="table-rule" className="rounded-xl border border-slate-200 bg-white p-4">
        <p id="table-rule" className="mb-3 text-[13px] font-semibold text-slate-800">Send to people in a table</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ta-table" className="mb-1 block text-[12px] font-medium text-slate-500">Table</label>
            <select id="ta-table" className={SELECT} value={tableId}
              onChange={(e) => { setTableId(e.target.value); setFieldKey(''); setFields([]); setValues([]); setValue(''); setAnswer(null); }}>
              <option value="">Choose a table…</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t._count ? ` (${t._count.records} rows)` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ta-column" className="mb-1 block text-[12px] font-medium text-slate-500">Column</label>
            <select id="ta-column" className={SELECT} value={fieldKey} disabled={!tableId}
              onChange={(e) => { setFieldKey(e.target.value); setValues([]); setValue(''); setAnswer(null); }}>
              <option value="">{tableId ? 'Choose a column…' : 'Choose a table first'}</option>
              {fields.map((f) => <option key={f.field_key} value={f.field_key}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ta-rule" className="mb-1 block text-[12px] font-medium text-slate-500">Rule</label>
            <select id="ta-rule" className={SELECT} value={op} disabled={!fieldKey} onChange={(e) => setOp(e.target.value as TableOp)}>
              {OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
            </select>
          </div>
          {needsValue(op) && (
            <div>
              <label htmlFor="ta-value" className="mb-1 block text-[12px] font-medium text-slate-500">Value</label>
              <input id="ta-value" className={SELECT} value={value} disabled={!fieldKey} maxLength={200} list="table-audience-values"
                placeholder={values.length ? 'Choose or type…' : 'Type the value…'} autoComplete="off"
                onChange={(e) => setValue(e.target.value)} />
              <datalist id="table-audience-values">
                {values.map((v) => <option key={v.value} value={v.value} />)}
              </datalist>
            </div>
          )}
        </div>
        {columnsError && (
          <p role="alert" className="mt-3 flex items-center gap-1.5 text-[12.5px] text-rose-700">
            <AlertCircle className="h-4 w-4" aria-hidden /> {columnsError}
          </p>
        )}
        {values.length > 0 && needsValue(op) && (
          <div role="group" className="mt-3 flex flex-wrap gap-2" aria-label="Values in this column">
            {values.map((v) => (
              <button key={v.value} type="button" aria-pressed={value.trim().toLowerCase() === v.value.toLowerCase()}
                onClick={() => setValue(v.value)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
                  value.trim().toLowerCase() === v.value.toLowerCase()
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300',
                )}>
                {v.value} <span className="tabular-nums text-slate-400">{v.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {complete && (
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3" aria-live="polite">
          <p className="text-[13px] text-slate-700">{sentence}.</p>
          {countError ? (
            <p className="mt-1 flex items-center gap-1.5 text-[13px] font-semibold text-rose-700">
              <AlertCircle className="h-4 w-4" aria-hidden /> {countError}
            </p>
          ) : counting || !answer ? (
            <p className="mt-1 text-[13px] font-semibold text-indigo-700">Counting…</p>
          ) : (
            <>
              <p className="mt-1 text-[13px] font-semibold text-indigo-700">
                {answer.count === 0 ? 'Nobody to send to.' : `${answer.count.toLocaleString()} ${answer.count === 1 ? 'person' : 'people'} will get this`}
                <span className="font-normal text-slate-500"> · {answer.rows.toLocaleString()} matching {answer.rows === 1 ? 'row' : 'rows'}</span>
              </p>
              {answer.notContacts > 0 && (
                <p className="mt-0.5 text-[12px] text-amber-800">
                  {answer.notContacts} {answer.notContacts === 1 ? 'number' : 'numbers'} in these rows {answer.notContacts === 1 ? 'is' : 'are'} not a contact yet, so {answer.notContacts === 1 ? 'it' : 'they'} won’t get this.
                </p>
              )}
              {answer.sync && (
                <p className={cn('mt-0.5 text-[12px]', answer.sync.error ? 'text-rose-700' : 'text-slate-500')}>
                  {answer.sync.error
                    ? `The linked Google Sheet failed to sync (${answer.sync.error.slice(0, 120)}). The list may be out of date.`
                    : `Google Sheet last synced ${ago(answer.sync.at)}.`}
                </p>
              )}
            </>
          )}
          <p className="mt-0.5 text-[11.5px] text-slate-500">People who opted out, blocked, archived or without a WhatsApp number are always left out.</p>
        </div>
      )}
    </div>
  );
}
