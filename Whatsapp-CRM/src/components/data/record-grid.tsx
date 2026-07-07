'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Search, Pencil, Trash2, Loader2,
  ChevronLeft, ChevronRight, FileX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RecordForm } from './record-form';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { DataField, DataRecord } from '@/lib/data-store/types';
import { getSelectItems } from '@/lib/data-store/types';

interface Props {
  tableId: string;
  fields: DataField[];
  allTables: { id: string; name: string; fields?: DataField[] }[];
}

const PAGE_SIZE = 50;

export function RecordGrid({ tableId, fields, allTables }: Props) {
  const [records, setRecords] = useState<DataRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<DataRecord | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Cache relation records for display
  const [relationCache, setRelationCache] = useState<Record<string, Record<string, string>>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        ...(search ? { search } : {}),
      });
      const res = await fetch(`/api/data-tables/${tableId}/records?${params}`);
      const data = await res.json();
      setRecords(data.records ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [tableId, page, search]);

  useEffect(() => { load(); }, [load]);

  // Pre-load relation display values
  useEffect(() => {
    const relFields = fields.filter((f) => f.field_type === 'relation' && f.relation_table_id);
    if (!relFields.length) return;
    Promise.all(
      relFields.map(async (f) => {
        const rel = allTables.find((t) => t.id === f.relation_table_id);
        if (!rel) return null;
        const res = await fetch(`/api/data-tables/${f.relation_table_id}/records?pageSize=500`);
        const d = await res.json();
        const map: Record<string, string> = {};
        for (const r of (d.records ?? []) as DataRecord[]) {
          const val = f.relation_label_field
            ? String((r.data as Record<string, unknown>)[f.relation_label_field] ?? r.id)
            : r.id;
          map[r.id] = val;
        }
        return { key: f.field_key, map };
      }),
    ).then((results) => {
      const cache: Record<string, Record<string, string>> = {};
      for (const r of results) { if (r) cache[r.key] = r.map; }
      setRelationCache(cache);
    });
  }, [fields, allTables]);

  const deleteRecord = async (id: string) => {
    setDeleting(id);
    setConfirmDeleteId(null);
    try {
      await fetch(`/api/data-tables/${tableId}/records/${id}`, { method: 'DELETE' });
      setRecords((prev) => prev.filter((r) => r.id !== id));
      setTotal((t) => t - 1);
    } finally {
      setDeleting(null);
    }
  };

  const openAdd = () => { setEditRecord(null); setFormOpen(true); };
  const openEdit = (r: DataRecord) => { setEditRecord(r); setFormOpen(true); };

  const onSaved = (saved: DataRecord) => {
    if (editRecord) {
      setRecords((prev) => prev.map((r) => r.id === saved.id ? saved : r));
    } else {
      setRecords((prev) => [saved, ...prev]);
      setTotal((t) => t + 1);
    }
  };

  const formatCell = (field: DataField, value: unknown): string => {
    if (value === undefined || value === null || value === '') return '—';
    if (field.field_type === 'boolean') return value ? 'Yes' : 'No';
    if (field.field_type === 'relation') {
      return relationCache[field.field_key]?.[String(value)] ?? String(value);
    }
    if (field.field_type === 'select' || field.field_type === 'radio') {
      return getSelectItems(field.options).find((o) => o.value === value)?.label ?? String(value);
    }
    if (field.field_type === 'multiselect') {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      const items = getSelectItems(field.options);
      return arr.map((v) => items.find((o) => o.value === v)?.label ?? v).join(', ') || '—';
    }
    if (field.field_type === 'address') {
      const a = typeof value === 'object' && value !== null ? (value as Record<string, string>) : {};
      return [a.street, a.city, a.state, a.country].filter(Boolean).join(', ') || '—';
    }
    if (field.field_type === 'file') {
      return String(value).split('/').pop() ?? String(value);
    }
    if (field.field_type === 'date') {
      try { return new Date(String(value)).toLocaleDateString(); } catch { return String(value); }
    }
    if (field.field_type === 'datetime') {
      try { return new Date(String(value)).toLocaleString(); } catch { return String(value); }
    }
    return String(value);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
          <Input
            placeholder="Search records…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <div className="flex-1" />
        <Button size="sm" onClick={openAdd} className="gap-1.5">
          <Plus className="size-4" />
          Add Record
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="w-10 text-xs">#</TableHead>
                {fields.map((f) => (
                  <TableHead key={f.id} className="text-xs whitespace-nowrap">
                    {f.label}
                    {f.required && <span className="text-destructive ml-0.5">*</span>}
                  </TableHead>
                ))}
                <TableHead className="w-20 text-xs">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={fields.length + 2} className="text-center py-12">
                    <Loader2 className="size-5 animate-spin mx-auto text-slate-500" />
                  </TableCell>
                </TableRow>
              )}
              {!loading && records.length === 0 && (
                <TableRow>
                  <TableCell colSpan={fields.length + 2} className="text-center py-12">
                    <div className="flex flex-col items-center gap-2 text-slate-500">
                      <FileX className="size-8 opacity-30" />
                      <p className="text-sm">{search ? 'No records match your search.' : 'No records yet. Add your first record!'}</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {!loading && records.map((record, idx) => (
                <TableRow key={record.id} className="hover:bg-slate-100/20 group">
                  <TableCell className="text-xs text-slate-500 font-mono">
                    {(page - 1) * PAGE_SIZE + idx + 1}
                  </TableCell>
                  {fields.map((field) => (
                    <TableCell key={field.id} className="text-sm max-w-[200px]">
                      {(field.field_type === 'file' || field.field_type === 'image' || field.field_type === 'signature') && (record.data as Record<string, unknown>)[field.field_key] ? (
                        <img
                          src={String((record.data as Record<string, unknown>)[field.field_key])}
                          alt={field.label}
                          className="h-8 w-8 rounded object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                      ) : (
                        <span className="truncate block">
                          {formatCell(field, (record.data as Record<string, unknown>)[field.field_key])}
                        </span>
                      )}
                    </TableCell>
                  ))}
                  <TableCell>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => openEdit(record)}
                        className="p-1 rounded text-slate-500 hover:text-primary hover:bg-slate-100 transition-colors"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(record.id)}
                        disabled={deleting === record.id}
                        className="p-1 rounded text-slate-500 hover:text-destructive hover:bg-slate-100 transition-colors"
                      >
                        {deleting === record.id
                          ? <Loader2 className="size-3.5 animate-spin" />
                          : <Trash2 className="size-3.5" />}
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{total} records total</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-8 w-8 p-0"
              disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-xs">Page {page} of {totalPages}</span>
            <Button size="sm" variant="outline" className="h-8 w-8 p-0"
              disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      <RecordForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        tableId={tableId}
        fields={fields}
        record={editRecord}
        onSaved={onSaved}
      />

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete Record"
        description="This record will be permanently deleted. This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={() => confirmDeleteId && deleteRecord(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
