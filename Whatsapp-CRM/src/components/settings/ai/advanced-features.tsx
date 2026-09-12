'use client';

import { Sliders, ShieldQuestion, UserCheck, X, Plus } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AiButton, AiCard, AiCardHeader, AiIconTile, AiInput, AiTextarea, AiLabel, AiHint } from './ui-kit';
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
}

export function AdvancedFeatures(props: AdvancedFeaturesProps) {
  return (
    <AiCard>
      <div className="px-6 pt-5">
        <AiCardHeader title="Advanced Features" subtitle="Improve accuracy and control behavior." />
      </div>

      <Accordion className="px-6 pb-2">
        {/* ── Persona / system prompt ── */}
        <AccordionItem value="persona">
          <AccordionTrigger className="text-[13.5px]">
            <span className="flex items-center gap-2.5">
              <AiIconTile tint="indigo" size="sm">
                <Sliders className="h-4 w-4" />
              </AiIconTile>
              <span className="text-left">
                <span className="block font-medium text-slate-800">Prompt &amp; Persona</span>
                <span className="block text-[11.5px] font-normal text-slate-500">
                  Who the assistant is and how it should speak.
                </span>
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-1.5 pb-4 pl-[42px]">
              <AiLabel htmlFor="system-prompt">System Prompt</AiLabel>
              <AiTextarea
                id="system-prompt"
                placeholder="You are a helpful assistant for [Your Business]. Be friendly and concise."
                value={props.systemPrompt}
                onChange={(e) => props.onSystemPromptChange(e.target.value)}
                rows={4}
              />
              <AiHint>
                Keep it short and clear. WhatsApp renders *bold* and _italic_ only — replies are converted
                automatically, so there&apos;s no need to ask for Markdown here.
              </AiHint>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ── Guardrails ── */}
        <AccordionItem value="guardrails">
          <AccordionTrigger className="text-[13.5px]">
            <span className="flex items-center gap-2.5">
              <AiIconTile tint="amber" size="sm">
                <ShieldQuestion className="h-4 w-4" />
              </AiIconTile>
              <span className="text-left">
                <span className="block font-medium text-slate-800">Guardrails</span>
                <span className="block text-[11.5px] font-normal text-slate-500">
                  What to say when it doesn&apos;t know, and what never to answer.
                </span>
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pb-4 pl-[42px]">
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
            <span className="flex items-center gap-2.5">
              <AiIconTile tint="emerald" size="sm">
                <UserCheck className="h-4 w-4" />
              </AiIconTile>
              <span className="text-left">
                <span className="block font-medium text-slate-800">Hand off when unsure</span>
                <span className="block text-[11.5px] font-normal text-slate-500">
                  Pass the chat to a human instead of guessing. {props.lowConfidenceHandoffEnabled ? 'On' : 'Off'}.
                </span>
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pb-4 pl-[42px]">
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
      </Accordion>
    </AiCard>
  );
}
