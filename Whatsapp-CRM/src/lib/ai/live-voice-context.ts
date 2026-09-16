/**
 * Builds what a live voice session should know.
 *
 * The point of running the console against the real prompt — company
 * profile, knowledge base, guardrails and all — is that hearing it is
 * only useful if it is the same assistant. A generic Live API session
 * with a one-line persona sounds lovely and tells you nothing about
 * whether your bot knows your fees.
 *
 * The knowledge base is loaded whole rather than retrieved per question,
 * which is the one real difference from the text path. A live session
 * has no discrete "message" to retrieve against — the person is
 * mid-sentence — so the material is given up front and capped. For an
 * account with a large knowledge base that means the console tests the
 * persona and the voice faithfully, and retrieval only approximately;
 * the evaluation suite is the tool for retrieval.
 */

import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getProviderKeys } from './providers/registry'
import { loadKnowledge } from './knowledge-store'
import { loadCompanyProfile, formatCompanyBlock } from './company-profile'
import { buildCustomerToolInstruction } from './customer-tools'

/** A live session's instruction is sent once at setup and cannot be
 *  re-sent per turn, so it has to fit alongside the audio budget. */
const MAX_KNOWLEDGE_CHARS = 12_000

/** How speech differs from typing. Without this the model reads out its
 *  WhatsApp formatting — "star Admissions star" — and delivers a
 *  six-item bulleted list nobody can follow by ear. */
const SPOKEN_STYLE = [
  'YOU ARE SPEAKING ALOUD, NOT TYPING:',
  '- Talk the way a helpful person on the phone talks. Short sentences. No lists, no bullet points, no headings, no asterisks.',
  '- Keep each answer to a few sentences. If there is a lot to say, give the most important part and offer to go on.',
  '- Say numbers the way people say them out loud: "forty-five thousand rupees", not "45,000 INR".',
  '- Never read out a URL. Say you will send the link in a message.',
  "- If you are interrupted, stop and listen. Don't finish the sentence you were on.",
  '- If you do not know something, say so plainly and offer to have a colleague follow up.',
].join('\n')

/** The reply-language rules, rewritten for a voice that is heard rather
 *  than read.
 *
 *  LANGUAGE_INSTRUCTION is the text path's, and two of its lines are
 *  nonsense out loud: "reply in Malayalam in English letters" cannot be
 *  spoken at all, and falling back to English is the wrong default for a
 *  phone line in Kerala. Google's own guidance for native-audio models is
 *  that the spoken language is steered by the system instruction and
 *  nothing else — there is no language code to set on them — and that the
 *  instruction has to be emphatic to hold. Hence the shouting. */
const SPOKEN_LANGUAGE = [
  'LANGUAGE:',
  '- Speak the language the caller speaks, and YOU MUST SPEAK IT UNMISTAKABLY — the accent, rhythm and word choice of someone who grew up speaking it, not an English speaker reading foreign words off a page.',
  '- If they switch language mid-call, switch with them. What they just said decides, not how the call opened.',
  '- If one sentence mixes two languages, answer in the one carrying most of the meaning, and keep the borrowed words they used.',
  '- Say names, course titles and place names the way a local says them. Never spell a word out letter by letter unless you are asked to.',
  '- If you truly cannot tell what language they are speaking, ask them, in the language you last heard.',
].join('\n')

export async function loadLiveVoiceContext(args: {
  accountId: string
  mode: 'customer' | 'admin'
}): Promise<{
  apiKey: string
  model: string
  voiceName: string
  systemInstruction: string
} | null> {
  const aiConfig = await prisma.aiConfig.findUnique({ where: { account_id: args.accountId } })
  if (!aiConfig || !aiConfig.live_voice_enabled) return null

  const geminiEntry = getProviderKeys(aiConfig).gemini
  if (!geminiEntry?.api_key) return null

  return {
    apiKey: decrypt(geminiEntry.api_key),
    model: aiConfig.live_voice_model,
    voiceName: aiConfig.live_voice_name,
    systemInstruction: await composeInstruction(args.accountId, aiConfig, args.mode),
  }
}

/**
 * The same instruction, for a WhatsApp call.
 *
 * A call is answered by Pipecat on a separate machine, holding its own
 * Gemini key, and is gated on `CallConfig.ai_answer_enabled` rather than
 * on the browser console's own toggle — so it wants the prompt and
 * nothing else. No key to relay, and no reason for the assistant on the
 * phone to fall back to a stub because nobody had switched on a browser
 * feature they never use.
 *
 * What it does get is assembled by the same function as the console's,
 * which is the entire point: chat and phone must not answer the same
 * question differently.
 */
export async function loadCallVoiceContext(args: {
  accountId: string
  mode: 'customer' | 'admin'
}): Promise<{
  model: string
  voiceName: string
  systemInstruction: string
} | null> {
  const aiConfig = await prisma.aiConfig.findUnique({ where: { account_id: args.accountId } })
  if (!aiConfig) return null

  return {
    model: aiConfig.live_voice_model,
    voiceName: aiConfig.live_voice_name,
    systemInstruction: await composeInstruction(args.accountId, aiConfig, args.mode),
  }
}

type AiConfigRow = NonNullable<Awaited<ReturnType<typeof prisma.aiConfig.findUnique>>>

async function composeInstruction(
  accountId: string,
  aiConfig: AiConfigRow,
  mode: 'customer' | 'admin',
): Promise<string> {
  const [profile, knowledge] = await Promise.all([
    loadCompanyProfile(accountId).catch(() => null),
    // Same audience boundary as the text path: an internal entry must
    // not be speakable to a customer any more than it is quotable.
    loadKnowledge(aiConfig.id, mode === 'admin' ? 'all' : 'customer').catch(() => null),
  ])

  const parts: string[] = []

  const companyBlock = formatCompanyBlock(profile, mode === 'admin' ? 'admin' : 'customer')
  if (companyBlock) parts.push(companyBlock)

  if (mode === 'admin') {
    parts.push(
      aiConfig.admin_system_prompt?.trim() ||
        'You are the internal assistant for this business, speaking with a member of staff.',
    )
  } else {
    parts.push(
      aiConfig.system_prompt?.trim() ||
        'You are the assistant for this business, speaking with a customer.',
    )
  }

  if (knowledge) {
    const block = formatKnowledgeForSpeech(knowledge)
    if (block) parts.push(block)
  }

  if (aiConfig.fallback_answer) {
    parts.push(
      `If you do not have a confident answer, say this and nothing more: "${aiConfig.fallback_answer}"`,
    )
  }

  const escalationTopics = Array.isArray(aiConfig.escalation_topics)
    ? (aiConfig.escalation_topics as string[])
    : []
  if (escalationTopics.length > 0) {
    parts.push(
      `If they raise any of: ${escalationTopics.join(', ')} — say a colleague will follow up, and do not answer it yourself.`,
    )
  }

  if (mode === 'customer') parts.push(await buildCustomerToolInstruction(accountId))

  // Language last but one, style last: the final instruction is the one
  // the model weights most, and speaking style is what a live session
  // most often gets wrong.
  parts.push(SPOKEN_LANGUAGE)
  parts.push(SPOKEN_STYLE)

  // Citation markers survive being pasted into a system prompt out of a
  // document, and a reader's eye skips straight over them. A voice does
  // not: the assistant says "established in 1992, cite two" out loud,
  // which is gibberish to the person holding the phone.
  return parts.join('\n\n').replace(/\s*\[cite:[^\]]*\]/gi, '')
}

function formatKnowledgeForSpeech(knowledge: {
  qaPairs: { question: string; answer: string }[]
  documents: { title: string; content: string }[]
}): string {
  const lines: string[] = ['WHAT YOU KNOW ABOUT THIS BUSINESS:']
  let budget = MAX_KNOWLEDGE_CHARS

  for (const pair of knowledge.qaPairs) {
    const entry = `Q: ${pair.question}\nA: ${pair.answer}`
    if (entry.length > budget) break
    lines.push(entry)
    budget -= entry.length
  }

  for (const doc of knowledge.documents) {
    if (budget <= 200) break
    const body = doc.content.slice(0, Math.min(budget, 3_000))
    const entry = `${doc.title}:\n${body}`
    lines.push(entry)
    budget -= entry.length
  }

  return lines.length > 1 ? lines.join('\n\n') : ''
}
