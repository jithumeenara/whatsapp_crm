/**
 * Turns a chatbot the account already built into plain text the
 * assistant can answer from.
 *
 * ── Why this is worth having ────────────────────────────────────────
 *
 * A business that has built a "How to reach us" bot has already written
 * the answer to "where are you?" — carefully, in its own words, with the
 * landmark everybody actually navigates by. And the assistant could not
 * see a word of it. The two lived side by side answering the same
 * question, one of them well, and which one a customer got depended
 * entirely on whether they happened to type the keyword that starts the
 * bot.
 *
 * That is the real gap a keyword bot leaves, and it is the same gap the
 * assistant exists to fill: the phrasings somebody thought of, versus
 * the ones customers use. Connecting the two means the work is written
 * once. Somebody edits the location bot, and the assistant's answer
 * changes with it.
 *
 * ── What it reads ───────────────────────────────────────────────────
 *
 * Only the parts of a flow that are *said to a customer*: message text,
 * button and list labels, media captions, the questions an input step
 * asks. Everything else — conditions, tags, variables, saves, delays —
 * is machinery, and putting it in a prompt would teach the assistant
 * about the plumbing rather than about the business.
 *
 * Nodes are walked from the entry step outwards, so the text arrives in
 * roughly the order a customer would meet it, and each block records
 * which choice leads to it. "Reached by choosing: Regional centre"
 * above an address is the difference between an address and the *right*
 * address.
 *
 * ── What is deliberately dropped ────────────────────────────────────
 *
 * Template placeholders. A bot's greeting is "Hello {{contact.name}}",
 * and nothing substitutes those here — this text is reference material,
 * not a message being sent. Left in, they end up quoted to a customer
 * verbatim, which has happened before in this app with prompt
 * placeholders that nothing filled in.
 */

import { prisma } from '@/lib/db'

/** A long branching bot is still a small document; this is a guard
 *  against a pathological flow rather than a real limit. */
const MAX_NODES = 300
const MAX_TEXT_CHARS = 200_000

export interface SerializedChatbot {
  flowName: string
  /** How many steps actually contributed text — what the account is
   *  told, so "connected" is not mistaken for "found something". */
  stepCount: number
  text: string
}

/** Node types that say something to a customer. Everything else is
 *  machinery and is skipped rather than described. */
const SPEAKING_NODES = new Set([
  'send_message',
  'send_text',
  'send_buttons',
  'send_list',
  'send_media',
  'send_catalog',
  'collect_input',
])

/**
 * A bot's own text, minus the things that only mean something at send
 * time. Placeholders go rather than being left to be quoted back.
 */
function clean(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
}

interface Cfg {
  [key: string]: unknown
}

/** Every onward step this node can lead to, paired with the label of
 *  the choice that gets there. An unlabelled edge — an auto-advance —
 *  carries no label, because there was no choice to make. */
function exitsOf(nodeType: string, cfg: Cfg): Array<{ key: string; label: string | null }> {
  const out: Array<{ key: string; label: string | null }> = []
  const push = (key: unknown, label: string | null) => {
    if (typeof key === 'string' && key) out.push({ key, label })
  }

  if (nodeType === 'send_buttons') {
    for (const b of (cfg.buttons as Array<Cfg> | undefined) ?? []) {
      push(b.next_node_key, clean(b.title) || null)
    }
    const cta = cfg.cta_button as Cfg | undefined
    if (cta) push(cta.next_node_key, clean(cta.title) || null)
  } else if (nodeType === 'send_list') {
    for (const section of (cfg.sections as Array<Cfg> | undefined) ?? []) {
      for (const row of (section.rows as Array<Cfg> | undefined) ?? []) {
        push(row.next_node_key, clean(row.title) || null)
      }
    }
  } else if (nodeType === 'condition') {
    // Both sides, unlabelled: which branch a customer lands on is not
    // something they chose, and naming the predicate would put the
    // plumbing into the prompt.
    push(cfg.true_next, null)
    push(cfg.false_next, null)
  } else if (nodeType === 'switch_case') {
    for (const c of (cfg.cases as Array<Cfg> | undefined) ?? []) {
      push(c.next_node_key, clean(c.label as string) || null)
    }
    push(cfg.default_next, null)
  }

  push(cfg.next_node_key, null)
  return out
}

/** What one step says, as a person would describe it. Null when it says
 *  nothing worth keeping. */
function describeNode(nodeType: string, cfg: Cfg): string | null {
  const lines: string[] = []

  if (nodeType === 'collect_input') {
    const prompt = clean(cfg.prompt_text)
    if (!prompt) return null
    return `It asks: ${prompt}`
  }

  const header = clean(cfg.header_text)
  const body = clean(cfg.text) || clean(cfg.body_text) || clean(cfg.caption)
  const footer = clean(cfg.footer_text)

  if (nodeType === 'send_media' && !body) {
    // A bare image with no caption carries nothing retrievable, but a
    // named document is worth knowing exists.
    const filename = clean(cfg.filename)
    return filename ? `It sends a file: ${filename}` : null
  }

  if (header) lines.push(header)
  if (body) lines.push(body)
  if (footer) lines.push(footer)

  const choices: string[] = []
  if (nodeType === 'send_buttons') {
    for (const b of (cfg.buttons as Array<Cfg> | undefined) ?? []) {
      const title = clean(b.title)
      if (title) choices.push(title)
    }
    const cta = cfg.cta_button as Cfg | undefined
    const ctaTitle = clean(cta?.title)
    if (ctaTitle) choices.push(clean(cta?.url) ? `${ctaTitle} (${clean(cta?.url)})` : ctaTitle)
  }
  if (nodeType === 'send_list') {
    for (const section of (cfg.sections as Array<Cfg> | undefined) ?? []) {
      for (const row of (section.rows as Array<Cfg> | undefined) ?? []) {
        const title = clean(row.title)
        if (!title) continue
        const description = clean(row.description)
        choices.push(description ? `${title} — ${description}` : title)
      }
    }
  }

  if (lines.length === 0 && choices.length === 0) return null

  const out = lines.length > 0 ? [`It says: ${lines.join('\n')}`] : []
  if (choices.length > 0) out.push(`Options offered: ${choices.join(' | ')}`)
  return out.join('\n')
}

/**
 * @param purpose What this bot is for, in the account's own words. Goes
 *   into the header so the model knows when the text applies — "how to
 *   reach our campus" turns a list of landmarks into an answer to
 *   "where are you?".
 */
export async function serializeChatbot(
  accountId: string,
  flowId: string,
  purpose?: string | null,
): Promise<SerializedChatbot> {
  const flow = await prisma.flow.findFirst({
    where: { id: flowId, account_id: accountId },
    select: {
      name: true,
      description: true,
      entry_node_id: true,
      nodes: {
        select: { node_key: true, node_type: true, config: true },
      },
    },
  })
  if (!flow) throw new Error('That chatbot no longer exists.')
  if (flow.nodes.length === 0) throw new Error('That chatbot has no steps yet.')

  const byKey = new Map(flow.nodes.map((n) => [n.node_key, n]))

  // Breadth-first from the entry step, so the text arrives roughly in
  // the order a customer meets it. A flow with no entry recorded, or
  // with steps the entry cannot reach, still contributes everything —
  // an orphaned branch is usually work in progress, not a secret.
  const order: string[] = []
  const arrivedBy = new Map<string, string>()
  const seen = new Set<string>()
  const queue: string[] = []

  const start = flow.entry_node_id && byKey.has(flow.entry_node_id) ? flow.entry_node_id : null
  if (start) queue.push(start)
  for (const node of flow.nodes) if (!queue.includes(node.node_key)) queue.push(node.node_key)

  while (queue.length > 0 && order.length < MAX_NODES) {
    const key = queue.shift()!
    if (seen.has(key)) continue
    seen.add(key)
    const node = byKey.get(key)
    if (!node) continue
    order.push(key)

    for (const exit of exitsOf(node.node_type, (node.config ?? {}) as Cfg)) {
      if (seen.has(exit.key)) continue
      if (exit.label && !arrivedBy.has(exit.key)) arrivedBy.set(exit.key, exit.label)
      // Unshift, so a branch is followed to its end before the next
      // sibling starts — which is the order somebody reads a bot in.
      queue.unshift(exit.key)
    }
  }

  const header = [`CHATBOT: ${flow.name}`]
  const purposeText = purpose?.trim() || flow.description?.trim()
  if (purposeText) header.push(`PURPOSE: ${purposeText}`)
  header.push(
    'This is what one of this business’s own automated chats says to customers.',
    'Everything below was written by the business, so it is safe to answer from — but say it in your own words rather than describing the chat itself.',
  )

  const blocks: string[] = [header.join('\n')]
  let stepCount = 0

  for (const key of order) {
    const node = byKey.get(key)
    if (!node || !SPEAKING_NODES.has(node.node_type)) continue
    const described = describeNode(node.node_type, (node.config ?? {}) as Cfg)
    if (!described) continue

    const via = arrivedBy.get(key)
    blocks.push(via ? `Reached by choosing "${via}".\n${described}` : described)
    stepCount += 1
  }

  if (stepCount === 0) {
    throw new Error('That chatbot has no message text to read — it only sets tags or routes.')
  }

  return {
    flowName: flow.name,
    stepCount,
    text: blocks.join('\n\n').slice(0, MAX_TEXT_CHARS),
  }
}
