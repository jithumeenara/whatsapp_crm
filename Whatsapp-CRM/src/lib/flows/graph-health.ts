/**
 * Finds the ways a chatbot can look finished and still fail a customer.
 *
 * Every problem here was found in a real, active bot on this account,
 * and each one is silent: the builder saves it, the list shows the bot
 * as Active, and the failure only appears as a customer tapping a button
 * and getting nothing back.
 *
 * What the engine actually does with each (see src/lib/flows/engine.ts,
 * matchReplyId and the fallback policy below it) is what decides whether
 * something is worth reporting:
 *
 *   - **A target that names a node which does not exist.** `matched` is
 *     truthy, so the engine advances to it, finds nothing, and ends the
 *     run with `node_not_found`. The customer taps and the conversation
 *     simply stops. This is the worst of the three.
 *   - **An empty target.** `matched` is falsy, so the fallback policy
 *     runs — usually a reprompt, which re-sends the same menu. On a
 *     "Back to main menu" button that is wrong; on an "Exit" button it
 *     traps the customer in the menu they were trying to leave.
 *   - **A node nothing can reach.** Harmless at runtime, but it means
 *     part of what was built is not in the conversation at all, which is
 *     almost never what the author believed.
 *
 * Reported, never repaired. What an empty "Exit" was meant to do is a
 * question only the person who built it can answer.
 */

export type FlowIssueLevel = 'breaks' | 'warns'

export interface FlowIssue {
  level: FlowIssueLevel
  /** Which node the problem is in, for linking into the builder. */
  nodeKey: string | null
  message: string
}

interface GraphNode {
  node_key: string
  node_type: string
  config: unknown
}

type Cfg = Record<string, unknown>

/** Config keys that hold a single "go here next" reference. */
const DIRECT_TARGET_KEYS = ['next_node_key', 'next_node', 'next', 'default_next', 'fallback_next']
/** Config keys whose value is a list of choices, each with its own target. */
const CHOICE_LIST_KEYS = ['buttons', 'rows', 'options', 'choices', 'branches', 'cases', 'sections']
const CHOICE_TARGET_KEYS = ['next_node_key', 'next_node', 'next', 'target', 'goto']

function labelOf(item: Cfg, fallback: string): string {
  for (const key of ['title', 'label', 'text', 'value']) {
    const v = item[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return fallback
}

/** Every outgoing reference a node carries, whatever shape it was saved
 *  in — the builder has grown several over time and they coexist. */
function outgoingTargets(config: unknown): { kind: 'direct' | 'choice'; label: string; target: unknown }[] {
  const cfg = (config ?? {}) as Cfg
  if (typeof cfg !== 'object') return []
  const found: { kind: 'direct' | 'choice'; label: string; target: unknown }[] = []

  for (const key of DIRECT_TARGET_KEYS) {
    if (key in cfg) found.push({ kind: 'direct', label: 'this step', target: cfg[key] })
  }

  for (const listKey of CHOICE_LIST_KEYS) {
    const list = cfg[listKey]
    if (!Array.isArray(list)) continue
    list.forEach((raw, index) => {
      const item = raw as Cfg
      if (!item || typeof item !== 'object') return
      const label = labelOf(item, `${listKey} ${index + 1}`)
      for (const key of CHOICE_TARGET_KEYS) {
        if (key in item) found.push({ kind: 'choice', label: `"${label}"`, target: item[key] })
      }
      // A list node nests its rows inside sections.
      if (Array.isArray(item.rows)) {
        item.rows.forEach((rawRow, rowIndex) => {
          const row = rawRow as Cfg
          if (!row || typeof row !== 'object') return
          const rowLabel = labelOf(row, `row ${rowIndex + 1}`)
          for (const key of CHOICE_TARGET_KEYS) {
            if (key in row) found.push({ kind: 'choice', label: `"${rowLabel}"`, target: row[key] })
          }
        })
      }
    })
  }

  return found
}

export function findFlowIssues(args: {
  entryNodeId: string | null
  nodes: GraphNode[]
  /** Node ids, when the entry is stored as an id rather than a key. */
  nodeIdByKey?: Map<string, string>
}): FlowIssue[] {
  const { nodes } = args
  const issues: FlowIssue[] = []
  const byKey = new Map(nodes.map((n) => [n.node_key, n]))

  if (nodes.length === 0) {
    return [{ level: 'breaks', nodeKey: null, message: 'This chatbot has no steps yet, so it can never reply.' }]
  }

  // The entry is stored as a node id in some rows and a node key in
  // others, depending on when the bot was built.
  let entryKey: string | null = null
  if (args.entryNodeId) {
    if (byKey.has(args.entryNodeId)) entryKey = args.entryNodeId
    else if (args.nodeIdByKey) {
      for (const [key, id] of args.nodeIdByKey) {
        if (id === args.entryNodeId) { entryKey = key; break }
      }
    }
  }

  if (!entryKey) {
    issues.push({
      level: 'breaks',
      nodeKey: null,
      message: args.entryNodeId
        ? 'The first step is set to a step that no longer exists, so the chatbot cannot start.'
        : 'No first step is set, so the chatbot has nowhere to start.',
    })
  }

  for (const node of nodes) {
    for (const { kind, label, target } of outgoingTargets(node.config)) {
      if (typeof target === 'string' && target.trim()) {
        if (!byKey.has(target)) {
          issues.push({
            level: 'breaks',
            nodeKey: node.node_key,
            message:
              kind === 'choice'
                ? `${label} points at a step that no longer exists — the conversation stops dead when a customer chooses it.`
                : 'This step continues to a step that no longer exists, so the conversation stops here.',
          })
        }
      } else if (target === null || target === undefined || target === '') {
        // The two go different ways in the engine. A choice with no
        // target falls through to the fallback policy and re-sends the
        // same message; a missing direct next ends the run instead.
        issues.push({
          level: 'warns',
          nodeKey: node.node_key,
          message:
            kind === 'choice'
              ? `${label} has no next step, so choosing it just repeats the same message.`
              : 'Nothing follows this step, so the chatbot stops after it.',
        })
      }
    }
  }

  // Walked from the entry so "unreachable" means what it says. Without a
  // valid entry there is nothing to walk from and every node would be
  // reported, which would bury the real problem above.
  if (entryKey) {
    const reachable = new Set<string>()
    const queue = [entryKey]
    while (queue.length > 0) {
      const key = queue.shift() as string
      if (reachable.has(key)) continue
      reachable.add(key)
      const node = byKey.get(key)
      if (!node) continue
      for (const { target } of outgoingTargets(node.config)) {
        if (typeof target === 'string' && target && byKey.has(target)) queue.push(target)
      }
    }
    for (const node of nodes) {
      if (!reachable.has(node.node_key)) {
        issues.push({
          level: 'warns',
          nodeKey: node.node_key,
          message: 'Nothing leads to this step, so customers never see it.',
        })
      }
    }
  }

  return issues
}

/** Sorted worst-first, so a list showing only the first few shows the
 *  ones that actually break a conversation. */
export function sortIssues(issues: FlowIssue[]): FlowIssue[] {
  return [...issues].sort((a, b) => (a.level === b.level ? 0 : a.level === 'breaks' ? -1 : 1))
}
