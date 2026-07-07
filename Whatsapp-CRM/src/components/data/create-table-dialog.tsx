'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { TABLE_ICONS, getIconEmoji } from '@/lib/data-store/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (table: { id: string; name: string }) => void;
}

export function CreateTableDialog({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('database');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setName('');
    setDescription('');
    setIcon('database');
    setError('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!name.trim()) { setError('Table name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/data-tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null, icon }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Failed to create table.'); return; }
      onCreated(data.table);
      handleClose();
    } catch {
      setError('Network error.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Table</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Icon</Label>
            <div className="flex flex-wrap gap-2">
              {TABLE_ICONS.map((ic) => (
                <button
                  key={ic.value}
                  type="button"
                  onClick={() => setIcon(ic.value)}
                  className={[
                    'flex h-9 w-9 items-center justify-center rounded-lg border text-lg transition-colors',
                    icon === ic.value
                      ? 'border-primary bg-primary/10'
                      : 'border-slate-200 bg-slate-50 hover:border-primary/50',
                  ].join(' ')}
                >
                  {ic.emoji}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="table-name">Table Name *</Label>
            <Input
              id="table-name"
              placeholder="e.g. Doctors, Courses, Students"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="table-desc">Description</Label>
            <Textarea
              id="table-desc"
              placeholder="What is this table for? (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="resize-none text-sm"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !name.trim()} className="gap-2">
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {getIconEmoji(icon)} Create Table
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
