'use client';

import { useState, useRef } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, FileText, Loader2, CheckCircle, XCircle, AlertTriangle, Download } from 'lucide-react';
import { apiFetch, errorText } from '@/lib/api-fetch';
import {
  CONTACTS_TEMPLATE_CSV,
  MAX_IMPORT_ROWS,
  parseContactsCsv,
  phoneKey,
  planExistingUpdate,
  type CheckedRow,
  type OnExisting,
} from '@/lib/contacts/csv-import';
import { cn } from '@/lib/utils';

interface ImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

/** Rows shown in the preview; the counts above it cover the whole file. */
const PREVIEW_ROWS = 100;

const STATUS: Record<CheckedRow['status'], { label: string; cls: string }> = {
  ready: { label: 'Ready', cls: 'bg-emerald-50 text-emerald-700' },
  duplicate: { label: 'Repeated', cls: 'bg-amber-50 text-amber-800' },
  bad_phone: { label: 'Wrong number', cls: 'bg-rose-50 text-rose-700' },
};

interface Existing { name: string | null; company: string | null; hasEmail: boolean; archived: boolean }

const ON_EXISTING_LABEL: Record<OnExisting, string> = {
  skip: 'Skip — keep as saved',
  fill: 'Fill empty fields only',
  name: "Use the file's name",
  name_company: "File's name; saved name → company",
};

function downloadTemplate() {
  // A byte-order mark so Excel opens the file as UTF-8 (Malayalam names).
  const blob = new Blob(['﻿' + CONTACTS_TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'contacts-import-template.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ImportModal({ open, onOpenChange, onImported }: ImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<CheckedRow[]>([]);
  const [fileProblem, setFileProblem] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; updated: number; skipped: number; failed: number } | null>(null);
  // Numbers already saved as contacts, by phone key, and what to do with each.
  const [existing, setExisting] = useState<Record<string, Existing>>({});
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [allExisting, setAllExisting] = useState<OnExisting>('skip');
  const [perRow, setPerRow] = useState<Record<number, OnExisting>>({});
  const checkSeq = useRef(0);

  function reset() {
    setFile(null);
    setRows([]);
    setFileProblem('');
    setResult(null);
    setExisting({});
    setCheckError('');
    setPerRow({});
    setAllExisting('skip');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  /** Which ready numbers are already contacts — nothing is saved. */
  async function checkExisting(list: CheckedRow[]) {
    const seq = ++checkSeq.current;
    const phones = list.filter((r) => r.status === 'ready').map((r) => r.phone);
    setExisting({});
    setCheckError('');
    if (phones.length === 0) return;
    setChecking(true);
    try {
      const res = await apiFetch('/api/contacts/import/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phones }),
      });
      const j = (await res.json()) as { existing?: Record<string, Existing> };
      if (seq === checkSeq.current) setExisting(j.existing ?? {});
    } catch (err) {
      console.error('[contacts import] check failed:', err);
      if (seq === checkSeq.current) setCheckError(errorText(err, 'Could not check which numbers are already contacts.'));
    } finally {
      if (seq === checkSeq.current) setChecking(false);
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setResult(null);
    setFileProblem('');
    setPerRow({});
    if (selected.size > 5 * 1024 * 1024) {
      setRows([]);
      setFileProblem('This file is larger than 5 MB. Split it into smaller files.');
      return;
    }
    const parsed = parseContactsCsv(await selected.text());
    if (parsed.missingPhoneColumn) {
      setRows([]);
      setFileProblem('No phone column found. The first row must be the headers, with a column named "phone" — download the template to see the layout.');
      return;
    }
    if (parsed.rows.length === 0) {
      setRows([]);
      setFileProblem('The file has headers but no contacts under them.');
      return;
    }
    setRows(parsed.rows);
    void checkExisting(parsed.rows);
    if (parsed.tooMany) setFileProblem(`Only the first ${MAX_IMPORT_ROWS.toLocaleString()} rows are read. Split the file for the rest.`);
  }

  const ready = rows.filter((r) => r.status === 'ready');
  const savedOf = (r: CheckedRow) => (r.status === 'ready' ? existing[phoneKey(r.phone)] : undefined);
  const modeOf = (r: CheckedRow): OnExisting => perRow[r.line] ?? allExisting;
  const fresh = ready.filter((r) => !savedOf(r));
  const already = ready.filter((r) => savedOf(r));
  const toUpdate = already.filter((r) => {
    const saved = savedOf(r)!;
    return planExistingUpdate({ name: saved.name, company: saved.company, email: saved.hasEmail ? 'x' : null, archived: saved.archived }, r, modeOf(r)) !== null;
  });
  const sending = fresh.length + toUpdate.length;
  const repeated = rows.filter((r) => r.status === 'duplicate').length;
  const wrong = rows.filter((r) => r.status === 'bad_phone').length;
  const warned = rows.filter((r) => r.status === 'ready' && r.note).length;

  async function handleImport() {
    if (sending === 0 || importing || checking) return;
    setImporting(true);
    try {
      const res = await apiFetch('/api/contacts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contacts: [
            ...fresh.map(({ phone, name, email, company }) => ({ phone, name, email, company })),
            ...toUpdate.map((r) => ({ phone: r.phone, name: r.name, email: r.email, company: r.company, onExisting: modeOf(r) })),
          ],
        }),
      });
      const j = (await res.json()) as { imported: number; updated?: number; skipped: number; failed: number };
      const done = { imported: j.imported, updated: j.updated ?? 0, skipped: j.skipped + (already.length - toUpdate.length), failed: j.failed };
      setResult(done);
      if (done.imported > 0 || done.updated > 0) {
        toast.success(`${done.imported} added, ${done.updated} updated`);
        onImported();
      }
    } catch (err) {
      console.error('[contacts import] failed:', err);
      toast.error(errorText(err, 'Import failed. Nothing was saved — try again.'));
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-white border-slate-200 text-slate-800/80 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-slate-800">Import contacts</DialogTitle>
          <DialogDescription className="text-slate-500">
            A CSV file with a <b>phone</b> column (with country code, e.g. +91 98765 43210). Optional: name, email, company.
            From Excel: File → Save as → CSV.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!result && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-[12.5px] text-slate-600">Not sure of the layout? Start from the template.</p>
              <Button type="button" variant="outline" size="sm" onClick={downloadTemplate} className="gap-1.5">
                <Download className="size-3.5" aria-hidden /> Download template
              </Button>
            </div>
          )}

          {/* Step 1 — choose the file */}
          {!result && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 p-5 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {file ? (
                <>
                  <FileText className="size-7 text-primary" aria-hidden />
                  <span className="text-sm text-slate-800/80">{file.name}</span>
                  <span className="text-xs text-slate-500">Choose another file</span>
                </>
              ) : (
                <>
                  <Upload className="size-7 text-slate-500" aria-hidden />
                  <span className="text-sm text-slate-600">Choose a CSV file</span>
                  <span className="text-xs text-slate-500">Nothing is saved until you confirm</span>
                </>
              )}
            </button>
          )}
          <input
            autoComplete="off"
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="hidden"
          />

          {fileProblem && (
            <p role="alert" className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">
              <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> {fileProblem}
            </p>
          )}

          {/* Step 2 — preview, then confirm */}
          {rows.length > 0 && !result && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2 text-[12px] font-medium" aria-live="polite">
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">{fresh.length} new</span>
                {already.length > 0 && <span className="rounded-full bg-sky-50 px-2.5 py-1 text-sky-700">{already.length} already saved{toUpdate.length ? ` · ${toUpdate.length} to update` : ''}</span>}
                {checking && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-slate-600"><Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden /> Checking saved contacts…</span>}
                {repeated > 0 && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800">{repeated} repeated in the file</span>}
                {wrong > 0 && <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-700">{wrong} wrong number{wrong !== 1 ? 's' : ''}</span>}
                {warned > 0 && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{warned} without email</span>}
              </div>
              {checkError && (
                <p role="alert" className="text-[12px] text-rose-700">{checkError} Numbers already saved will simply be skipped.</p>
              )}
              {already.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-100 bg-sky-50/60 px-3 py-2">
                  <label htmlFor="imp-all-existing" className="text-[12.5px] font-medium text-slate-700">
                    For the {already.length} already saved:
                  </label>
                  <select id="imp-all-existing" value={allExisting}
                    onChange={(e) => { setAllExisting(e.target.value as OnExisting); setPerRow({}); }}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[12.5px] text-slate-800 focus:border-primary focus:outline-none">
                    {(Object.keys(ON_EXISTING_LABEL) as OnExisting[]).map((m) => <option key={m} value={m}>{ON_EXISTING_LABEL[m]}</option>)}
                  </select>
                  <span className="text-[11.5px] text-slate-500">Change one row in its Status column. Every change is noted on the contact.</span>
                </div>
              )}
              <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-100">
                    <tr>
                      <th scope="col" className="px-2 py-1.5 text-left font-medium text-slate-500">Row</th>
                      <th scope="col" className="px-2 py-1.5 text-left font-medium text-slate-500">Phone</th>
                      <th scope="col" className="px-2 py-1.5 text-left font-medium text-slate-500">Name</th>
                      <th scope="col" className="px-2 py-1.5 text-left font-medium text-slate-500">Email</th>
                      <th scope="col" className="px-2 py-1.5 text-left font-medium text-slate-500">Company</th>
                      <th scope="col" className="px-2 py-1.5 text-left font-medium text-slate-500">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, PREVIEW_ROWS).map((row) => (
                      <tr key={row.line} className={cn('border-t border-slate-200/50', row.status !== 'ready' && 'bg-slate-50/70 text-slate-400')}>
                        <td className="px-2 py-1.5 tabular-nums text-slate-400">{row.line}</td>
                        <td className="px-2 py-1.5 tabular-nums">{row.phone || '—'}</td>
                        <td className="px-2 py-1.5">{row.name || '—'}</td>
                        <td className="px-2 py-1.5">{row.email || '—'}</td>
                        <td className="px-2 py-1.5">{row.company || '—'}</td>
                        <td className="px-2 py-1.5" title={row.note}>
                          {savedOf(row) ? (
                            <div className="space-y-1">
                              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                                {savedOf(row)!.archived ? 'Archived — restored if updated' : 'Already saved'}
                              </span>
                              <p className="text-[11px] text-slate-500">
                                Saved as “{savedOf(row)!.name || '—'}”{savedOf(row)!.company ? ` · ${savedOf(row)!.company}` : ''}
                              </p>
                              <select aria-label={`What to do with row ${row.line}`} value={modeOf(row)}
                                onChange={(e) => setPerRow((p) => ({ ...p, [row.line]: e.target.value as OnExisting }))}
                                className="w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px] text-slate-800">
                                {(Object.keys(ON_EXISTING_LABEL) as OnExisting[]).map((m) => <option key={m} value={m}>{ON_EXISTING_LABEL[m]}</option>)}
                              </select>
                            </div>
                          ) : (
                            <>
                              <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS[row.status].cls)}>{STATUS[row.status].label}</span>
                              {row.note && <span className="ml-1 text-[11px] text-slate-500">{row.note}</span>}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > PREVIEW_ROWS && (
                <p className="text-xs text-slate-500">Showing the first {PREVIEW_ROWS} of {rows.length.toLocaleString()} rows. The counts above cover all of them.</p>
              )}
              <p className="text-[12px] text-slate-500">A number is matched on its last ten digits, so +91 98765 43210 and 9876543210 are one contact — never a duplicate.</p>
            </div>
          )}

          {/* Step 3 — what happened */}
          {result && (
            <div className="space-y-2 rounded-lg border border-slate-200 p-4" role="status">
              <p className="text-sm font-medium text-slate-800">Import complete</p>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-1.5 text-sm text-primary">
                  <CheckCircle className="size-4" aria-hidden /> {result.imported} added
                </div>
                {result.updated > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-sky-700">
                    <CheckCircle className="size-4" aria-hidden /> {result.updated} updated
                  </div>
                )}
                {result.skipped > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-amber-700">
                    <AlertTriangle className="size-4" aria-hidden /> {result.skipped} left as saved
                  </div>
                )}
                {result.failed > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-rose-700">
                    <XCircle className="size-4" aria-hidden /> {result.failed} failed
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="bg-white border-slate-200">
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}
            className="border-slate-200 text-slate-800/80 hover:bg-slate-100">
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result && (
            <Button type="button" disabled={sending === 0 || importing || checking} onClick={handleImport}
              className="bg-primary text-primary-foreground hover:bg-primary/90">
              {importing && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
              {checking
                ? 'Checking…'
                : sending > 0
                  ? `Confirm: add ${fresh.length.toLocaleString()}${toUpdate.length ? `, update ${toUpdate.length.toLocaleString()}` : ''}`
                  : 'Nothing to import'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
