/**
 * Splits an email body into what was written now and the quoted history
 * below it, so the thread shows the new part and folds the rest away —
 * the way Gmail, Outlook and Front do.
 *
 * Recognised starts of quoted history, line by line:
 *  - Gmail / Apple Mail: "On Fri, 26 Sep 2026 at 17:03, Name <a@b> wrote:"
 *  - Outlook: a "From: …" line followed within a few lines by "Sent:" or
 *    "Date:", often after a row of underscores
 *  - "-----Original Message-----"
 *  - a closing block of lines starting with ">"
 * When the whole body would be "quoted", nothing is folded.
 */
export function splitQuoted(text: string): { main: string; quoted: string | null } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')

  let cut = -1
  for (let i = 0; i < lines.length && cut < 0; i++) {
    const line = lines[i].trim()
    if (/^On\s.{3,300}\swrote:$/i.test(line)) cut = i
    else if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(line)) cut = i
    else if (/^_{8,}$/.test(line) && /^From:\s/i.test(lines[i + 1]?.trim() ?? '')) cut = i
    else if (/^From:\s.+/i.test(line) && lines.slice(i + 1, i + 5).some((l) => /^(Sent|Date):\s/i.test(l.trim()))) cut = i
  }
  // A trailing run of "> " lines, when nothing else matched.
  if (cut < 0) {
    let j = lines.length - 1
    while (j >= 0 && lines[j].trim() === '') j--
    let k = j
    while (k >= 0 && (lines[k].trimStart().startsWith('>') || lines[k].trim() === '')) k--
    if (k < j && k >= 0) cut = k + 1
  }

  if (cut <= 0) return { main: text.trim(), quoted: null }
  const main = lines.slice(0, cut).join('\n').trim()
  const quoted = lines.slice(cut).join('\n').trim()
  if (!main) return { main: text.trim(), quoted: null }
  return { main, quoted: quoted || null }
}
