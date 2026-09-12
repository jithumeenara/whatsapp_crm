/**
 * Converts common standard-Markdown patterns an LLM naturally produces
 * into WhatsApp's own formatting syntax, so an AI-generated reply
 * actually renders correctly in a real WhatsApp conversation instead of
 * showing literal `**`/`#` characters WhatsApp's own renderer doesn't
 * understand at all.
 *
 * Real bug, found live (Sept 2026): a chatbot reply came back as
 * "**multi-tenant" and "**Draft the Response:**" — Gemini (like every
 * mainstream model) defaults to GitHub-flavored Markdown, but WhatsApp's
 * dialect is different: single `*bold*` (not double), `_italic_` (not
 * single-asterisk), `~strike~`, and no header syntax at all — see
 * message-bubble.tsx's FORMAT_REGEX for the exact grammar this app's own
 * inbox already parses on the *display* side. Nothing converted between
 * the two dialects before a reply went out, so this affected real
 * customer sends, not just the Test AI screen.
 *
 * Deliberately pragmatic, not a full Markdown parser — covers the
 * patterns models actually produce in short chat replies (bold,
 * headers, inline code). Doesn't attempt tables, nested bold-inside-
 * italic, or other rarely-seen-in-chat constructs; a system prompt
 * should still ask the model to keep formatting simple for WhatsApp
 * (see docs/FULL_APP_TESTING_SYSTEM_PROMPT.md's example), this is the
 * safety net for when it doesn't listen.
 */
export function markdownToWhatsApp(text: string): string {
  let out = text

  // "# Heading" / "## Heading" -> "*Heading*" — WhatsApp has no header
  // syntax at all; a bold line is the closest equivalent that actually
  // renders as emphasis instead of literal hash marks.
  out = out.replace(/^#{1,6}[ \t]+(.+)$/gm, '*$1*')

  // "**bold**" / "__bold__" -> "*bold*" (WhatsApp's own bold marker).
  // Must run before anything treats a lone "*" as meaningful, since a
  // literal double-asterisk pair is otherwise indistinguishable from
  // two adjacent WhatsApp bold markers.
  out = out.replace(/\*\*(\S(?:[^*]*\S)?)\*\*/g, '*$1*')
  out = out.replace(/__(\S(?:[^_]*\S)?)__/g, '*$1*')

  // "`code`" -> "code" — WhatsApp only has ```block``` monospace, no
  // inline marker; a stray backtick reads as more broken than just
  // dropping it. Triple-backtick blocks are left untouched (WhatsApp
  // does render those).
  out = out.replace(/(?<!`)`([^`\n]+)`(?!`)/g, '$1')

  out = breakOutInlineLists(out)

  // Three or more blank lines in a row is the model padding, not
  // structure; collapse to one blank line.
  out = out.replace(/\n{3,}/g, '\n\n')

  return out.trim()
}

/**
 * Moves list items that the model wrote inline onto their own lines.
 *
 * Real example from a live reply: "...could you please let us know: 1.
 * *Which organization* do you belong to? 2. *Which training program*..."
 * — in a chat bubble that is an unreadable wall. The items are the
 * structure of the message and need to look like it.
 *
 * Conservative by design. A numbered item only counts when it follows
 * sentence-ending punctuation or a colon AND is followed by a capital
 * letter or a bold marker, so ordinary prose survives untouched:
 * "invoice No. 4 was paid", "arrive at 9. 30 people expected", and any
 * decimal or version number are all left alone. When in doubt it does
 * nothing, because mangling a correct message is worse than leaving an
 * ugly one.
 */
function breakOutInlineLists(text: string): string {
  let out = text

  // "…: 1. Something"  /  "…? 2. *Something*"  ->  each on its own line.
  out = out.replace(
    /([:.?!*])[ \t]+(\d{1,2})\.[ \t]+(?=[A-Z\u0D00-\u0D7F*])/g,
    (_match, punctuation: string, number: string) => `${punctuation}\n${number}. `,
  )

  // Same for dash bullets written inline after a colon.
  out = out.replace(/([:.?!])[ \t]+-[ \t]+(?=\S)/g, (_m, punctuation: string) => `${punctuation}\n- `)

  return out
}

/**
 * How a reply should be shaped for a messaging app, appended to every
 * customer-facing prompt.
 *
 * Deliberately about form, never content — an account's own prompt owns
 * what to say, and this owns how it looks on a phone. Without it the
 * default is a single dense paragraph with numbered questions buried
 * mid-sentence, which is unreadable in a chat bubble and reads as
 * machine-generated.
 *
 * Kept short on purpose: every line here competes for the same context
 * budget as the knowledge the answer actually comes from.
 */
export const WHATSAPP_REPLY_STYLE = [
  "HOW TO WRITE THE REPLY (this is about format, not content):",
  "- Keep it short. Two or three sentences is usually enough. This is a chat message, not an email.",
  "- Ask at most one question per message. If you need several answers, ask the most important one first.",
  "- Put each list item on its own line, starting with a dash. Never write a numbered list inside a sentence.",
  "- Use a blank line between ideas so the message is skimmable on a phone.",
  "- No headings, no tables, no bullet characters other than a dash. Use *bold* sparingly, for one key phrase at most.",
  "- Write plainly, the way a helpful colleague would type it. No corporate phrasing, no restating the question back.",
].join("\n")
