/**
 * Questions customers really asked, offered as accuracy tests.
 *
 * A test suite is only as good as how closely its questions match what
 * customers send (research on evaluating assistants says the same: real
 * questions, answers checked by someone who knows the business). The
 * answers are left for the admin to write — copying the assistant's own
 * replies in as "correct" would only enshrine its mistakes.
 *
 * Messages that carry personal details — a phone number, an email, an
 * ID-length number — are never offered, nor are greetings, one-word
 * acknowledgements or submitted forms.
 */

import { prisma } from '@/lib/db'
import { normalizeMalayalam } from '../term-bridge'

export interface RealQuestion {
  question: string
  count: number
  last_at: string
}

const WINDOW_DAYS = 30
const SCAN = 3000

const TRIVIAL = new Set([
  'hi', 'hii', 'hello', 'hey', 'ok', 'okay', 'k', 'yes', 'no', 'thanks', 'thank you', 'thankyou', 'good morning',
  'good evening', 'good night', 'hai', 'ഹായ്', 'ഹലോ', 'ശരി', 'നന്ദി', 'ഓക്കെ', 'അതെ', 'ഇല്ല', 'start', 'menu',
])

export function questionKey(text: string): string {
  return normalizeMalayalam(text)
    .toLowerCase()
    .replace(/[?!.,।]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whether a customer message is worth offering as a test question. */
export function isTestableQuestion(text: string): boolean {
  const t = text.trim()
  if (t.length < 6 || t.length > 300) return false
  if (TRIVIAL.has(questionKey(t))) return false
  // Personal details: phone numbers, emails, long digit runs (Aadhaar,
  // account numbers), and forms submitted as "Label: value" lines.
  if (/\d{6,}/.test(t.replace(/[\s-]/g, ''))) return false
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(t)) return false
  if (t.split('\n').filter((l) => /^[^:]{2,40}:\s*\S/.test(l)).length >= 2) return false
  // Something to answer: at least three letters in any script.
  return (t.match(/\p{L}/gu) ?? []).length >= 3
}

export async function realQuestions(
  accountId: string,
  existing: readonly string[],
  limit = 25,
): Promise<RealQuestion[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const messages = await prisma.message.findMany({
    where: {
      sender_type: 'customer',
      created_at: { gte: since },
      content_text: { not: null },
      conversation: { account_id: accountId },
    },
    select: { content_text: true, created_at: true },
    orderBy: { created_at: 'desc' },
    take: SCAN,
  })

  const taken = new Set(existing.map(questionKey))
  const groups = new Map<string, RealQuestion>()
  for (const m of messages) {
    const text = (m.content_text ?? '').trim()
    if (!isTestableQuestion(text)) continue
    const key = questionKey(text)
    if (taken.has(key)) continue
    const g = groups.get(key)
    if (g) g.count++
    else groups.set(key, { question: text, count: 1, last_at: m.created_at.toISOString() })
  }

  // Asked most, then asked last.
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || b.last_at.localeCompare(a.last_at))
    .slice(0, limit)
}
