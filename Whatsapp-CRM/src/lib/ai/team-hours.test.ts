import { describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  rotas: [] as unknown[],
  channel: 'website',
  notes: [] as string[],
  sent: [] as string[],
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: { findMany: () => Promise.resolve(db.rotas.map((r) => ({ working_hours: r }))) },
    conversation: { findFirst: () => Promise.resolve({ channel: db.channel }) },
    message: {
      findFirst: (a: { where: { content_text: string } }) =>
        Promise.resolve([...db.notes, ...db.sent].includes(a.where.content_text) ? { id: 'm' } : null),
      create: (a: { data: { content_text: string } }) => {
        db.notes.push(a.data.content_text)
        return Promise.resolve({ id: 'n' })
      },
    },
  },
}))
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendText: (a: { text: string }) => {
    db.sent.push(a.text)
    return Promise.resolve({ whatsapp_message_id: 'w1' })
  },
}))

import { DEFAULT_WEEK } from '@/lib/agents/working-hours'
import { closedLine, OUTSIDE_HOURS_NOTE, teamHoursFrom, teamHoursPromptBlock, tellHandover } from './team-hours'

const rota = { timezone: 'Asia/Kolkata', week: DEFAULT_WEEK }
// Thursday 15 Oct 2026, India time.
const at = (hhmm: string) => new Date(`2026-10-15T${hhmm}:00+05:30`)

describe('is the team at work', () => {
  it('is open inside somebody\'s shift', () => {
    expect(teamHoursFrom([rota], at('10:30')).open).toBe(true)
  })

  // Live, 13 Oct: the assistant told a customer at 22:14 that "our team
  // will contact you soon", with nobody on shift until morning.
  it('is closed at night, and says when it opens', () => {
    const team = teamHoursFrom([rota], at('22:14'))
    expect(team.open).toBe(false)
    expect(team.back).toBe('tomorrow 9:00 AM')
  })

  it('counts as open when nobody has set hours', () => {
    expect(teamHoursFrom([null, {}], at('22:14'))).toEqual({ open: true, hours: null, back: null })
  })

  it('is open while any one member is on shift', () => {
    const night = { timezone: 'Asia/Kolkata', week: { ...DEFAULT_WEEK, thu: { mode: 'full', from: '20:00', to: '23:59' } } }
    expect(teamHoursFrom([rota, night], at('22:14')).open).toBe(true)
  })
})

describe('what the assistant is told', () => {
  it('forbids promising a person soon when the team is closed', () => {
    const block = teamHoursPromptBlock(teamHoursFrom([rota], at('22:14')))
    expect(block).toContain('Nobody from the team is working right now')
    expect(block).toContain('back tomorrow 9:00 AM')
    expect(block).toContain('schedule_callback')
  })

  it('says the team is in when it is', () => {
    expect(teamHoursPromptBlock(teamHoursFrom([rota], at('10:30')))).toContain('The team is at work now')
  })

  it('says nothing when no hours are set', () => {
    expect(teamHoursPromptBlock(teamHoursFrom([], at('22:14')))).toBe('')
  })
})

describe('what the customer is told when the team is closed', () => {
  const closed = teamHoursFrom([rota], at('22:14'))

  it('gives the hours and asks for a time, in their language', () => {
    expect(closedLine('en', closed, false)).toMatch(/not available right now.*Working hours: .*back tomorrow 9:00 AM.*Tell us a time/)
    expect(closedLine('ml', closed, true)).toContain('ഞങ്ങളുടെ ടീം ഇപ്പോൾ ലഭ്യമല്ല')
  })

  it('never promises a reply soon', () => {
    for (const line of [closedLine('en', closed, true), closedLine('en', closed, false)]) {
      expect(line).not.toMatch(/shortly|soon|right away/i)
    }
  })
})

describe('telling the customer on any channel', () => {
  const args = (now: Date) => ({
    accountId: 'a', userId: 'u', conversationId: 'c', contactId: 'k',
    customerText: 'Can someone call me?', openLine: 'Connecting you with our team.', now,
  })

  it('gives a closed website visitor the hours instead of "connecting", and only once', async () => {
    Object.assign(db, { rotas: [rota], channel: 'website', notes: [], sent: [] })
    expect((await tellHandover(args(at('22:14')))).closed).toBe(true)
    await tellHandover(args(at('22:20')))
    expect(db.sent).toHaveLength(1)
    expect(db.sent[0]).toContain('Our team is not available right now')
    expect(db.notes).toEqual([OUTSIDE_HOURS_NOTE])
  })

  it('uses the usual line while the team is in', async () => {
    Object.assign(db, { rotas: [rota], channel: 'instagram', notes: [], sent: [] })
    expect((await tellHandover(args(at('10:30')))).closed).toBe(false)
    expect(db.sent).toEqual(['Connecting you with our team.'])
  })
})
