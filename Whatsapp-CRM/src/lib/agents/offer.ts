/**
 * Offering a waiting customer to one agent at a time.
 *
 * ── Why an offer and not an assignment ──────────────────────────────
 *
 * Assigning a conversation to whoever looks least busy is one line of
 * code and quietly wrong: the least busy agent is often the one who
 * stepped away, and a conversation assigned to somebody absent is
 * visible to nobody. It looks handled on every screen and is not.
 *
 * An offer has to be accepted. Nobody owns the conversation until a
 * person says so, and an offer that is ignored moves on by itself. The
 * whole contact-centre industry calls the ignoring case RONA — redirect
 * on no answer — and every platform has it, because every platform
 * learnt the same lesson.
 *
 * ── Why sixty seconds ───────────────────────────────────────────────
 *
 * Webex defaults to 18 seconds for a phone call and 30 for a chat;
 * Avaya caps digital channels at 180. WhatsApp is neither: the customer
 * is not sitting watching a widget, so the cost of a slower rotation is
 * far lower than in live chat, and the agent is usually mid-sentence
 * with somebody else. Sixty is inside the industry range and gives a
 * person time to finish a reply rather than punishing them for typing.
 *
 * Configurable, because a clinic triaging symptoms and an institute
 * answering fee questions are not the same urgency.
 *
 * ── Why it stops ────────────────────────────────────────────────────
 *
 * "Keep rotating until somebody accepts" is the obvious rule and it is
 * a trap. Four agents at lunch means four alarms a minute, forever,
 * through the night. Alarm research is unambiguous about what that
 * does: people stop hearing alarms altogether, and the standard for
 * industrial operators is roughly one alarm per ten minutes.
 *
 * So it goes round twice and stops. What happens then is not silence —
 * a supervisor is told, the conversation stays claimable by anybody,
 * and the customer is asked when they would like to be called back —
 * but the ringing ends.
 *
 * ── Why a missed offer makes an agent unavailable ───────────────────
 *
 * Standard everywhere, and for a reason this module cannot do without:
 * an agent who is at lunch will miss round two exactly as they missed
 * round one, and every second spent re-offering to them is a second the
 * customer waits. Missing an offer sets them aside for this
 * conversation's remaining rounds.
 */

export const DEFAULT_OFFER_SECONDS = 60

/**
 * How many times the whole team is tried before the ringing stops.
 *
 * Two, not three. With four agents that is already eight interruptions
 * for one customer; a third round would be twelve, which is well past
 * the point where people stop reacting to any of them.
 */
export const MAX_ROUNDS = 2

/**
 * The most conversations one agent is offered at once.
 *
 * Three is where the live-chat research lands for an experienced agent —
 * new agents manage one, the best manage four, and past four quality
 * needs tooling nobody here has. It is a cap, not a target: somebody
 * already holding three is simply not offered a fourth, however idle
 * they look on every other measure.
 */
export const DEFAULT_MAX_CONCURRENT = 3

export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled'

export interface OfferCandidate {
  userId: string
  /** Signed in and active right now. */
  online: boolean
  /** Inside their working hours. True when they have none set. */
  onShift: boolean
  /** Conversations assigned to them and not closed. */
  openConversations: number
  /** Category keys this agent handles. Empty means "anything". */
  handles: string[]
  /** How long since they were last seen, for tie-breaking. */
  lastSeenAt: Date | null
}

export interface PickOfferArgs {
  candidates: OfferCandidate[]
  /** What the conversation is about, when the assistant was sure enough
   *  to say. Null means route on availability alone. */
  category: string | null
  /** Who has already been offered this conversation and did not take
   *  it. They are skipped for the rest of it. */
  alreadyOffered: string[]
  maxConcurrent?: number
}

export interface PickOfferResult {
  agent: OfferCandidate | null
  /** Why this one, or why none. Written onto the conversation so a
   *  handover that went nowhere can be explained without re-deriving
   *  it hours later. */
  reason: string
  /** True when the pick ignored the category because nobody who
   *  handles it was free. The agent is told, so they know why a Dental
   *  question reached somebody who does not do Dental. */
  outsideSpeciality: boolean
}

/**
 * Who to offer this to next.
 *
 * The order is deliberate and each step has a different cost of being
 * wrong:
 *
 *   1. can they take it at all   — hard filter, no exceptions
 *   2. do they know the subject  — preference, dropped rather than wait
 *   3. who is least loaded       — the actual choice
 *   4. who has been idle longest — a tie-break, so two idle agents do
 *                                  not both keep getting the next one
 *
 * Step 2 is a preference and not a wall on purpose. Holding a customer
 * for the one agent who does Dental, while three others sit free, is
 * choosing tidiness over the person waiting.
 */
export function pickForOffer(args: PickOfferArgs): PickOfferResult {
  const cap = args.maxConcurrent ?? DEFAULT_MAX_CONCURRENT
  const skip = new Set(args.alreadyOffered)

  const available = args.candidates.filter(
    (c) => !skip.has(c.userId) && c.online && c.onShift && c.openConversations < cap,
  )

  if (available.length === 0) {
    // Separated because they call for completely different actions, and
    // this sentence is what somebody reads in the log. "Everybody is
    // off shift" is a rota to change; "nobody is signed in" is a person
    // to ring.
    const notOffered = args.candidates.filter((c) => !skip.has(c.userId))
    const signedIn = notOffered.filter((c) => c.online)
    const onShift = signedIn.filter((c) => c.onShift)
    const reason =
      notOffered.length === 0
        ? 'everybody has already been offered this one'
        : signedIn.length === 0
          ? 'nobody is signed in right now'
          : onShift.length === 0
            ? 'everybody signed in is outside their working hours'
            : `everybody free is already on ${cap} conversations`
    return { agent: null, reason, outsideSpeciality: false }
  }

  const specialists = args.category
    ? available.filter((c) => c.handles.includes(args.category as string))
    : []

  const pool = specialists.length > 0 ? specialists : available
  const outsideSpeciality = Boolean(args.category) && specialists.length === 0

  const sorted = [...pool].sort((a, b) => {
    if (a.openConversations !== b.openConversations) {
      return a.openConversations - b.openConversations
    }
    return (a.lastSeenAt?.getTime() ?? 0) - (b.lastSeenAt?.getTime() ?? 0)
  })

  const chosen = sorted[0]
  const reason = outsideSpeciality
    ? `nobody free handles this subject — offered to ${chosen.userId} anyway`
    : specialists.length > 0
      ? `handles this subject and has ${chosen.openConversations} open`
      : `has ${chosen.openConversations} open`

  return { agent: chosen, reason, outsideSpeciality }
}

/**
 * Has this offer run out?
 *
 * Compared rather than scheduled. A timer held in memory dies with the
 * process, and a conversation whose timer died would wait forever with
 * nothing on any screen to say so — the worst failure this module could
 * have. An expiry that is a stored timestamp is true whoever asks and
 * survives a restart.
 */
export function isExpired(
  offeredAt: Date | string,
  seconds: number,
  now: Date = new Date(),
): boolean {
  const then = offeredAt instanceof Date ? offeredAt : new Date(offeredAt)
  if (Number.isNaN(then.getTime())) return true
  return now.getTime() - then.getTime() >= seconds * 1000
}

/** Seconds left on an offer, floored at zero, for the countdown. */
export function secondsLeft(
  offeredAt: Date | string,
  seconds: number,
  now: Date = new Date(),
): number {
  const then = offeredAt instanceof Date ? offeredAt : new Date(offeredAt)
  if (Number.isNaN(then.getTime())) return 0
  const left = seconds * 1000 - (now.getTime() - then.getTime())
  return Math.max(0, Math.ceil(left / 1000))
}

export interface RotationState {
  /** Everybody offered so far, in order. */
  offered: string[]
  /** How many agents could ever be offered this — the team size after
   *  the hard filters, measured when the first offer went out. */
  teamSize: number
}

/**
 * Should this conversation be offered to anybody else?
 *
 * Counts rounds by how many offers have gone out against the size of
 * the team, rather than storing a round number: a team that changes
 * size mid-rotation — somebody logs in, somebody goes off shift —
 * should not be able to make the count mean something different from
 * what it meant a minute ago.
 */
export function shouldKeepOffering(state: RotationState, maxRounds = MAX_ROUNDS): boolean {
  if (state.teamSize <= 0) return false
  return state.offered.length < state.teamSize * maxRounds
}

/**
 * Why the ringing stopped, in words somebody can act on.
 *
 * Every one of these ends with something happening — a supervisor told,
 * the conversation left claimable, the customer asked when to call.
 * "Gave up" is never the whole story and must never read like it.
 */
export function describeGivingUp(state: RotationState, lastReason: string): string {
  if (state.offered.length === 0) {
    return `Nobody could be offered this: ${lastReason}.`
  }
  return `Offered to ${state.offered.length} ${
    state.offered.length === 1 ? 'person' : 'people'
  } and nobody took it.`
}
