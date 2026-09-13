'use client';

/**
 * The small card that starts a voice conversation.
 *
 * Deliberately little more than a button. The conversation itself takes
 * over the screen (see voice-chat-modal.tsx) because while you are
 * speaking you are not reading, and a cramped transcript competing with
 * the rest of a settings page helps nobody. This card's whole job is to
 * say whether voice is available and get out of the way.
 *
 * The session lives in a hook above both, so the card and the sheet
 * cannot drift apart on the parts that matter — barge-in especially.
 */

import { useState } from 'react';
import { Mic, Radio, AlertTriangle, Volume2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { AiCard, AiNotice } from './ui-kit';
import { useLiveVoice, type VoiceTurn } from './use-live-voice';
import { VoiceChatModal } from './voice-chat-modal';

export interface LiveVoicePanelProps {
  enabled: boolean;
  mode: 'customer' | 'admin';
  /** Shared with the text chat's dictation and read-aloud. */
  language?: string;
  onLanguageChange?: (v: string) => void;
  languages?: { id: string; label: string }[];
  autoSpeak?: boolean;
  onAutoSpeakChange?: (v: boolean) => void;
  speechSupported?: boolean;
  /** Called with the spoken conversation when it is kept, so it can be
   *  read back in the text chat rather than disappearing with the sheet. */
  onKeepTranscript?: (turns: VoiceTurn[]) => void;
}

export function LiveVoicePanel(props: LiveVoicePanelProps) {
  const [open, setOpen] = useState(false);
  const voice = useLiveVoice(props.mode);
  const live = voice.status === 'live';

  const openAndStart = () => {
    setOpen(true);
    void voice.start();
  };

  const close = () => {
    if (voice.status === 'live' || voice.status === 'connecting') voice.stop();
    setOpen(false);
  };

  return (
    <>
      <AiCard className="p-3.5">
        <div className="flex items-center gap-2.5">
          <span
            className={[
              'grid h-8 w-8 shrink-0 place-items-center rounded-xl transition-colors',
              live ? 'bg-emerald-50 text-emerald-600' : 'bg-[#EEF0FF] text-[#5B6CF9]',
            ].join(' ')}
          >
            {live ? <Radio className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-slate-900">Voice Chat</span>
            <span className="block truncate text-[11px] text-slate-500">
              {live ? 'In conversation' : 'Talk to the AI like a real customer'}
            </span>
          </span>

          {props.enabled && !voice.insecure && (
            <button
              type="button"
              onClick={live ? () => setOpen(true) : openAndStart}
              className={[
                'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold text-white transition-all',
                live
                  ? 'bg-emerald-600'
                  : 'bg-gradient-to-b from-[#6B7BFF] to-[#4A5AE8] shadow-[0_2px_8px_-2px_rgba(74,90,232,.55)]',
              ].join(' ')}
            >
              <Mic className="h-3.5 w-3.5" />
              {live ? 'Open' : 'Start'}
            </button>
          )}
        </div>

        {props.languages && props.onLanguageChange && (
          <div className="mt-2.5">
            <Select value={props.language ?? 'auto'} onValueChange={(v) => v && props.onLanguageChange?.(v)}>
              <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 text-[12.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {props.languages.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {!props.enabled ? (
          <div className="mt-2.5">
            <AiNotice tone="info" icon={<Radio className="h-3.5 w-3.5" />}>
              Turn on <strong>Live voice</strong> in AI Training &rarr; Advanced Features.
            </AiNotice>
          </div>
        ) : voice.insecure ? (
          <div className="mt-2.5">
            <AiNotice tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
              Needs an <code className="rounded bg-white/60 px-1">https://</code> address — browsers only allow the
              microphone on HTTPS or localhost.
            </AiNotice>
          </div>
        ) : voice.micPermission === 'denied' ? (
          // Shown before anything is attempted, rather than after a
          // failure: the state is known, so making someone press a
          // button to be told it cannot work is just a wasted click.
          <div className="mt-2.5">
            <AiNotice tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
              <span className="block">The microphone is blocked for this site.</span>
              <span className="block">
                Allow it from the padlock in the address bar, then reload the page.
              </span>
            </AiNotice>
          </div>
        ) : null}

        {props.speechSupported && props.onAutoSpeakChange && (
          <div className="mt-2.5 flex items-center justify-between gap-3 rounded-lg bg-[#F7F8FC] px-2.5 py-2 ring-1 ring-slate-200/70">
            <span className="flex min-w-0 items-center gap-2">
              <Volume2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="min-w-0 truncate text-[12px] font-medium text-slate-700">Read replies out loud</span>
            </span>
            <Switch checked={!!props.autoSpeak} onCheckedChange={props.onAutoSpeakChange} />
          </div>
        )}
      </AiCard>

      <VoiceChatModal
        open={open}
        onClose={close}
        onKeep={(turns) => props.onKeepTranscript?.(turns)}
        status={voice.status}
        error={voice.error}
        turns={voice.turns}
        level={voice.level}
        youSpeaking={voice.youSpeaking}
        assistantSpeaking={voice.assistantSpeaking}
        onStart={() => void voice.start()}
        onStop={voice.stop}
      />
    </>
  );
}
