'use client';

import {
  Sliders, ShieldQuestion, UserCheck, X, Plus, MessageSquare, Database, AlertTriangle, Sparkles,
  BadgeCheck, Mic,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AiButton, AiCard, AiCardHeader, AiIconTile, AiInput, AiLabel, AiHint,
  AiBadge, AiNotice, AiPromptEditor,
} from './ui-kit';
import { TTS_VOICES } from '@/lib/ai/tts-voices';
import { CLOUD_VOICE_CHARACTERS } from '@/lib/ai/cloud-voices';
import { TtsCredentialsCard } from './tts-credentials-card';
import {
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
} from '@/components/ui/accordion';

/**
 * The settings that shape *how* the AI answers, as opposed to *what* it
 * knows — collapsed by default so the Training tab leads with the
 * knowledge base itself.
 *
 * Everything here already existed in the previous AI Config screen and
 * is still wired to the same fields; the rebuild moved it rather than
 * dropping it. Each section is a real control: nothing here is a
 * placeholder for a feature that doesn't exist.
 */

export interface AdvancedFeaturesProps {
  systemPrompt: string;
  onSystemPromptChange: (v: string) => void;
  adminSystemPrompt: string;
  onAdminSystemPromptChange: (v: string) => void;
  customerContextEnabled: boolean;
  onCustomerContextEnabledChange: (v: boolean) => void;

  fallbackAnswer: string;
  onFallbackAnswerChange: (v: string) => void;
  escalationTopics: string[];
  topicInput: string;
  onTopicInputChange: (v: string) => void;
  onAddTopic: () => void;
  onRemoveTopic: (t: string) => void;

  lowConfidenceHandoffEnabled: boolean;
  onLowConfidenceHandoffEnabledChange: (v: boolean) => void;
  confidenceThreshold: number;
  onConfidenceThresholdChange: (v: number) => void;
  lowConfidenceAssignTo: string;
  onLowConfidenceAssignToChange: (v: string) => void;
  lowConfidenceMessage: string;
  onLowConfidenceMessageChange: (v: string) => void;
  agents: Array<{ user_id: string; full_name: string }>;
  semanticSearchAvailable: boolean;

  responseValidationEnabled: boolean;
  onResponseValidationEnabledChange: (v: boolean) => void;
  compositeConfidenceEnabled: boolean;
  onCompositeConfidenceEnabledChange: (v: boolean) => void;

  /** Whether the assistant answers messages no chatbot matched. Off, a
   *  voice reply setting describes something that never happens. */
  assistantAnswersUnmatched: boolean;
  voiceReplyEnabled: boolean;
  onVoiceReplyEnabledChange: (v: boolean) => void;
  voiceName: string;
  onVoiceNameChange: (v: string) => void;
  voiceMaxChars: number;
  onVoiceMaxCharsChange: (v: number) => void;
  cloudVoice: string;
  onCloudVoiceChange: (v: string) => void;
  /** True when the server has Google Cloud credentials. Reported
   *  honestly rather than promising Cloud quality without them. */
  cloudTtsAvailable: boolean;

  liveVoiceEnabled: boolean;
  onLiveVoiceEnabledChange: (v: boolean) => void;
  liveVoiceName: string;
  onLiveVoiceNameChange: (v: string) => void;
}

/** A usable starting point, so "required" doesn't mean staring at an
 *  empty box. Written as rules rather than facts: company details are
 *  injected separately, and repeating them here only creates two places
 *  to keep in sync. */
const STARTER_CUSTOMER_PROMPT = `You are the assistant for our business, replying to customers on WhatsApp and our other channels.

How to reply:
- Be warm, professional and brief. Two or three sentences is usually right.
- Reply in the same language the customer wrote in.
- Answer only what was asked. Don't volunteer unrelated offers.
- Use the knowledge you were given. If it doesn't cover the question, say you'll check with the team rather than guessing.
- Never invent prices, dates, availability or policies.
- If the customer is upset, or asks for something you can't confirm, hand over to a human.`;

export function AdvancedFeatures(props: AdvancedFeaturesProps) {
  // Trimmed: whitespace is not instructions.
  const customerPromptMissing = !props.systemPrompt.trim();

  return (
    <AiCard>
      <div className="px-6 pt-5">
        <AiCardHeader title="Advanced Features" subtitle="Improve accuracy and control behavior." />
      </div>

      <Accordion className="px-6 pb-2">
        {/* ── Persona / system prompt ── */}
        <AccordionItem value="persona">
          <AccordionTrigger className="text-[13.5px]">
            <span className="flex min-w-0 items-center gap-2.5">
              <AiIconTile tint="indigo" size="sm">
                <Sliders className="h-4 w-4" />
              </AiIconTile>
              <span className="min-w-0 text-left">
                <span className="flex flex-wrap items-center gap-2 font-medium text-slate-800">
                  Prompts &amp; Persona
                  {customerPromptMissing && (
                    <AiBadge tone="rose">
                      <AlertTriangle className="h-3 w-3" />
                      Customer prompt missing
                    </AiBadge>
                  )}
                </span>
                <span className="block text-[11.5px] font-normal text-slate-500">
                  Separate instructions for customer replies and for internal answers.
                </span>
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-5 pb-4">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <MessageSquare className="h-3.5 w-3.5 text-[#5B6CF9]" />
                  <AiLabel htmlFor="system-prompt">Customer prompt</AiLabel>
                  <AiBadge tone={customerPromptMissing ? 'rose' : 'slate'}>Required</AiBadge>
                </div>
                <AiPromptEditor
                  id="system-prompt"
                  title="Customer prompt"
                  subtitle="Shapes every reply sent to a real customer, on every channel."
                  placeholder="You are the assistant for [Your Business]. Be warm, professional and brief. Answer only what you were asked."
                  value={props.systemPrompt}
                  onChange={props.onSystemPromptChange}
                  rows={4}
                  required
                  invalid={customerPromptMissing}
                />
                {customerPromptMissing ? (
                  <AiNotice tone="error" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
                    <span className="block">
                      The AI has no instructions of its own, so replies fall back to a generic assistant.
                    </span>
                    <button
                      type="button"
                      onClick={() => props.onSystemPromptChange(STARTER_CUSTOMER_PROMPT)}
                      className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[11.5px] font-semibold text-[#4A5AE8] ring-1 ring-[#5B6CF9]/25 transition-colors hover:bg-[#EEF0FF]"
                    >
                      <Sparkles className="h-3 w-3" />
                      Start from a template
                    </button>
                  </AiNotice>
                ) : (
                  <AiHint>
                    Shapes replies sent to real people on WhatsApp, Instagram, Messenger, RCS and email. Your company
                    details are added automatically, so this is for tone and rules — not for repeating facts. WhatsApp
                    renders *bold* and _italic_ only, and replies are converted for you.
                  </AiHint>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Database className="h-3.5 w-3.5 text-slate-500" />
                  <AiLabel htmlFor="admin-system-prompt">Admin prompt</AiLabel>
                </div>
                <AiPromptEditor
                  id="admin-system-prompt"
                  title="Admin prompt"
                  subtitle="Shapes answers about your own CRM data, for your team."
                  placeholder="Answer in short tables. Always show totals. Flag anything that looks like a drop week over week."
                  value={props.adminSystemPrompt}
                  onChange={props.onAdminSystemPromptChange}
                  rows={3}
                />
                <AiHint>
                  Shapes Admin Test answers about your own CRM data. Kept separate on purpose — tuning the customer
                  tone should not change how your numbers are reported.
                </AiHint>
              </div>

              <div className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 p-3.5">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-slate-700">Let replies use the customer&apos;s own record</p>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">
                    Adds that one person&apos;s enquiry stage, recent follow-ups, tags and which ad they came from — so
                    the same customer is recognised across every channel instead of starting over each time. Never
                    includes anyone else&apos;s data.
                  </p>
                </div>
                <Switch
                  checked={props.customerContextEnabled}
                  onCheckedChange={props.onCustomerContextEnabledChange}
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ── Guardrails ── */}
        <AccordionItem value="guardrails">
          <AccordionTrigger className="text-[13.5px]">
            <span className="flex min-w-0 items-center gap-2.5">
              <AiIconTile tint="amber" size="sm">
                <ShieldQuestion className="h-4 w-4" />
              </AiIconTile>
              <span className="min-w-0 text-left">
                <span className="block font-medium text-slate-800">Guardrails</span>
                <span className="block text-[11.5px] font-normal text-slate-500">
                  What to say when it doesn&apos;t know, and what never to answer.
                </span>
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pb-4">
              <div className="space-y-1.5">
                <AiLabel htmlFor="fallback-answer">Fallback answer</AiLabel>
                <AiInput
                  id="fallback-answer"
                  placeholder="I'm not sure about that — let me check with the team and get back to you."
                  value={props.fallbackAnswer}
                  onChange={(e) => props.onFallbackAnswerChange(e.target.value)}
                  className="h-9"
                />
                <AiHint>
                  Prompt-level guidance, not a hard rule — a model can still ignore it. The confidence handoff below
                  is the version that&apos;s enforced in code.
                </AiHint>
              </div>

              <div className="space-y-1.5">
                <AiLabel>Never answer these topics</AiLabel>
                <div className="flex gap-2">
                  <AiInput
                    value={props.topicInput}
                    onChange={(e) => props.onTopicInputChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        props.onAddTopic();
                      }
                    }}
                    placeholder="refunds, legal advice, medical questions…"
                    className="h-9"
                  />
                  <AiButton tone="outline" size="sm" onClick={props.onAddTopic} className="h-9 shrink-0">
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </AiButton>
                </div>
                {props.escalationTopics.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {props.escalationTopics.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-100 py-1 pl-2.5 pr-1.5 text-[12px] text-slate-700 ring-1 ring-slate-200/60"
                      >
                        {t}
                        <button
                          type="button"
                          onClick={() => props.onRemoveTopic(t)}
                          className="text-slate-400 transition-colors hover:text-rose-500"
                          aria-label={`Remove ${t}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ── Confidence handoff ── */}
        <AccordionItem value="handoff">
          <AccordionTrigger className="text-[13.5px]">
            <span className="flex min-w-0 items-center gap-2.5">
              <AiIconTile tint="emerald" size="sm">
                <UserCheck className="h-4 w-4" />
              </AiIconTile>
              <span className="min-w-0 text-left">
                <span className="block font-medium text-slate-800">Hand off when unsure</span>
                <span className="block text-[11.5px] font-normal text-slate-500">
                  Pass the chat to a human instead of guessing. {props.lowConfidenceHandoffEnabled ? 'On' : 'Off'}.
                </span>
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pb-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[12.5px] leading-relaxed text-slate-500">
                  Enforced in code, not just asked for in the prompt: below the threshold the model is never called —
                  the customer gets the holding message and a human is assigned.
                  {!props.semanticSearchAvailable && ' Without a Gemini key this scores on keyword overlap, which is a blunter measure.'}
                </p>
                <Switch
                  checked={props.lowConfidenceHandoffEnabled}
                  onCheckedChange={props.onLowConfidenceHandoffEnabledChange}
                />
              </div>

              {props.lowConfidenceHandoffEnabled && (
                <>
                  <div className="space-y-1.5">
                    <AiLabel>
                      Confidence threshold
                      <span className="ml-2 text-[11px] font-normal text-slate-400">
                        {props.confidenceThreshold.toFixed(2)} — higher hands off more often
                      </span>
                    </AiLabel>
                    <input
                      autoComplete="off"
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={props.confidenceThreshold}
                      onChange={(e) => props.onConfidenceThresholdChange(Number(e.target.value))}
                      className="w-full accent-[#5B6CF9]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <AiLabel>Assign to</AiLabel>
                    <Select
                      value={props.lowConfidenceAssignTo || '__unassigned__'}
                      onValueChange={(v) =>
                        props.onLowConfidenceAssignToChange(!v || v === '__unassigned__' ? '' : v)
                      }
                    >
                      <SelectTrigger className="h-9 w-full rounded-xl border-slate-200 text-[13px]">
                        <SelectValue placeholder="Select an agent (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__unassigned__">Unassigned — just move to pending</SelectItem>
                        {props.agents.map((a) => (
                          <SelectItem key={a.user_id} value={a.user_id}>{a.full_name || a.user_id}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <AiLabel htmlFor="low-confidence-message">Message sent before handoff</AiLabel>
                    <AiInput
                      id="low-confidence-message"
                      placeholder="Let me connect you with a team member who can help with that."
                      value={props.lowConfidenceMessage}
                      onChange={(e) => props.onLowConfidenceMessageChange(e.target.value)}
                      className="h-9"
                    />
                  </div>
                </>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ── Accuracy & Voice ── */}
        <AccordionItem value="accuracy">
          <AccordionTrigger className="text-[13.5px]">
            <span className="flex min-w-0 items-center gap-2.5">
              <AiIconTile tint="violet" size="sm">
                <BadgeCheck className="h-4 w-4" />
              </AiIconTile>
              <span className="min-w-0 text-left">
                <span className="block font-medium text-slate-800">Accuracy checks</span>
                <span className="block text-[11.5px] font-normal text-slate-500">
                  Checks before a reply is sent, and answering voice notes by voice.
                </span>
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pb-4">

              <div className="flex items-start justify-between gap-4 rounded-2xl bg-[#F7F8FC] p-3.5 ring-1 ring-slate-200/70">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-slate-800">Check facts before sending</p>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">
                    Every price, date, phone number and link in a reply is checked against the knowledge it came
                    from. Anything that appears nowhere in your material is treated as invented, and the
                    conversation goes to a person instead of the customer receiving a made-up figure.
                  </p>
                </div>
                <Switch
                  checked={props.responseValidationEnabled}
                  onCheckedChange={props.onResponseValidationEnabledChange}
                />
              </div>

              <div className="flex items-start justify-between gap-4 rounded-2xl bg-[#F7F8FC] p-3.5 ring-1 ring-slate-200/70">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-slate-800">Smarter handoff decisions</p>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">
                    Also considers whether the question was too vague to answer, whether the customer has asked
                    the same thing several times, and whether they sound frustrated — not just how well the
                    knowledge base matched. Turn off to judge on knowledge match alone.
                  </p>
                </div>
                <Switch
                  checked={props.compositeConfidenceEnabled}
                  onCheckedChange={props.onCompositeConfidenceEnabledChange}
                />
              </div>

            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ── Voice replies ── */}
        <AccordionItem value="voice">
          <AccordionTrigger className="text-[13.5px]">
            <span className="flex min-w-0 items-center gap-2.5">
              <AiIconTile tint="emerald" size="sm">
                <Mic className="h-4 w-4" />
              </AiIconTile>
              <span className="min-w-0 text-left">
                <span className="block font-medium text-slate-800">Voice replies</span>
                <span className="block text-[11.5px] font-normal text-slate-500">
                  How the assistant answers a customer&apos;s voice note, and which voice it uses.
                </span>
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pb-4">
              {/* States both outcomes. "Reply to voice notes with voice"
                  leaves the off case to be inferred, and the off case is
                  exactly what somebody choosing between them wants to
                  know. */}
              <div className="rounded-2xl bg-[#F7F8FC] p-3.5 ring-1 ring-slate-200/70">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-slate-800">
                      When a customer sends a voice note
                    </p>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">
                      Someone who records a voice message usually does so because typing is awkward — in their
                      language, or at that moment. A typed question always gets a typed answer either way.
                    </p>
                  </div>
                  <Switch checked={props.voiceReplyEnabled} onCheckedChange={props.onVoiceReplyEnabledChange} />
                </div>

                {/* Without this the card claims a spoken reply while
                    nothing is replying — which is exactly what happened:
                    voice notes arrived, were transcribed, and sat there,
                    with this section reading On the whole time. */}
                {!props.assistantAnswersUnmatched && (
                  <div className="mt-2.5 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900 ring-1 ring-amber-500/20">
                    <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0" />
                    <span>
                      This only applies where the assistant actually answers. Right now it answers inside
                      chatbots that use an AI step, but not messages no chatbot matched — turn on{' '}
                      <span className="font-semibold">Answer messages no chatbot matched</span> on the Chatbots
                      page for that.
                    </span>
                  </div>
                )}

                <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
                  <div
                    className={[
                      'rounded-xl px-3 py-2 text-[11.5px] leading-relaxed ring-1 transition-colors',
                      props.voiceReplyEnabled
                        ? 'bg-emerald-50 text-emerald-900 ring-emerald-500/20'
                        : 'bg-white text-slate-400 ring-slate-200/70',
                    ].join(' ')}
                  >
                    <span className="block font-semibold">
                      {props.voiceReplyEnabled ? 'On — they hear a spoken reply' : 'On'}
                    </span>
                    <span className="block">Answered in the language they spoke, as a voice note.</span>
                  </div>
                  <div
                    className={[
                      'rounded-xl px-3 py-2 text-[11.5px] leading-relaxed ring-1 transition-colors',
                      props.voiceReplyEnabled
                        ? 'bg-white text-slate-400 ring-slate-200/70'
                        : 'bg-slate-100 text-slate-700 ring-slate-300/60',
                    ].join(' ')}
                  >
                    <span className="block font-semibold">
                      {props.voiceReplyEnabled ? 'Off' : 'Off — they read a written reply'}
                    </span>
                    <span className="block">Their voice note is transcribed and answered in text.</span>
                  </div>
                </div>
              </div>

              {/* Not gated on the voice toggle above. Adding the key
                  before switching voice on is the natural order, and
                  hiding it behind a switch made it unfindable — reported
                  as "the upload option is not there". */}
              <TtsCredentialsCard />

              {props.voiceReplyEnabled && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <AiLabel>Voice</AiLabel>
                    {props.cloudTtsAvailable ? (
                      <>
                        <Select
                          value={props.cloudVoice || 'Achernar'}
                          onValueChange={(v) => v && props.onCloudVoiceChange(v)}
                        >
                          <SelectTrigger className="h-9 w-full rounded-xl border-slate-200 text-[13px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CLOUD_VOICE_CHARACTERS.map((v) => (
                              <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <AiHint>
                          Google Cloud voices. A Malayalam reply is spoken by a Malayalam voice and a Tamil one by
                          a Tamil voice &mdash; the language comes from the reply itself, so this single choice
                          sounds like the same person throughout.
                        </AiHint>
                      </>
                    ) : (
                      <>
                        <Select
                          value={props.voiceName || 'Kore'}
                          onValueChange={(v) => v && props.onVoiceNameChange(v)}
                        >
                          <SelectTrigger className="h-9 w-full rounded-xl border-slate-200 text-[13px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TTS_VOICES.map((v) => (
                              <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <AiHint>
                          Built-in voices. Adding Google Cloud credentials on the server gets native Malayalam and
                          Tamil voices, replies in about a second instead of eight, and true voice notes rather
                          than audio attachments.
                        </AiHint>
                      </>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <AiLabel htmlFor="voice-max-chars">
                      Speak replies up to
                      <span className="ml-2 text-[11px] font-normal text-slate-400">
                        {props.voiceMaxChars} characters
                      </span>
                    </AiLabel>
                    <input
                      id="voice-max-chars"
                      autoComplete="off"
                      type="range"
                      min={200}
                      max={2000}
                      step={50}
                      value={props.voiceMaxChars}
                      onChange={(e) => props.onVoiceMaxCharsChange(Number(e.target.value))}
                      className="w-full accent-[#5B6CF9]"
                    />
                    <AiHint>
                      Longer answers are sent as text instead. A spoken reply full of fees and dates can&apos;t be
                      skimmed or screenshotted, which is exactly what people do with those.
                    </AiHint>
                  </div>
                </div>
              )}

              <div className="flex items-start justify-between gap-4 rounded-2xl bg-[#F7F8FC] p-3.5 ring-1 ring-slate-200/70">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-slate-800">Live voice console</p>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">
                    Adds a panel to Test AI where you speak to the assistant and hear it answer in real time,
                    interruptions and all. A rehearsal tool &mdash; customers reach the assistant by voice note,
                    not by call. It streams audio both ways for as long as it is open, which is billed
                    differently from a text reply.
                  </p>
                </div>
                <Switch checked={props.liveVoiceEnabled} onCheckedChange={props.onLiveVoiceEnabledChange} />
              </div>

              {props.liveVoiceEnabled && (
                <div className="space-y-1.5">
                  <AiLabel>Live conversation voice</AiLabel>
                  <Select
                    value={props.liveVoiceName || 'Kore'}
                    onValueChange={(v) => v && props.onLiveVoiceNameChange(v)}
                  >
                    <SelectTrigger className="h-9 w-full rounded-xl border-slate-200 text-[13px] sm:max-w-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TTS_VOICES.map((v) => (
                        <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <AiHint>
                    A live conversation speaks with its own voice set, separate from the one used for voice notes.
                  </AiHint>
                </div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </AiCard>
  );
}
