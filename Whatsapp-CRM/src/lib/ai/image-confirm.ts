/**
 * "Here is what I read from your photo — is that right?"
 *
 * After an image is read (image-reading.ts) the assistant does not act on
 * it straight away. It tells the customer what it understood, in their
 * language, with Yes / No buttons:
 *
 *   - Yes: the reading is handed to the assistant as confirmed, and it
 *     helps with whatever the image was for — the same pipeline, guards
 *     and knowledge as any other message.
 *   - No: the customer is asked to type the details or send a clearer
 *     photo. Nothing is acted on.
 *
 * Why ask at all: a misread prescription, amount or date is worse than no
 * answer, and the customer is the one person who knows what the photo
 * says. One tap is a small price for that certainty.
 *
 * The pending question lives as a system note on the thread — staff see
 * that it was asked and how it was answered, in the conversation itself —
 * and is found again the same way handover-consent.ts finds its own.
 */

import { prisma } from '@/lib/db'
import { engineSendInteractiveButtons, engineSendText } from '@/lib/flows/meta-send'
import { consentFromText, languageOf } from './handover-consent'
import { assistantMessageForImage } from './image-reading'

export const IMAGE_ASK_MARKER = 'Asked the customer to confirm what was read from their image'
const CONFIRMED_NOTE = 'The customer confirmed what was read from their image.'
const REJECTED_NOTE = 'The customer said the reading of their image was wrong, and was asked to type the details or send a clearer photo.'

/** A tapped button older than this is not an answer to anything live. */
const ANSWER_WINDOW_MS = 24 * 60 * 60 * 1000
/** WhatsApp's limit on an interactive message's body. */
const MAX_BODY = 1024

const TEXT = {
  ml: {
    yes: 'ശരിയാണ്',
    no: 'അല്ല',
    retry: 'ക്ഷമിക്കണം. ശരിയായ വിവരങ്ങൾ ടൈപ്പ് ചെയ്യുകയോ കൂടുതൽ വ്യക്തമായ ഒരു ഫോട്ടോ അയക്കുകയോ ചെയ്യൂ.',
  },
  en: {
    yes: 'Yes, correct',
    no: 'No',
    retry: 'Sorry about that. Please type the correct details, or send a clearer photo.',
  },
} as const

type Lang = keyof typeof TEXT

// ── Answers ─────────────────────────────────────────────────────────

/** `img_yes_<epoch ms>` / `img_no_<epoch ms>`. */
export function imageButtonId(answer: 'yes' | 'no', askedAt: number): string {
  return `img_${answer}_${askedAt}`
}

/** A tapped button: the answer, and which question it answers — the
 *  moment it was asked, which identifies it when several images were
 *  asked about in turn. */
export function parseImageButton(
  id: string | null | undefined,
  now = Date.now(),
): { answer: 'yes' | 'no'; askedAt: number } | null {
  const m = /^img_(yes|no)_(\d{10,})$/.exec(id ?? '')
  if (!m) return null
  const at = Number(m[2])
  if (!Number.isFinite(at) || now - at > ANSWER_WINDOW_MS || at - now > 60_000) return null
  return { answer: m[1] as 'yes' | 'no', askedAt: at }
}

/** A typed yes or no — the whole message must be the answer, exactly as
 *  for the handover question; "yes but the date is wrong" is not a yes. */
export function imageAnswerFromText(text: string | null | undefined): 'yes' | 'no' | null {
  return consentFromText(text)
}

// ── The pending question ────────────────────────────────────────────

interface PendingImageAsk {
  imageMessageId: string
  lang: Lang
}

const ASK_FIELDS = /\(image: ([0-9a-f-]{36}), lang: (ml|en), asked: (\d{10,})\)/
const ANSWERED_FIELD = /\(image: ([0-9a-f-]{36})\)/

/**
 * The question this answer is for, or null when there is none to answer.
 *
 *  - A tapped button names its own question (askedAt), so with several
 *    images asked about, each button answers its own — never the newest
 *    by accident — and a question already answered is not answered twice.
 *  - A typed yes or no is taken only as the first thing the customer
 *    said after the newest question. Once they have written anything
 *    else, a later "yes" is an answer to something else — perhaps to the
 *    assistant's own "shall I book it?" — and must not confirm an image.
 */
async function findImageAsk(args: {
  conversationId: string
  askedAt?: number
  currentMessageId?: string
  now?: number
}): Promise<PendingImageAsk | null> {
  const now = args.now ?? Date.now()
  const since = new Date(now - ANSWER_WINDOW_MS)
  const notes = await prisma.message.findMany({
    where: { conversation_id: args.conversationId, sender_type: 'system', created_at: { gte: since } },
    orderBy: { created_at: 'desc' },
    take: 50,
    select: { content_text: true, created_at: true },
  })

  const answered = new Set<string>()
  for (const n of notes) {
    const text = n.content_text ?? ''
    if (text.startsWith(CONFIRMED_NOTE) || text.startsWith(REJECTED_NOTE)) {
      const id = ANSWERED_FIELD.exec(text)?.[1]
      if (id) answered.add(id)
    }
  }

  const asks = notes
    .filter((n) => (n.content_text ?? '').startsWith(IMAGE_ASK_MARKER))
    .map((n) => {
      const m = ASK_FIELDS.exec(n.content_text ?? '')
      return m ? { imageMessageId: m[1], lang: m[2] as Lang, askedAt: Number(m[3]), noteAt: n.created_at } : null
    })
    .filter((a): a is NonNullable<typeof a> => a !== null)

  if (args.askedAt !== undefined) {
    const ask = asks.find((a) => a.askedAt === args.askedAt)
    return ask && !answered.has(ask.imageMessageId) ? { imageMessageId: ask.imageMessageId, lang: ask.lang } : null
  }

  const newest = asks[0]
  if (!newest || answered.has(newest.imageMessageId)) return null
  const spokeSince = await prisma.message.count({
    where: {
      conversation_id: args.conversationId,
      sender_type: 'customer',
      created_at: { gt: newest.noteAt },
      ...(args.currentMessageId ? { id: { not: args.currentMessageId } } : {}),
    },
  })
  return spokeSince === 0 ? { imageMessageId: newest.imageMessageId, lang: newest.lang } : null
}

async function note(conversationId: string, text: string): Promise<void> {
  await prisma.message.create({
    data: { conversation_id: conversationId, sender_type: 'system', content_type: 'text', content_text: text, status: 'sent' },
  })
}

/**
 * Says what was read and asks whether it is right, with Yes / No. For an
 * image that could not be read, the question is already a request for a
 * clearer one — sent as plain text, with nothing left waiting.
 */
export async function askImageConfirmation(args: {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  imageMessageId: string
  question: string
  unreadable: boolean
}): Promise<{ providerMessageId: string | null }> {
  const body = args.question.slice(0, MAX_BODY)
  if (args.unreadable) {
    const sent = await engineSendText({
      accountId: args.accountId,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      text: body,
    })
    return { providerMessageId: sent.whatsapp_message_id ?? null }
  }

  const lang = languageOf(body)
  const askedAt = Date.now()
  await note(
    args.conversationId,
    `${IMAGE_ASK_MARKER} (image: ${args.imageMessageId}, lang: ${lang}, asked: ${askedAt}). Waiting for their answer.`,
  )
  const t = TEXT[lang]
  const sent = await engineSendInteractiveButtons({
    accountId: args.accountId,
    userId: args.userId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    bodyText: body,
    buttons: [
      { id: imageButtonId('yes', askedAt), title: t.yes },
      { id: imageButtonId('no', askedAt), title: t.no },
    ],
  })
  return { providerMessageId: sent.whatsapp_message_id ?? null }
}

/**
 * The customer answered. Returns false when no image question is waiting
 * — the message is then handled like any other.
 */
export async function answerImageConfirmation(args: {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  answer: 'yes' | 'no'
  /** From a tapped button: which question it answers. Absent when typed. */
  askedAt?: number
  /** The answer itself, already stored — not counted as "said something else". */
  currentMessageId?: string
  providerMessageId?: string
}): Promise<boolean> {
  const ask = await findImageAsk({
    conversationId: args.conversationId,
    askedAt: args.askedAt,
    currentMessageId: args.currentMessageId,
  })
  if (!ask) return false

  if (args.answer === 'no') {
    await note(args.conversationId, `${REJECTED_NOTE} (image: ${ask.imageMessageId})`)
    await engineSendText({
      accountId: args.accountId,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      text: TEXT[ask.lang].retry,
    }).catch((err) => console.error('[image-confirm] reply failed:', err instanceof Error ? err.message : err))
    return true
  }

  await note(args.conversationId, `${CONFIRMED_NOTE} (image: ${ask.imageMessageId})`)
  // Only an image in this same conversation: a note naming any other id
  // is never followed.
  const image = await prisma.message.findFirst({
    where: { id: ask.imageMessageId, conversation_id: args.conversationId },
    select: { transcript: true, content_text: true },
  })
  if (!image?.transcript) return true

  const { autoReplyToMessage } = await import('./auto-reply')
  void autoReplyToMessage({
    accountId: args.accountId,
    userId: args.userId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    message: assistantMessageForImage({ reading: image.transcript, caption: image.content_text, confirmed: true }),
    channel: 'whatsapp',
    providerMessageId: args.providerMessageId,
    image: { confirmed: true, languageSample: await recentCustomerWords(args.conversationId) },
  })
    .then((outcome) => console.log(`[image-confirm] confirmed; assistant ${outcome} on ${args.conversationId}`))
    .catch((err) => console.error('[image-confirm] assistant failed:', err instanceof Error ? err.message : err))
  return true
}

/** The language they write in, from their own last few messages —
 *  including the button they just tapped, which is in that language. */
async function recentCustomerWords(conversationId: string): Promise<string> {
  const rows = await prisma.message
    .findMany({
      where: { conversation_id: conversationId, sender_type: 'customer', content_text: { not: null } },
      orderBy: { created_at: 'desc' },
      take: 4,
      select: { content_text: true },
    })
    .catch(() => [] as { content_text: string | null }[])
  return rows.map((r) => r.content_text ?? '').join(' ').slice(0, 400)
}
