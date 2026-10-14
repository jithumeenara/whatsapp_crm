import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import { describe, expect, it } from 'vitest'
import { agentUsername, canIssueAgentPassword, credentialLines, credentialsShareText, type CreatedAgent } from './agent-credentials'

// Bug: Settings → Members → Add Agent showed the WhatsApp number as the
// password, but POST /api/account/agents stores a random one — so the
// login an admin handed to the agent never worked.
describe('Add Agent credentials', () => {
  // Exactly what the route does: a random password, hashed for the user row,
  // returned once as member.password.
  async function createAgent(): Promise<{ member: CreatedAgent; passwordHash: string }> {
    const password = randomBytes(16).toString('hex')
    const passwordHash = await bcrypt.hash(password, 4)
    const digits = '919876543210'
    return { member: { name: 'Asha', username: digits, whatsapp: digits, password }, passwordHash }
  }

  it('shows a password that signs in', async () => {
    const { member, passwordHash } = await createAgent()
    const shown = credentialLines(member).find((l) => l.label === 'Password')?.value ?? ''
    expect(shown).toBe(member.password)
    expect(await bcrypt.compare(shown, passwordHash)).toBe(true)
  })

  it('a new password is only for a phone login below admin in this workspace', () => {
    const agent = { email: '919876543210@agent.local', role: 'agent', sameAccount: true, isSelf: false }
    expect(canIssueAgentPassword(agent)).toBe(true)
    expect(canIssueAgentPassword({ ...agent, role: 'supervisor' })).toBe(true)
    expect(canIssueAgentPassword({ ...agent, role: 'admin' })).toBe(false)
    expect(canIssueAgentPassword({ ...agent, role: 'owner' })).toBe(false)
    expect(canIssueAgentPassword({ ...agent, sameAccount: false })).toBe(false)
    expect(canIssueAgentPassword({ ...agent, isSelf: true })).toBe(false)
    expect(canIssueAgentPassword({ ...agent, email: 'asha@clinic.com' })).toBe(false)
    expect(canIssueAgentPassword({ ...agent, email: null })).toBe(false)
    expect(agentUsername('919876543210@agent.local')).toBe('919876543210')
  })

  it('sends the same password in the WhatsApp message', async () => {
    const { member, passwordHash } = await createAgent()
    const text = credentialsShareText(member, 'https://crm.example.com')
    const sent = /^Password: (.*)$/m.exec(text)?.[1] ?? ''
    expect(sent).toBe(member.password)
    expect(await bcrypt.compare(sent, passwordHash)).toBe(true)
    expect(text).toContain(`Username: ${member.username}`)
  })
})
