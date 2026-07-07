'use client';

import React, { useEffect, useState } from 'react';
import type { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { ArrowLeft, Send, Loader2, Users, Save, FileText, Tag, CheckCheck, Table2, Upload } from 'lucide-react';

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(' ') }

interface AudienceConfig {
  type: string;
  tagIds?: string[];
  csvContacts?: { phone: string; name?: string }[];
  contactIds?: string[];
}

interface Step4Props {
  name: string;
  onNameChange: (name: string) => void;
  template: MessageTemplate;
  audience: AudienceConfig;
  onSend: () => void;
  onSaveDraft?: () => void;
  onBack: () => void;
  isProcessing: boolean;
  progress: number;
}

const AUDIENCE_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  all:          { label: 'All WhatsApp Contacts', icon: Users,     color: 'text-indigo-600 bg-indigo-50' },
  tags:         { label: 'Filtered by Tags',       icon: Tag,       color: 'text-violet-600 bg-violet-50' },
  contacts:     { label: 'Picked Contacts',         icon: CheckCheck, color: 'text-emerald-600 bg-emerald-50' },
  custom_field: { label: 'Custom Field Filter',    icon: Table2,    color: 'text-sky-600 bg-sky-50' },
  csv:          { label: 'CSV Upload',              icon: Upload,    color: 'text-amber-600 bg-amber-50' },
};

export function Step4ScheduleSend({
  name, onNameChange, template, audience, onSend, onSaveDraft, onBack, isProcessing, progress,
}: Step4Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [estimatedReach, setEstimatedReach] = useState<number>(0);
  const [loadingReach, setLoadingReach] = useState(true);

  useEffect(() => {
    async function calculateReach() {
      setLoadingReach(true);
      try {
        if (audience.type === 'csv') { setEstimatedReach(audience.csvContacts?.length ?? 0); return; }
        if (audience.type === 'contacts') { setEstimatedReach(audience.contactIds?.length ?? 0); return; }
        const res = await fetch('/api/broadcasts/audience-count', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: audience.type, tagIds: audience.tagIds }),
        });
        if (res.ok) { const j = await res.json(); setEstimatedReach(j.count ?? 0); }
      } finally { setLoadingReach(false); }
    }
    calculateReach();
  }, [audience]);

  const meta = AUDIENCE_META[audience.type] ?? AUDIENCE_META.all;
  const AudienceIcon = meta.icon;

  const audienceDetail =
    audience.type === 'tags' ? `${audience.tagIds?.length ?? 0} tag${(audience.tagIds?.length ?? 0) !== 1 ? 's' : ''}` :
    audience.type === 'contacts' ? `${audience.contactIds?.length ?? 0} contact${(audience.contactIds?.length ?? 0) !== 1 ? 's' : ''}` :
    null;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[16px] font-semibold text-slate-900">Review & Send</h2>
        <p className="mt-0.5 text-[13px] text-slate-500">Name your broadcast and confirm before sending.</p>
      </div>

      {/* Name field */}
      <div>
        <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Broadcast Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g. Summer Sale Announcement"
          className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-[13px] placeholder:text-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
      </div>

      {/* Summary card */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Broadcast Summary</p>
        </div>
        <div className="grid grid-cols-2 divide-x divide-y divide-slate-100">
          {/* Template */}
          <div className="p-4 flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
              <FileText className="h-4 w-4 text-indigo-600" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-slate-400 mb-0.5">Template</p>
              <p className="text-[13px] font-semibold text-slate-800 truncate">{template.name}</p>
              <p className="text-[11px] text-slate-400">{template.language ?? 'en_US'}</p>
            </div>
          </div>

          {/* Audience */}
          <div className="p-4 flex items-start gap-3">
            <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', meta.color)}>
              <AudienceIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-slate-400 mb-0.5">Audience</p>
              <p className="text-[13px] font-semibold text-slate-800 truncate">{meta.label}</p>
              {audienceDetail && <p className="text-[11px] text-slate-400">{audienceDetail}</p>}
            </div>
          </div>

          {/* Reach */}
          <div className="p-4 col-span-2 flex items-center gap-3 bg-indigo-50/50">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white border border-indigo-100">
              <Users className="h-4 w-4 text-indigo-600" />
            </div>
            <div>
              <p className="text-[11px] text-slate-500 mb-0.5">Estimated reach (WhatsApp contacts only)</p>
              {loadingReach ? (
                <div className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" /><span className="text-[13px] text-slate-400">Calculating…</span></div>
              ) : (
                <p className="text-[20px] font-bold text-indigo-700">{estimatedReach.toLocaleString()}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Sending progress */}
      {isProcessing && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
              <p className="text-[13px] font-semibold text-indigo-800">Sending broadcast…</p>
            </div>
            <span className="text-[12px] font-bold text-indigo-600">{progress}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-indigo-200/60 overflow-hidden">
            <div className="h-full rounded-full bg-indigo-600 transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-2 text-[11px] text-indigo-500">Do not close this page. The broadcast will continue in the background.</p>
        </div>
      )}

      {/* Nav */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4">
        <Button variant="outline" onClick={onBack} disabled={isProcessing} className="border-slate-200 text-slate-700 h-9">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="flex items-center gap-2">
          {onSaveDraft && (
            <Button variant="outline" onClick={onSaveDraft} disabled={!name.trim() || isProcessing}
              className="h-9 border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <Save className="h-4 w-4" /> Save Draft
            </Button>
          )}
          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
            <DialogTrigger
              render={
                <Button
                  disabled={!name.trim() || isProcessing}
                  className="h-9 bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
                />
              }
            >
              <Send className="h-4 w-4" /> Send Broadcast
            </DialogTrigger>
            <DialogContent className="border-slate-200 bg-white sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-slate-900">Confirm Broadcast</DialogTitle>
                <DialogDescription className="text-slate-500">
                  You are about to send <span className="font-semibold text-slate-800">"{name}"</span> to{' '}
                  <span className="font-semibold text-indigo-600">{estimatedReach.toLocaleString()} WhatsApp contacts</span>{' '}
                  using the <span className="font-semibold text-slate-800">{template.name}</span> template.
                  This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowConfirm(false)} className="border-slate-200 text-slate-700">
                  Cancel
                </Button>
                <Button onClick={() => { setShowConfirm(false); onSend(); }}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white">
                  <Send className="h-4 w-4" /> Confirm & Send
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
