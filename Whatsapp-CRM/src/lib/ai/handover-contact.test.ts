import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * "I have retired — ring the new secretary on this number."
 *
 * The rule under test is the one that is easy to get wrong in the
 * helpful direction: the number is written down, and the contact is
 * not changed. A number arrives as text, read out by one person and
 * typed by another, often without a country code. Overwriting an
 * organisation's only working number on that basis loses the one that
 * worked and leaves nothing that does.
 */

const contact = vi.hoisted(() => ({ findFirst: vi.fn(), update: vi.fn(), create: vi.fn() }))
const contactNote = vi.hoisted(() => ({ create: vi.fn(), createMany: vi.fn() }))
const task = vi.hoisted(() => ({ create: vi.fn() }))
const account = vi.hoisted(() => ({ findUnique: vi.fn() }))

vi.mock('@/lib/db', () => ({ prisma: { contact, contactNote, task, account } }))

import { recordContactHandover } from './handover-contact'

const FROM = {
  id: 'c-old',
  name: 'Ramesh',
  phone: '919526218159',
  company: 'TVPM-PACS',
}

beforeEach(() => {
  vi.clearAllMocks()
  contact.findFirst.mockResolvedValue(FROM)
  account.findUnique.mockResolvedValue({ owner_user_id: 'owner-1' })
  contactNote.create.mockResolvedValue({})
  task.create.mockResolvedValue({})
})

const base = { accountId: 'acc-1', fromContactId: 'c-old' }

describe('recordContactHandover', () => {
  it('never touches the contact', async () => {
    // The whole point. Everything else here is detail.
    await recordContactHandover({ ...base, newPhone: '9847012345' })
    expect(contact.update).not.toHaveBeenCalled()
    expect(contact.create).not.toHaveBeenCalled()
  })

  it('writes a note and a task a person will see', async () => {
    const res = await recordContactHandover({
      ...base,
      newPhone: '9847012345',
      newName: 'Suresh',
      said: 'I am retired from service',
    })

    expect(res.recorded).toBe(true)
    expect(contactNote.create).toHaveBeenCalledOnce()
    expect(task.create).toHaveBeenCalledOnce()

    const note = contactNote.create.mock.calls[0][0].data.note_text
    expect(note).toContain('TVPM-PACS')
    expect(note).toContain('9847012345')
    expect(note).toContain('Suresh')
    // Their own words, so whoever reads it is not relying on a summary.
    expect(note).toContain('I am retired from service')
    // And the state of it, plainly.
    expect(note).toMatch(/not yet confirmed/i)
  })

  it('keeps the number exactly as the customer wrote it', async () => {
    // The stripped version is for comparing. A country code they typed
    // is information, and the person dialling wants what was said.
    await recordContactHandover({ ...base, newPhone: '+91 98470 12345' })
    const note = contactNote.create.mock.calls[0][0].data.note_text
    expect(note).toContain('+91 98470 12345')
  })

  it('tells the assistant not to claim the records changed', async () => {
    const res = await recordContactHandover({ ...base, newPhone: '9847012345' })
    expect(res.note).toMatch(/do NOT say our records have been updated/i)
  })

  it('raises it as high priority', async () => {
    // Ignoring it means the next campaign rings somebody who has left.
    await recordContactHandover({ ...base, newPhone: '9847012345' })
    expect(task.create.mock.calls[0][0].data.priority).toBe('high')
  })

  describe('what it refuses', () => {
    it('refuses something that is not a number', async () => {
      for (const junk of ['call the office', '', '12', 'I will send it later']) {
        const res = await recordContactHandover({ ...base, newPhone: junk })
        expect(res.recorded, junk).toBe(false)
      }
      expect(contactNote.create).not.toHaveBeenCalled()
      expect(task.create).not.toHaveBeenCalled()
    })

    it('refuses an absurdly long one', async () => {
      const res = await recordContactHandover({ ...base, newPhone: '1234567890123456789' })
      expect(res.recorded).toBe(false)
    })

    it('refuses the number we are already talking to them on', async () => {
      // Different formatting, same person. Recording it would create a
      // task to ring the number already in hand.
      const res = await recordContactHandover({ ...base, newPhone: '+91 95262 18159' })
      expect(res.recorded).toBe(false)
      expect(res.note).toMatch(/already speaking to them on/i)
      expect(task.create).not.toHaveBeenCalled()
    })

    it('refuses a contact that is not in this account', async () => {
      contact.findFirst.mockResolvedValue(null)
      const res = await recordContactHandover({ ...base, newPhone: '9847012345' })
      expect(res.recorded).toBe(false)
      expect(task.create).not.toHaveBeenCalled()
    })
  })

  it('still records when no name was given', async () => {
    const res = await recordContactHandover({ ...base, newPhone: '9847012345' })
    expect(res.recorded).toBe(true)
    expect(contactNote.create.mock.calls[0][0].data.note_text).toMatch(/whoever has taken over/i)
  })

  it('falls back to the contact name when there is no company', async () => {
    contact.findFirst.mockResolvedValue({ ...FROM, company: null })
    await recordContactHandover({ ...base, newPhone: '9847012345' })
    expect(task.create.mock.calls[0][0].data.title).toContain('Ramesh')
  })
})
