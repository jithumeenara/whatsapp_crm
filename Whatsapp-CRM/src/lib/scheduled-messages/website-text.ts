/**
 * A scheduled message for a website chat.
 *
 * WhatsApp needs an approved template once its 24-hour window closes, so
 * scheduled WhatsApp sends are template-only. A website chat has no window
 * and cannot show a template at all: it is scheduled as plain text, kept
 * until its time, and sent by the sweep's text path (engineSendText routes
 * it to the website).
 */

export const WEBSITE_TEXT_MAX = 4000

export function websiteScheduleText(raw: unknown): { text: string } | { error: string } {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return { error: 'Write the message first.' }
  if (text.length > WEBSITE_TEXT_MAX) return { error: `Keep the message under ${WEBSITE_TEXT_MAX} characters.` }
  return { text }
}
