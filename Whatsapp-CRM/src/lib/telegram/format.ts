/**
 * WhatsApp's text formatting → Telegram HTML.
 *
 * Everything in the CRM (agent replies, chatbot steps, templates, the AI)
 * is written in WhatsApp's markup: *bold*, _italic_, ~strike~, ```block```,
 * `inline`, "> quote". Sent to Telegram as plain text it shows the stars.
 * Telegram's HTML mode is used because it needs only &, < and > escaped —
 * MarkdownV2 would need a dozen characters escaped and fail on any miss.
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** A marker opens after a start, space or opening punctuation, closes before an end, space or punctuation. */
function inline(text: string, marker: string, tag: string): string {
  // `u` mode refuses needless escapes such as \~, so only * is escaped.
  const m = marker === '*' ? '\\*' : marker
  const re = new RegExp(`(^|[\\s(\\[{"'“‘])${m}(?!\\s)([^${m}\\n]+?)(?<!\\s)${m}(?=$|[\\s.,!?:;)\\]}"'”’])`, 'gmu')
  return text.replace(re, (_all, before: string, inner: string) => `${before}<${tag}>${inner}</${tag}>`)
}

function formatPlain(text: string): string {
  let out = escapeHtml(text)
  out = inline(out, '*', 'b')
  out = inline(out, '_', 'i')
  out = inline(out, '~', 's')
  // "> quote" lines (escaped to "&gt; ").
  out = out.replace(/^&gt; ?(.+)$/gm, '<blockquote>$1</blockquote>')
  return out
}

export function toTelegramHtml(text: string): string {
  // Code first: what is inside a code span is shown exactly as typed.
  const parts = text.split(/(```[\s\S]+?```|`[^`\n]+`)/g)
  return parts
    .map((part) => {
      if (part.startsWith('```') && part.endsWith('```') && part.length > 6) return `<pre>${escapeHtml(part.slice(3, -3))}</pre>`
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return `<code>${escapeHtml(part.slice(1, -1))}</code>`
      return formatPlain(part)
    })
    .join('')
}
