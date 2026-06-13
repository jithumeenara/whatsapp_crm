'use client';

import { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import {
  ChevronRight, Loader2, Pencil, Check, X, LayoutGrid,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { FieldEditor } from '@/components/data/field-editor';
import { RecordGrid } from '@/components/data/record-grid';
import type { DataTable, DataField } from '@/lib/data-store/types';
import { getIconEmoji } from '@/lib/data-store/types';

export default function TablePage({ params }: { params: Promise<{ tableId: string }> }) {
  const { tableId } = use(params);

  const [table, setTable] = useState<DataTable | null>(null);
  const [fields, setFields] = useState<DataField[]>([]);
  const [allTables, setAllTables] = useState<DataTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'records' | 'fields'>('records');
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tableRes, tablesRes] = await Promise.all([
        fetch(`/api/data-tables/${tableId}`),
        fetch('/api/data-tables'),
      ]);
      const tableData = await tableRes.json();
      const tablesData = await tablesRes.json();
      if (tableRes.ok) {
        setTable(tableData.table);
        setFields(tableData.table.fields ?? []);
      }
      // Inject fields into allTables for relation resolution
      const all: DataTable[] = tablesData.tables ?? [];
      if (tableData.table) {
        const idx = all.findIndex((t: DataTable) => t.id === tableId);
        if (idx >= 0) all[idx] = { ...all[idx], fields: tableData.table.fields ?? [] };
      }
      setAllTables(all);
    } finally {
      setLoading(false);
    }
  }, [tableId]);

  useEffect(() => { load(); }, [load]);

  const startEditName = () => {
    setNameInput(table?.name ?? '');
    setEditingName(true);
  };

  const saveName = async () => {
    if (!nameInput.trim() || !table) return;
    setSavingName(true);
    try {
      const res = await fetch(`/api/data-tables/${tableId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameInput.trim() }),
      });
      if (res.ok) {
        setTable((t) => t ? { ...t, name: nameInput.trim() } : t);
        setEditingName(false);
      }
    } finally {
      setSavingName(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!table) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
        <p>Table not found.</p>
        <Link href="/data" className="text-sm text-primary hover:underline">← Back to Data Store</Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/data" className="flex items-center gap-1 hover:text-foreground transition-colors">
          <LayoutGrid className="size-3.5" />
          Data Store
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="text-foreground font-medium">{table.name}</span>
      </nav>

      {/* Table header */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-2xl select-none shrink-0">
          {getIconEmoji(table.icon)}
        </div>
        <div className="flex-1 min-w-0">
          {editingName ? (
            <div className="flex items-center gap-2">
              <Input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveName();
                  if (e.key === 'Escape') setEditingName(false);
                }}
                className="h-8 text-lg font-bold w-64"
                autoFocus
              />
              <Button size="sm" variant="ghost" onClick={saveName} disabled={savingName} className="h-8 w-8 p-0">
                {savingName ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4 text-primary" />}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingName(false)} className="h-8 w-8 p-0">
                <X className="size-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 group">
              <h1 className="text-xl font-bold text-foreground">{table.name}</h1>
              <button
                type="button"
                onClick={startEditName}
                className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-all rounded"
              >
                <Pencil className="size-3.5" />
              </button>
            </div>
          )}
          {table.description && (
            <p className="text-sm text-muted-foreground mt-0.5">{table.description}</p>
          )}
        </div>
        <div className="text-xs text-muted-foreground shrink-0">
          {fields.length} fields · {table._count?.records ?? '–'} records
        </div>
      </div>

      {/* Tabs: Records | Fields */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList className="h-9">
          <TabsTrigger value="records" className="text-xs px-4">Records</TabsTrigger>
          <TabsTrigger value="fields" className="text-xs px-4">Fields</TabsTrigger>
        </TabsList>

        <TabsContent value="records" className="mt-4">
          <RecordGrid
            tableId={tableId}
            fields={fields}
            allTables={allTables}
          />
        </TabsContent>

        <TabsContent value="fields" className="mt-4">
          <div className="max-w-xl">
            <FieldEditor
              tableId={tableId}
              fields={fields}
              allTables={allTables}
              onFieldsChange={setFields}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
