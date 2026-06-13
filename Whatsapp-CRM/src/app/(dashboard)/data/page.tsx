'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Loader2, LayoutGrid, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CreateTableDialog } from '@/components/data/create-table-dialog';
import type { DataTable } from '@/lib/data-store/types';
import { getIconEmoji } from '@/lib/data-store/types';

export default function DataStorePage() {
  const router = useRouter();
  const [tables, setTables] = useState<DataTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/data-tables');
      const data = await res.json();
      setTables(data.tables ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const deleteTable = async (id: string) => {
    if (!confirm('Delete this table and all its records? This cannot be undone.')) return;
    setDeleting(id);
    try {
      await fetch(`/api/data-tables/${id}`, { method: 'DELETE' });
      setTables((prev) => prev.filter((t) => t.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <LayoutGrid className="size-6 text-primary" />
            Data Store
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create custom tables to store any data — doctors, courses, products, and more.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="size-4" />
          New Table
        </Button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!loading && tables.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-4xl">
            🗄️
          </div>
          <div className="text-center">
            <p className="font-semibold text-foreground">No tables yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create your first custom table to start organizing your data.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="size-4" />
            Create First Table
          </Button>
        </div>
      )}

      {/* Table cards grid */}
      {!loading && tables.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tables.map((table) => (
            <div key={table.id} className="group relative">
              {/* Card is a proper Link for reliable navigation */}
              <Link
                href={`/data/${table.id}`}
                className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 hover:border-primary/50 hover:shadow-sm transition-all block"
              >
                <div className="flex items-start justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-2xl select-none">
                    {getIconEmoji(table.icon)}
                  </div>
                  {/* Spacer so name doesn't overlap dropdown */}
                  <div className="w-8" />
                </div>

                <div className="flex-1">
                  <h3 className="font-semibold text-foreground leading-tight">{table.name}</h3>
                  {table.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{table.description}</p>
                  )}
                </div>

                <div className="flex items-center gap-3 text-xs text-muted-foreground border-t border-border pt-3 mt-auto">
                  <span>{table._count?.fields ?? 0} fields</span>
                  <span className="text-border">·</span>
                  <span>{table._count?.records ?? 0} records</span>
                </div>
              </Link>

              {/* Dropdown positioned absolutely over the card — doesn't block the Link */}
              <div className="absolute top-3 right-3">
                <DropdownMenu>
                  <DropdownMenuTrigger className="opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-all">
                    <MoreVertical className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => deleteTable(table.id)}
                      className="text-destructive focus:text-destructive"
                    >
                      {deleting === table.id
                        ? <Loader2 className="size-4 animate-spin" />
                        : <Trash2 className="size-4" />}
                      Delete Table
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateTableDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(t) => {
          router.push(`/data/${t.id}`);
        }}
      />
    </div>
  );
}
