import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── The world, simulated ────────────────────────────────────────────
const h = vi.hoisted(() => ({
  notes: [] as Array<{ content_text: string; created_at: Date }>,
  customerSaid: 'ഒക്ടോബർ മാസം ഏതൊക്കെ ട്രെയിനിങ്?',
  rota: null as unknown,
  offerResult: { result: 'offered', offerId: 'o1', userId: 'agent-1', reason: 'least busy' } as Record<string, unknown>,
  sent: [] as string[],
  buttons: [] as Array<{ body: string; ids: string[] }>,
  alerts: 0,
  callbacks: [] as Array<{ intro?: string }>,
  statusUpdates: [] as string[],
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    message: {
      findMany: async () => [...h.notes].sort((a, b) => b.created_at.getTime() - a.created_at.getTime()),
      findFirst: async () => ({ content_text: h.customerSaid }),
      create: async ({ data }: { data: { content_text: string } }) => {
        h.notes.push({ content_text: data.content_text, created_at: new Date() })
        return data
      },
    },
    conversation: {
      findFirst: async () => ({ contact_id: 'c1', contact: { name: 'A Customer', phone: '919800000000' } }),
      update: async ({ data }: { data: { status: string } }) => {
        h.statusUpdates.push(data.status)
        return data
      },
    },
    account: { findUnique: async () => ({ owner_user_id: 'owner-1' }) },
    aiConfig: { findUnique: async () => ({ low_confidence_assign_to: null }) },
    profile: {
      findMany: async () => [{ working_hours: h.rota }],
      findFirst: async () => ({ full_name: 'Aparna L S' }),
    },
  },
}))
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendText: async ({ text }: { text: string }) => {
    h.sent.push(text)
    return { whatsapp_message_id: 'w1' }
  },
  engineSendInteractiveButtons: async ({ bodyText, buttons }: { bodyText: string; buttons: Array<{ id: string }> }) => {
    h.buttons.push({ body: bodyText, ids: buttons.map((b) => b.id) })
    return { whatsapp_message_id: 'w2' }
  },
}))
vi.mock('./handoff-alert', () => ({ sendHandoffAlert: async () => { h.alerts++ } }))
vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/agents/run-offer', () => ({ offerConversation: async () => h.offerResult }))
vi.mock('@/lib/agents/ask-callback', () => ({
  askForCallbackTime: async (args: { intro?: string }) => {
    h.callbacks.push({ intro: args.intro })
    return { asked: true }
  },
}))

import {
  askForConsent,
  answerConsent,
  consentFromText,
  notifyCustomerConnected,
  parseConsentButton,
} from './handover-consent'

function reset() {
  h.notes = []
  h.sent = []
  h.buttons = []
  h.alerts = 0
  h.callbacks = []
  h.statusUpdates = []
  h.rota = null
  h.customerSaid = 'ഒക്ടോബർ മാസം ഏതൊക്കെ ട്രെയിനിങ്?'
  h.offerResult = { result: 'offered', offerId: 'o1', userId: 'agent-1', reason: 'least busy' }
}

const ASK = {
  accountId: 'acc',
  userId: 'owner-1',
  conversationId: 'conv',
  contactId: 'c1',
  reason: 'low_confidence',
  handoffNote: 'The assistant was not confident enough to answer',
  customerMessage: 'ഒക്ടോബർ മാസം ഏതൊക്കെ ട്രെയിനിങ്?',
}

describe('reading the answer', () => {
  it('reads a tapped button, and ignores an old or foreign one', () => {
    const now = Date.now()
    expect(parseConsentButton(`ho_yes_${now - 1000}`, now)).toBe('yes')
    expect(parseConsentButton(`ho_no_${now - 1000}`, now)).toBe('no')
    expect(parseConsentButton(`ho_yes_${now - 2 * 24 * 3600_000}`, now)).toBeNull()
    expect(parseConsentButton('cb_123_abc', now)).toBeNull()
  })

  it('reads a typed answer only when the whole message is the answer', () => {
    expect(consentFromText('അതെ')).toBe('yes')
    expect(consentFromText('Yes please!')).toBe('yes')
    expect(consentFromText('വേണ്ട')).toBe('no')
    expect(consentFromText('ok, what is the fee?')).toBeNull()
    expect(consentFromText('ആ പ്രോഗ്രാം എപ്പോൾ')).toBeNull()
  })
})

describe('asking first', () => {
  beforeEach(reset)

  it('asks in the customer\'s language, writes the note, and does not ask twice in a row', async () => {
    expect(await askForConsent(ASK)).toBe('asked')
    expect(h.buttons[0].body).toMatch(/ടീമിലെ/)
    expect(h.buttons[0].ids[0]).toMatch(/^ho_yes_\d+$/)
    expect(h.notes[0].content_text).toMatch(/^Offered to connect the customer to a person \(reason: low_confidence\)/)
    expect(h.statusUpdates).toEqual([]) // nothing handed over yet
    expect(await askForConsent(ASK)).toBe('already_asked')
  })

  it('carries on when they say no', async () => {
    await askForConsent(ASK)
    expect(await answerConsent({ accountId: 'acc', conversationId: 'conv', answer: 'no' })).toBe(true)
    expect(h.sent[0]).toMatch(/ചോദിക്കൂ/)
    expect(h.statusUpdates).toEqual([])
    expect(h.alerts).toBe(0)
  })

  it('inside working hours: alerts staff, offers it to an agent, says it is connecting', async () => {
    await askForConsent(ASK)
    h.customerSaid = 'അതെ'
    expect(await answerConsent({ accountId: 'acc', conversationId: 'conv', answer: 'yes' })).toBe(true)
    expect(h.statusUpdates).toEqual(['pending'])
    expect(h.alerts).toBe(1)
    expect(h.sent[0]).toMatch(/ബന്ധിപ്പിക്കുന്നു/)
    expect(h.callbacks).toEqual([])
  })

  it('outside working hours: tells them the hours and offers a call back', async () => {
    // Monday to Saturday 09:30–17:30 in Kolkata, asked on a Sunday.
    const day = { mode: 'full', from: '09:30', to: '17:30' }
    h.rota = {
      timezone: 'Asia/Kolkata',
      week: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: { mode: 'off', from: '09:30', to: '17:30' } },
    }
    await askForConsent(ASK)
    h.customerSaid = 'Yes, connect me'
    const sunday = new Date('2026-09-27T12:00:00+05:30')
    expect(await answerConsent({ accountId: 'acc', conversationId: 'conv', answer: 'yes', now: sunday })).toBe(true)
    expect(h.alerts).toBe(1)
    expect(h.callbacks).toHaveLength(1)
    expect(h.callbacks[0].intro).toMatch(/not available right now/)
    expect(h.sent).toEqual([])
  })

  it('when nobody takes it, offers a call back', async () => {
    h.offerResult = { result: 'exhausted', reason: 'nobody was available' }
    await askForConsent(ASK)
    expect(await answerConsent({ accountId: 'acc', conversationId: 'conv', answer: 'yes' })).toBe(true)
    expect(h.callbacks).toHaveLength(1)
  })

  it('ignores a yes or no when nothing was asked', async () => {
    expect(await answerConsent({ accountId: 'acc', conversationId: 'conv', answer: 'yes' })).toBe(false)
    expect(h.sent).toEqual([])
  })
})

describe('once an agent accepts', () => {
  beforeEach(reset)

  it('tells the customer who has them', async () => {
    await notifyCustomerConnected({ accountId: 'acc', conversationId: 'conv', agentUserId: 'agent-1' })
    expect(h.sent[0]).toBe('✅ Aparna ഇപ്പോൾ നിങ്ങളോടൊപ്പമുണ്ട്, ഇവിടെ മറുപടി നൽകും.')
  })
})
