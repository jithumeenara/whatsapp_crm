/**
 * The most text one knowledge entry keeps, and the note that says when
 * some was left out. Shared by every source (files, PDFs, scans, web
 * pages, chatbots, Data Store tables) so none of them cuts silently.
 */
export const MAX_TEXT_CHARS = 200_000

/**
 * The text to store, never silently cut: past 200,000 characters only the
 * first part is kept and a note says so (the owner sees it in the entry and
 * can split the source); a scan stopped at the model's output limit says it
 * was only partly read.
 */
export function keepWithNote(text: string, opts: { partlyRead?: boolean } = {}): string {
  let out = text
  const notes: string[] = []
  if (out.length > MAX_TEXT_CHARS) {
    out = out.slice(0, MAX_TEXT_CHARS)
    notes.push('(Only the first 200,000 characters of this source were kept. Split it into parts to include the rest.)')
  }
  if (opts.partlyRead) notes.push('(This scan was only partly read — the later pages may be missing. Split it into smaller parts.)')
  return notes.length ? `${out}\n\n${notes.join('\n')}` : out
}
