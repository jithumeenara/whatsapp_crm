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

  return out
}
