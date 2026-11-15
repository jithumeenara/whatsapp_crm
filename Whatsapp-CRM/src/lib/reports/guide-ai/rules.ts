/**
 * The Performance guide's AI layer, the pure part (plan §10 layer 2,
 * phase F4). The model is given ONLY the facts code already wrote on the
 * guide's cards — counts, stage names, team member names — never customer
 * names, numbers, messages or questions ("people data never to AI").
 * Every number in what it writes back must be one of those facts (or a
 * small step number); any other line is dropped. What is left is shown
 * labelled "AI". Nothing here says "the cause is": the prompt asks for
 * "may be linked / check".
 */

import type { Finding } from '../doc/types'

/** Titles and evidence of the cards worth explaining (not the "good" ones). */
export function factLines(findings: Finding[]): string[] {
  return findings
    .filter((f) => f.severity !== 'good')
    .slice(0, 12)
    .map((f) => `${f.title.trim()}${/[.!?]$/.test(f.title.trim()) ? '' : '.'} ${f.evidence.trim()}`.slice(0, 400))
}

export function numbersIn(text: string): number[] {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, ''))).filter((n) => Number.isFinite(n))
}

/** Every number in the line is a fact, or a small step number (1–5). */
export function checkLine(line: string, allowed: Set<number>): boolean {
  return numbersIn(line).every((n) => allowed.has(n) || (Number.isInteger(n) && n >= 1 && n <= 5))
}

export interface AiGuideAnswer { summary?: unknown; actions?: unknown }

/** The model's answer → AI-labelled cards, keeping only lines that pass the check. */
export function toFindings(answer: AiGuideAnswer | null, allowed: Set<number>): Finding[] {
  if (!answer) return []
  const lines: Array<{ text: string; kind: 'summary' | 'action' }> = []
  if (typeof answer.summary === 'string' && answer.summary.trim()) lines.push({ text: answer.summary.trim(), kind: 'summary' })
  if (Array.isArray(answer.actions)) {
    for (const a of answer.actions.slice(0, 5)) if (typeof a === 'string' && a.trim()) lines.push({ text: a.trim(), kind: 'action' })
  }
  return lines
    .filter((l) => l.text.length <= 400 && checkLine(l.text, allowed))
    .map((l) => ({
      severity: 'low' as const,
      title: l.text,
      evidence: l.kind === 'summary' ? 'What the numbers above may mean together.' : 'A step to try, from the numbers above.',
      suggestion: 'Check it against what you know; AI can be wrong.',
      byAi: true,
    }))
}

/** The instruction. The facts go in as a plain list; nothing else about the business. */
export function buildPrompt(facts: string[], language: string): string {
  return [
    'You help the owner of a small business read their sales report.',
    `Write in this language: ${language}. Simple words, short sentences.`,
    'Use ONLY the facts below. Do not invent numbers: every number you write must appear in the facts.',
    'Never say what the cause is for certain; say what may be linked and what to check.',
    'Return JSON: {"summary": one or two sentences on what these facts may mean together, "actions": three to five short practical steps}.',
    '',
    'Facts:',
    ...facts.map((f) => `- ${f}`),
  ].join('\n')
}
