'use client';

import { useEffect, useState } from 'react';
import { Languages, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';

// Quick-pick chips — not an exhaustive or restrictive list, Gemini
// translates far beyond these. Malayalam/Tamil/Arabic/Marathi/Spanish
// cover the language mix this app's own research found across its real
// customer conversations; English is the common fallback.
const QUICK_LANGUAGES = ['Malayalam', 'English', 'Tamil', 'Hindi', 'Arabic', 'Marathi', 'Spanish'];

/**
 * A personal (per-agent, not account-wide) setting: which language the
 * inbox's "Translate" link on inbound messages, and the composer's
 * translate-before-send button, translate into. Null/empty = the
 * translation UI doesn't render anywhere for this person — off by
 * default, so this ships with zero visible change until someone sets it.
 */
export function ChatTranslationPanel() {
  const { profile, refreshProfile } = useAuth();
  const [language, setLanguage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLanguage(profile?.preferred_language ?? '');
  }, [profile?.preferred_language]);

  const dirty = language.trim() !== (profile?.preferred_language ?? '');

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferred_language: language.trim() || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Save failed.');
      }
      await refreshProfile();
      toast.success(language.trim() ? `Chat translation set to ${language.trim()}` : 'Chat translation turned off');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-slate-500">
        When set, inbound messages in a different language get a &quot;Translate&quot; link, and you can translate your own reply into the customer&apos;s language before sending. Leave blank to turn this off.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {QUICK_LANGUAGES.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLanguage(l)}
            className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
              language === l ? 'bg-[#5B6CF9] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          placeholder="e.g. Malayalam — or leave blank to turn off"
          className="h-9 text-[13px] border-slate-200"
        />
        <Button size="sm" onClick={handleSave} disabled={saving || !dirty} className="h-9 shrink-0 gap-1.5">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Languages className="h-3.5 w-3.5" />}
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
