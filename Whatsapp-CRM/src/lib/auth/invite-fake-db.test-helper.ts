// In-memory stand-in for the handful of Prisma calls the invitation and
// sign-up routes make. Every call yields to the event loop first, the way
// a real database round-trip does, so two requests started together
// genuinely interleave — which is the whole point of the concurrency tests.
import { hashInviteToken } from './invitations'

type Inv = {
  id: string
  account_id: string
  token_hash: string
  role: string
  accepted_at: Date | null
  accepted_by_user_id: string | null
  expires_at: Date
  email?: string | null
}

const tick = () => new Promise((r) => setTimeout(r, 0))

export function makeFakeDb() {
  const state = {
    invitations: [] as Inv[],
    users: [] as { id: string; email: string; password_hash: string | null }[],
    profiles: [] as { user_id: string; account_id: string; account_role: string; email?: string; full_name?: string }[],
    accounts: [] as { id: string; name: string; owner_user_id: string }[],
  }
  let n = 0
  const id = (p: string) => `${p}-${++n}`

  const matchInv = (inv: Inv, where: Record<string, unknown>) => {
    if (where.id !== undefined && inv.id !== where.id) return false
    if (where.token_hash !== undefined && inv.token_hash !== where.token_hash) return false
    if ('accepted_at' in where && where.accepted_at === null && inv.accepted_at !== null) return false
    const exp = where.expires_at as { gt?: Date } | undefined
    if (exp?.gt && !(inv.expires_at > exp.gt)) return false
    const or = where.OR as Array<{ email: string | null }> | undefined
    if (or && !or.some((c) => (c.email === null ? (inv.email ?? null) === null : inv.email === c.email))) return false
    return true
  }

  const db = {
    accountInvitation: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        await tick()
        const inv = state.invitations.find((i) => matchInv(i, where))
        return inv ? { ...inv } : null
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Inv> }) => {
        await tick()
        const inv = state.invitations.find((i) => i.id === where.id)!
        Object.assign(inv, data)
        return { ...inv }
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Inv> }) => {
        await tick()
        // A single conditional UPDATE is atomic in Postgres: match and
        // write happen together, with no yield in between.
        const hits = state.invitations.filter((i) => matchInv(i, where))
        for (const i of hits) Object.assign(i, data)
        return { count: hits.length }
      },
    },
    user: {
      findFirst: async ({ where }: { where: { email: { equals: string } } }) => {
        await tick()
        return state.users.find((u) => u.email.toLowerCase() === where.email.equals.toLowerCase()) ?? null
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        await tick()
        return state.users.find((u) => u.id === where.id) ?? null
      },
      create: async ({ data }: { data: { email: string; password_hash: string } }) => {
        await tick()
        if (state.users.some((u) => u.email === data.email)) throw Object.assign(new Error('unique'), { code: 'P2002' })
        const u = { id: id('user'), ...data }
        state.users.push(u)
        return u
      },
    },
    account: {
      create: async ({ data }: { data: { name: string; owner_user_id: string } }) => {
        await tick()
        const a = { id: id('acc'), ...data }
        state.accounts.push(a)
        return a
      },
      findFirst: async ({ where }: { where: { id: string; owner_user_id: string } }) => {
        await tick()
        return state.accounts.find((a) => a.id === where.id && a.owner_user_id === where.owner_user_id) ?? null
      },
    },
    profile: {
      create: async ({ data }: { data: { user_id: string; account_id: string; account_role: string } }) => {
        await tick()
        state.profiles.push({ ...data })
        return data
      },
      findUnique: async ({ where }: { where: { user_id: string } }) => {
        await tick()
        return state.profiles.find((p) => p.user_id === where.user_id) ?? null
      },
      update: async ({ where, data }: { where: { user_id: string }; data: Record<string, unknown> }) => {
        await tick()
        const p = state.profiles.find((x) => x.user_id === where.user_id)!
        Object.assign(p, data)
        return p
      },
      count: async ({ where }: { where: { account_id: string; user_id?: { not: string } } }) => {
        await tick()
        return state.profiles.filter((p) => p.account_id === where.account_id && (!where.user_id || p.user_id !== where.user_id.not)).length
      },
    },
    // Rolls back on throw, like an interactive Prisma transaction — only
    // ITS OWN writes, so a concurrent transaction's work is untouched.
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const before = new Map(state.invitations.map((i) => [i, { ...i }]))
      const touched = new Set<Inv>()
      const created = new Set<unknown>()
      const remember = <T,>(list: () => T[], call: Promise<unknown>) =>
        call.then((r) => {
          created.add(list()[list().length - 1])
          return r
        })
      const tx = {
        ...db,
        user: { ...db.user, create: (a: Parameters<typeof db.user.create>[0]) => remember(() => state.users, db.user.create(a)) },
        profile: { ...db.profile, create: (a: Parameters<typeof db.profile.create>[0]) => remember(() => state.profiles, db.profile.create(a)) },
        account: { ...db.account, create: (a: Parameters<typeof db.account.create>[0]) => remember(() => state.accounts, db.account.create(a)) },
        accountInvitation: {
          ...db.accountInvitation,
          updateMany: async (args: { where: Record<string, unknown>; data: Partial<Inv> }) => {
            await tick()
            const hits = state.invitations.filter((i) => matchInv(i, args.where))
            for (const i of hits) {
              touched.add(i)
              Object.assign(i, args.data)
            }
            return { count: hits.length }
          },
        },
      }
      try {
        return await fn(tx)
      } catch (err) {
        state.users = state.users.filter((u) => !created.has(u))
        state.profiles = state.profiles.filter((p) => !created.has(p))
        state.accounts = state.accounts.filter((a) => !created.has(a))
        for (const i of touched) Object.assign(i, before.get(i))
        throw err
      }
    },
  }

  function addInvitation(token: string, over: Partial<Inv> = {}) {
    const inv: Inv = {
      id: id('inv'),
      account_id: 'team-acc',
      token_hash: hashInviteToken(token),
      role: 'agent',
      accepted_at: null,
      accepted_by_user_id: null,
      expires_at: new Date(Date.now() + 86_400_000),
      ...over,
    }
    state.invitations.push(inv)
    return inv
  }

  return { db, state, addInvitation }
}
