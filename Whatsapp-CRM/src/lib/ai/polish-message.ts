/**
 * "Improve" in the composer: the agent's own words, made professional.
 *
 * Not a new reply — the agent already decided what to say. So the model
 * is held to three things a rewrite most often breaks:
 *
 *   - The language and the script stay as typed. Malayalam stays in
 *     Malayalam script, Manglish (Malayalam in English letters) stays
 *     Manglish, English stays English. Nothing is translated.
 *   - Every fact stays: names, numbers, dates, times, amounts, links,
 *     email addresses. Nothing is added that the agent did not write.
 *   - It stays a message of about the same size, not an essay.
 *
 * A check after the call (missingFacts) lists any number, link or email
 * the rewrite dropped, so the agent is told rather than trusting it.
 */

export type PolishChannel = 'whatsapp' | 'email'

export function polishSystemPrompt(channel: PolishChannel): string {
  return [
    'You rewrite a message a staff member has typed to a customer, so it reads professional, polite and clear.',
    '',
    'RULES — follow every one:',
    '- Reply with the rewritten message only. No preamble, no quotes, no explanation, no options.',
    '- Keep EXACTLY the same language and script as the draft. Malayalam script stays Malayalam script. Malayalam written in English letters (Manglish) stays Manglish in English letters. English stays English. A mix stays the same mix. Never translate.',
    '- Keep every fact exactly as written: names, numbers, dates, times, amounts, phone numbers, links, email addresses, programme and product names.',
    '- Add no facts, promises, prices, dates or offers that are not in the draft. If the draft is unclear, keep its meaning; do not guess.',
    '- Keep the same meaning and intent. Fix spelling, grammar and tone; make it courteous and to the point.',
    '- Keep it about the same length. Do not add a signature or the business\'s name unless the draft has one.',
    channel === 'email'
      ? '- It is an email body. Keep paragraphs. Keep any **bold**, *italic*, [link text](url) and "- " list lines as they are written.'
      : '- It is a WhatsApp message: short paragraphs, no headings. Keep any *bold* or emoji the draft uses; add at most one emoji, only if the draft\'s tone allows it.',
  ].join('\n')
}

export function polishUserMessage(draft: string, recentThread: string): string {
  return [
    recentThread ? `The conversation so far, for tone and context only — do not answer it:\n${recentThread}\n` : '',
    'The draft to rewrite:',
    '<<<',
    draft,
    '>>>',
  ].join('\n')
}

/** Strips wrappers models add despite being told not to. */
export function cleanPolished(raw: string): string {
  let s = raw.trim()
  s = s.replace(/^```[a-z]*\n?|\n?```$/g, '').trim()
  s = s.replace(/^<<<\s*|\s*>>>$/g, '').trim()
  const quotes: Array<[string, string]> = [['"', '"'], ['“', '”'], ["'", "'"]]
  for (const [a, b] of quotes) {
    if (s.startsWith(a) && s.endsWith(b) && s.length > 2 && !s.slice(1, -1).includes(a)) s = s.slice(1, -1).trim()
  }
  return s
}

/** Numbers, links and emails in the draft that the rewrite does not contain. */
export function missingFacts(draft: string, polished: string): string[] {
  const facts = new Set<string>()
  for (const m of draft.matchAll(/https?:\/\/\S+|[\w.+-]+@[\w-]+\.[\w.]+|\d[\d,./:-]*\d|\d/g)) {
    facts.add(m[0].replace(/[.,)]+$/, ''))
  }
  const digits = (v: string) => v.replace(/[^\d]/g, '')
  const polishedDigits = digits(polished)
  return [...facts].filter((f) => {
    if (polished.includes(f)) return false
    // 9,500 written as 9500 (or the other way) is the same number.
    const d = digits(f)
    return !(d.length > 0 && /^\d[\d,./:-]*$/.test(f) && polishedDigits.includes(d))
  })
}
