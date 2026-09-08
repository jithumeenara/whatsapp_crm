'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Star, Phone, Loader2 } from 'lucide-react';
import { WhatsAppConfig } from './whatsapp-config';

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(' ') }

interface NumberSummary {
  id: string;
  connected: boolean;
  config?: {
    phone_number_id: string;
    label?: string | null;
    is_default: boolean;
    status: string;
  };
}

/**
 * Finding #14 — a tenant can connect several real WhatsApp numbers. This
 * wraps the existing (large, already-polished) single-number
 * `WhatsAppConfig` component with a pill-strip switcher above it, rather
 * than rewriting that component's rich connected-overview/setup-wizard
 * UI from scratch. Each pill is one connected number; "+ Add Number"
 * opens a fresh setup form for a new one.
 */
export function WhatsAppNumbersManager(props: { defaultConnectMethod?: 'quick' | 'manual' }) {
  const [numbers, setNumbers] = useState<NumberSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined); // undefined = not yet decided
  const [settingDefault, setSettingDefault] = useState<string | null>(null);

  const loadNumbers = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch('/api/whatsapp/config');
      const data = await res.json();
      const list: NumberSummary[] = data.configs ?? [];
      setNumbers(list);
      // Keep the current selection if it still exists; otherwise land on
      // the default number (or the setup form when there are none yet).
      setSelectedId((prev) => {
        if (prev && list.some((n) => n.id === prev)) return prev;
        const def = list.find((n) => n.config?.is_default) ?? list[0];
        return def?.id ?? null;
      });
    } catch {
      // Best-effort — the inner WhatsAppConfig instance still renders
      // its own error state from its own fetch.
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => { loadNumbers(); }, [loadNumbers]);

  async function handleSetDefault(id: string) {
    setSettingDefault(id);
    try {
      const res = await fetch('/api/whatsapp/config/set-default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Failed to set default number');
        return;
      }
      toast.success('Default number updated.');
      await loadNumbers();
    } catch {
      toast.error('Failed to set default number');
    } finally {
      setSettingDefault(null);
    }
  }

  const showSwitcher = !loadingList && numbers.length > 0;

  return (
    <div className="space-y-4">
      {loadingList ? (
        <div className="flex items-center justify-center py-8 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : showSwitcher ? (
        <div className="scroll-styled overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
          <div className="flex min-w-max items-center gap-1">
            {numbers.map((n) => {
              const isActive = selectedId === n.id;
              const label = n.config?.label || n.config?.phone_number_id || 'Number';
              return (
                <div key={n.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => setSelectedId(n.id)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-colors',
                      isActive ? 'bg-emerald-50 text-emerald-700' : 'text-slate-500 hover:bg-slate-50',
                    )}
                  >
                    <Phone className="h-3.5 w-3.5" />
                    {label}
                    {n.config?.is_default && (
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    )}
                    <span className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      n.connected ? 'bg-emerald-500' : 'bg-amber-500',
                    )} />
                  </button>
                  {isActive && !n.config?.is_default && (
                    <button
                      type="button"
                      onClick={() => handleSetDefault(n.id)}
                      disabled={settingDefault === n.id}
                      className="absolute -bottom-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap text-[10.5px] text-slate-400 hover:text-emerald-600 group-hover:block"
                    >
                      {settingDefault === n.id ? 'Setting…' : 'Set as default'}
                    </button>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className={cn(
                'flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-colors',
                selectedId === null ? 'bg-emerald-50 text-emerald-700' : 'text-slate-500 hover:bg-slate-50',
              )}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Number
            </button>
          </div>
        </div>
      ) : null}

      {!loadingList && (
        <WhatsAppConfig
          key={selectedId ?? 'new'}
          defaultConnectMethod={props.defaultConnectMethod}
          configId={selectedId === undefined ? undefined : selectedId}
          onChanged={loadNumbers}
        />
      )}
    </div>
  );
}
