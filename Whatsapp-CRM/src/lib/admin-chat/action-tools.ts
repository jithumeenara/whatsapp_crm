/**
 * The tools the assistant gets for an admin with "actions" access. Each
 * only PROPOSES — the result tells the model the request is waiting for
 * the admin's YES, and the engine adds the confirmation line itself (the
 * code never passes through the model).
 */

import { SchemaType, type FunctionDeclaration } from '@google/generative-ai'
import type { ActionKind } from './action-rules'
import { proposeAction, type ActionContext } from './actions'

const phone = { type: SchemaType.STRING, description: "The person's phone number with country code, as the admin gave it." } as const

export const ACTION_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'propose_follow_up',
    description: 'Propose a follow-up reminder for a contact. Nothing happens until the admin confirms.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        phone,
        title: { type: SchemaType.STRING, description: 'What to follow up about, short.' },
        when: { type: SchemaType.STRING, description: 'Local date and time as YYYY-MM-DD HH:MM (24-hour). Work it out from "tomorrow 10am" using today\'s date.' },
        note: { type: SchemaType.STRING, description: 'Optional note.' },
      },
      required: ['phone', 'title', 'when'],
    },
  },
  {
    name: 'propose_tag',
    description: 'Propose adding an existing tag to a contact.',
    parameters: { type: SchemaType.OBJECT, properties: { phone, tag: { type: SchemaType.STRING, description: 'Tag name' } }, required: ['phone', 'tag'] },
  },
  {
    name: 'propose_assign',
    description: "Propose assigning a contact's open chat to a team member.",
    parameters: { type: SchemaType.OBJECT, properties: { phone, agent: { type: SchemaType.STRING, description: "Team member's name" } }, required: ['phone', 'agent'] },
  },
  {
    name: 'propose_lead',
    description: 'Propose creating a lead for a phone number (the contact is created if new).',
    parameters: {
      type: SchemaType.OBJECT,
      properties: { phone, name: { type: SchemaType.STRING, description: "The person's name, if given" }, note: { type: SchemaType.STRING, description: 'What they want' } },
      required: ['phone'],
    },
  },
  {
    name: 'propose_template',
    description: 'Propose sending an approved WhatsApp template to one person. Needs the admin to confirm in the CRM as well.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        phone,
        template: { type: SchemaType.STRING, description: 'Template name' },
        values: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: 'Values for the template variables, in order. Empty if it has none.' },
      },
      required: ['phone', 'template'],
    },
  },
  {
    name: 'propose_broadcast',
    description: 'Propose preparing a broadcast DRAFT of a template (without variables) to everyone with a tag. It is only a draft; it is sent from the Broadcasts page.',
    parameters: { type: SchemaType.OBJECT, properties: { tag: { type: SchemaType.STRING }, template: { type: SchemaType.STRING } }, required: ['tag', 'template'] },
  },
]

const KIND: Record<string, ActionKind> = {
  propose_follow_up: 'add_follow_up',
  propose_tag: 'add_tag',
  propose_assign: 'assign_chat',
  propose_lead: 'create_lead',
  propose_template: 'send_template',
  propose_broadcast: 'prepare_broadcast',
}

/** Tools bound to one admin's turn; `proposals` collects what was proposed. */
export function actionToolsFor(ctx: ActionContext) {
  const proposals: Array<{ code: string; summary: string }> = []
  return {
    proposals,
    declarations: ACTION_TOOL_DECLARATIONS,
    names: Object.keys(KIND),
    async run(name: string, args: Record<string, unknown>): Promise<unknown> {
      const kind = KIND[name]
      if (!kind) return { error: 'Unknown tool.' }
      const r = await proposeAction(ctx, kind, args)
      if (!r.ok) return { error: r.error }
      proposals.length = 0 // only the latest proposal can be confirmed
      proposals.push({ code: r.code, summary: r.summary })
      return { status: 'waiting_for_admin_confirmation', summary: r.summary, note: 'Tell the admin what will happen. The confirmation instructions are added automatically — do not invent a code.' }
    },
  }
}
