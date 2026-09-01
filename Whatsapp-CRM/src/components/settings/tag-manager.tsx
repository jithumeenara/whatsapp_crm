'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import { Plus, X, Loader2, Tag as TagIcon, Trash2 } from 'lucide-react';
import { ConfirmIconDialog } from '@/components/ui/confirm-icon-dialog';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { Tag } from '@/types';

const PRESET_COLORS = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Pink', value: '#ec4899' },
];

export function TagManager() {
  const { userId, loading: authLoading } = useAuth();
  const reduceMotion = useReducedMotion();

  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<Tag[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [tagToDelete, setTagToDelete] = useState<Tag | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[3].value);

  useEffect(() => {
    if (authLoading) return;
    if (!userId) {
      setLoading(false);
      return;
    }
    fetchTags();
  }, [authLoading, userId]);

  async function fetchTags() {
    try {
      setLoading(true);
      const res = await fetch('/api/tags');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTags(data.tags || []);
    } catch (err) {
      console.error('Failed to fetch tags:', err);
      toast.error('Failed to load tags');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!newTagName.trim()) {
      toast.error('Tag name is required');
      return;
    }

    try {
      setSaving(true);
      const res = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTagName.trim(), color: selectedColor }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      toast.success('Tag created successfully');
      setDialogOpen(false);
      setNewTagName('');
      setSelectedColor(PRESET_COLORS[3].value);
      await fetchTags();
    } catch (err) {
      console.error('Create error:', err);
      toast.error('Failed to create tag');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(tag: Tag) {
    setTagToDelete(tag);
    setDeleteDialogOpen(true);
  }

  async function handleDelete() {
    if (!tagToDelete) return;

    try {
      setDeleting(true);
      const res = await fetch(`/api/tags/${tagToDelete.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      toast.success('Tag deleted');
      setTags((prev) => prev.filter((t) => t.id !== tagToDelete.id));
      setDeleteDialogOpen(false);
      setTagToDelete(null);
    } catch (err) {
      console.error('Delete error:', err);
      toast.error('Failed to delete tag');
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm px-6 py-8 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-slate-900">Tags</h2>
          <p className="text-[13px] text-slate-500 mt-0.5">Organize your contacts with color-coded tags.</p>
        </div>
        <Button
          onClick={() => {
            setNewTagName('');
            setSelectedColor(PRESET_COLORS[3].value);
            setDialogOpen(true);
          }}
          className="h-9 px-4 text-[13px] bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          New Tag
        </Button>
      </div>

      {tags.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm flex flex-col items-center justify-center py-14 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 mb-3">
            <TagIcon className="h-4.5 w-4.5 text-slate-400" />
          </span>
          <p className="text-[13.5px] font-medium text-slate-700">No tags yet</p>
          <p className="text-[12.5px] text-slate-400 mt-0.5">Create tags to categorize your contacts.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
          <div className="flex flex-wrap gap-2">
            {tags.map((tag, i) => (
              <motion.span
                key={tag.id}
                className="group inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors"
                style={{
                  backgroundColor: `${tag.color}18`,
                  color: tag.color,
                  border: `1px solid ${tag.color}40`,
                }}
                initial={reduceMotion ? undefined : { opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2, delay: Math.min(i * 0.02, 0.3), ease: [0.16, 1, 0.3, 1] }}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
                {tag.name}
                <button
                  onClick={() => confirmDelete(tag)}
                  className="ml-0.5 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/5"
                >
                  <X className="h-3 w-3" />
                </button>
              </motion.span>
            ))}
          </div>
        </div>
      )}

      {/* New Tag Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-white border-slate-200 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-slate-800">New Tag</DialogTitle>
            <DialogDescription className="text-slate-500">
              Create a new tag with a name and color.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-[13px] font-medium text-slate-700">Tag Name</Label>
              <Input
                placeholder="e.g. VIP Customer"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                className="h-9 text-[13px] border-slate-200 focus-visible:ring-[#5B6CF9]/20"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[13px] font-medium text-slate-700">Color</Label>
              <div className="flex gap-2 flex-wrap">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color.value}
                    onClick={() => setSelectedColor(color.value)}
                    className="relative h-8 w-8 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2"
                    style={{
                      backgroundColor: color.value,
                      boxShadow: selectedColor === color.value ? `0 0 0 2px white, 0 0 0 4px ${color.value}` : 'none',
                    }}
                    title={color.name}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[13px] font-medium text-slate-700">Preview</Label>
              <div>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium"
                  style={{
                    backgroundColor: `${selectedColor}18`,
                    color: selectedColor,
                    border: `1px solid ${selectedColor}40`,
                  }}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: selectedColor }} />
                  {newTagName || 'Tag Name'}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="h-9 text-[13px] border-slate-200">
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={saving} className="h-9 text-[13px] bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white">
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Creating…</> : 'Create Tag'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmIconDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        icon={Trash2}
        tone="danger"
        title="Delete this tag?"
        description={<>&quot;{tagToDelete?.name}&quot; will be removed from all contacts. This can&apos;t be undone.</>}
        actionLabel="Delete Tag"
        actionPendingLabel="Deleting…"
        onConfirm={handleDelete}
        pending={deleting}
      />
    </div>
  );
}
