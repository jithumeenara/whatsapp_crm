'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ListChecks, Loader2, Search, Trash2, Download, Pencil, Send, Merge, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useConfirm } from '@/hooks/use-confirm';
import { apiFetch, errorText } from '@/lib/api-fetch';

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(' ') }

interface SavedList {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
  source: string;
  source_broadcast: { id: string; name: string } | null;
  last_used_at: string | null;
  created_at: string;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

async function download(url: string, filename: string) {
  const res = await apiFetch(url);
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** Broadcasts → Lists: saved lists — open, rename, merge, download, delete. */
export function ListsManager() {
  const confirm = useConfirm();
  const [lists, setLists] = useState<SavedList[] | null>(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<SavedList | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/contact-lists');
      const d = (await res.json()) as { lists?: SavedList[] };
      setLists(d.lists ?? []);
      setError('');
    } catch (err) {
      console.error('[lists] load failed:', err);
      setError(errorText(err, 'Could not load your lists.'));
      setLists((l) => l ?? []);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function remove(l: SavedList) {
    const ok = await confirm({
      title: `Delete “${l.name}”?`,
      description: 'Only the list is deleted. The people on it stay in your contacts.',
      confirmLabel: 'Delete list',
      variant: 'destructive',
    });
    if (!ok) return;
    setBusy(l.id);
    try {
      await apiFetch(`/api/contact-lists/${l.id}`, { method: 'DELETE' });
      setLists((prev) => (prev ?? []).filter((x) => x.id !== l.id));
      setPicked((p) => { const n = new Set(p); n.delete(l.id); return n; });
      toast.success('List deleted');
    } catch (err) {
      console.error('[lists] delete failed:', err);
      toast.error(errorText(err, 'Could not delete the list'));
    } finally {
      setBusy(null);
    }
  }

  async function exportList(l: SavedList) {
    setBusy(l.id);
    try {
      await download(`/api/contact-lists/${l.id}/export`, `list-${l.name.replace(/[^a-z0-9]/gi, '_')}.xlsx`);
    } catch (err) {
      console.error('[lists] export failed:', err);
      toast.error(errorText(err, 'Download failed'));
    } finally {
      setBusy(null);
    }
  }

  if (lists === null) return <div className="h-40 animate-pulse rounded-xl bg-white" aria-hidden />;

  return (
    <div className="space-y-4">
      {error && <p className="text-[13px] text-rose-700">{error}</p>}
      {lists.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-slate-200 bg-white px-6 py-14 text-center">
          <ListChecks className="mb-3 h-8 w-8 text-slate-300" aria-hidden />
          <p className="text-[14px] font-semibold text-slate-700">No saved lists yet</p>
          <p className="mt-1 max-w-sm text-[12.5px] text-slate-500">
            Open a sent broadcast and choose “Save as list” on any group — for example everyone who read it but did not reply.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12.5px] text-slate-500">
              {picked.size > 0 ? `${picked.size} selected` : 'Tick two or more lists to merge them into a new one.'}
            </p>
            <Button variant="outline" size="sm" disabled={picked.size < 2} onClick={() => setMergeOpen(true)}>
              <Merge aria-hidden /> Merge into new list
            </Button>
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {lists.map((l) => (
              <li key={l.id} className={cn('flex min-w-0 flex-col rounded-xl border bg-white p-4 shadow-sm', picked.has(l.id) ? 'border-indigo-500' : 'border-slate-200')}>
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-indigo-600"
                    checked={picked.has(l.id)}
                    onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(l.id); else n.delete(l.id); return n; })}
                    aria-label={`Select ${l.name}`}
                  />
                  <button type="button" onClick={() => setOpen(l)} className="min-w-0 flex-1 text-left">
                    <p className="truncate text-[14px] font-semibold text-slate-800 hover:underline">{l.name}</p>
                    <p className="text-[12px] text-slate-500">
                      <span className="tabular-nums">{l.member_count.toLocaleString()}</span> {l.member_count === 1 ? 'person' : 'people'}
                      {l.source_broadcast ? <> · from “{l.source_broadcast.name}”</> : l.source === 'manual' ? ' · merged' : ''}
                    </p>
                    <p className="text-[11.5px] text-slate-400">
                      {l.last_used_at ? `Last used ${dateFmt.format(new Date(l.last_used_at))}` : `Saved ${dateFmt.format(new Date(l.created_at))}`}
                    </p>
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Link href={`/broadcasts/new?list=${encodeURIComponent(l.id)}`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
                    <Send aria-hidden /> Send to list
                  </Link>
                  <Button variant="ghost" size="icon-sm" onClick={() => void exportList(l)} disabled={busy === l.id} aria-label={`Download ${l.name}`}>
                    <Download aria-hidden />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => void remove(l)} disabled={busy === l.id} aria-label={`Delete ${l.name}`} className="ml-auto hover:text-rose-700">
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <ListDialog list={open} onClose={() => setOpen(null)} onChanged={() => void load()} />
      <MergeDialog
        open={mergeOpen}
        listIds={[...picked]}
        onClose={() => setMergeOpen(false)}
        onMerged={() => { setPicked(new Set()); void load(); }}
      />
    </div>
  );
}

interface Member { id: string; name: string | null; phone: string; cannot_send: string | null }

function ListDialog({ list, onClose, onChanged }: { list: SavedList | null; onClose: () => void; onChanged: () => void }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const loadSeq = useRef(0);
  const PAGE = 50;

  useEffect(() => {
    if (!list) return;
    setName(list.name);
    setRenaming(false);
    setSearch('');
    setQuery('');
    setPage(0);
  }, [list]);

  // Search as you type: debounced, and only the newest answer is shown.
  useEffect(() => {
    const t = setTimeout(() => { setQuery(search.trim()); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadMembers = useCallback(async () => {
    if (!list) return;
    const seq = ++loadSeq.current;
    try {
      const q = new URLSearchParams({ page: String(page) });
      if (query) q.set('search', query);
      const res = await apiFetch(`/api/contact-lists/${list.id}?${q}`);
      const d = (await res.json()) as { members: Member[]; total: number };
      if (seq !== loadSeq.current) return;
      setMembers(d.members ?? []);
      setTotal(d.total ?? 0);
    } catch (err) {
      console.error('[lists] members failed to load:', err);
      if (seq === loadSeq.current) { setMembers([]); toast.error(errorText(err, 'Could not load the people on this list')); }
    }
  }, [list, page, query]);
  useEffect(() => { void loadMembers(); }, [loadMembers]);

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    if (!list || saving || !name.trim()) return;
    setSaving(true);
    try {
      await apiFetch(`/api/contact-lists/${list.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      toast.success('List renamed');
      setRenaming(false);
      onChanged();
    } catch (err) {
      console.error('[lists] rename failed:', err);
      toast.error(errorText(err, 'Could not rename the list'));
    } finally {
      setSaving(false);
    }
  }

  async function removeMember(m: Member) {
    if (!list) return;
    setRemoving(m.id);
    try {
      await apiFetch(`/api/contact-lists/${list.id}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds: [m.id] }),
      });
      await loadMembers();
      onChanged();
    } catch (err) {
      console.error('[lists] remove member failed:', err);
      toast.error(errorText(err, 'Could not remove that person'));
    } finally {
      setRemoving(null);
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <Dialog open={!!list} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          {renaming ? (
            <form onSubmit={rename} className="flex items-end gap-2 pr-8">
              <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor="rename-list">List name</Label>
                <Input id="rename-list" name="rename-list" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" required />
              </div>
              <Button type="submit" disabled={saving || !name.trim()}>{saving && <Loader2 className="animate-spin" aria-hidden />} Save</Button>
            </form>
          ) : (
            <div className="flex items-center gap-2 pr-8">
              <DialogTitle className="min-w-0 truncate">{list?.name}</DialogTitle>
              <Button variant="ghost" size="icon-sm" onClick={() => setRenaming(true)} aria-label="Rename list"><Pencil aria-hidden /></Button>
            </div>
          )}
          <DialogDescription>
            <span className="tabular-nums">{total.toLocaleString()}</span> {query ? 'matching' : total === 1 ? 'person' : 'people'}. Removing someone takes them off this list only.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or phone…" aria-label="Search this list" className="pl-8" autoComplete="off" name="list-search" />
        </div>

        <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-slate-200" aria-live="polite">
          {members === null ? (
            <p className="flex items-center gap-1.5 p-4 text-[13px] text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading…</p>
          ) : members.length === 0 ? (
            <p className="p-4 text-[13px] text-slate-500">{query ? 'Nobody matches.' : 'This list is empty.'}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-slate-800">{m.name || m.phone}</p>
                    <p className="truncate text-[11.5px] text-slate-500">
                      {m.phone}
                      {m.cannot_send && <span className="ml-1.5 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-rose-700">{m.cannot_send}</span>}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon-sm" onClick={() => void removeMember(m)} disabled={removing === m.id} aria-label={`Remove ${m.name || m.phone} from this list`}>
                    {removing === m.id ? <Loader2 className="animate-spin" aria-hidden /> : <X aria-hidden />}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between text-[12px] text-slate-500">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft aria-hidden /> Previous</Button>
            <span className="tabular-nums">Page {page + 1} of {pages}</span>
            <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next <ChevronRight aria-hidden /></Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MergeDialog({ open, listIds, onClose, onMerged }: { open: boolean; listIds: string[]; onClose: () => void; onMerged: () => void }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  async function merge(e: React.FormEvent) {
    e.preventDefault();
    if (saving || !name.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/contact-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), mergeListIds: listIds }),
      });
      const d = (await res.json()) as { list?: { name: string; member_count: number } };
      toast.success(`Made “${d.list?.name ?? name.trim()}” with ${(d.list?.member_count ?? 0).toLocaleString()} people`);
      setName('');
      onClose();
      onMerged();
    } catch (err) {
      console.error('[lists] merge failed:', err);
      toast.error(errorText(err, 'Could not merge the lists'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={merge} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Merge {listIds.length} lists</DialogTitle>
            <DialogDescription>A new list of everyone on them, each person once. The original lists stay as they are.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="merge-name">New list name</Label>
            <Input id="merge-name" name="merge-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" required />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving || !name.trim()}>{saving && <Loader2 className="animate-spin" aria-hidden />} Merge lists</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
