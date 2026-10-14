// What the Add Agent dialog shows and shares once POST /api/account/agents
// has created the login: the shape that route returns as `member`.
export interface CreatedAgent {
  name: string
  username: string
  whatsapp: string
  password: string
}

/** A phone-number login made by Add Agent — its user email is "<digits>@agent.local". */
export function agentUsername(email: string | null | undefined): string | null {
  const m = /^(\d{7,15})@agent\.local$/i.exec(email ?? '')
  return m ? m[1] : null
}

/**
 * Whether an admin may hand this member a new password. Only phone-number
 * logins (an emailed member has their own password and a reset link), only
 * in the admin's own workspace, never the admin themself, and only a role
 * below admin — an admin cannot take over another admin's login.
 */
export function canIssueAgentPassword(t: {
  email: string | null | undefined
  role: string
  sameAccount: boolean
  isSelf: boolean
}): boolean {
  return (
    t.sameAccount &&
    !t.isSelf &&
    agentUsername(t.email) !== null &&
    (t.role === 'agent' || t.role === 'supervisor' || t.role === 'viewer')
  )
}

/** The rows the dialog displays, in order. */
export function credentialLines(agent: CreatedAgent): { label: string; value: string }[] {
  return [
    { label: 'Username', value: agent.username },
    // The random password the route stored — never the number, which is
    // not the password and would not sign in.
    { label: 'Password', value: agent.password },
  ]
}

/** The WhatsApp message that hands the login to the agent. */
export function credentialsShareText(agent: CreatedAgent, siteUrl: string): string {
  return [
    `Hi ${agent.name}! Here are your WhatsApp CRM login details:`,
    ``,
    `Login URL: ${siteUrl}/login`,
    ...credentialLines(agent).map((l) => `${l.label}: ${l.value}`),
    ``,
    `Please change your password after first login.`,
  ].join('\n')
}
