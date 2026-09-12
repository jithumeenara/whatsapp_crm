'use client';

import { Fragment, type ReactNode } from 'react';

/**
 * Renders an Admin Test answer — Markdown tables, bold, bullet/numbered
 * lists and paragraphs.
 *
 * Hand-written rather than pulling in react-markdown + remark-gfm,
 * because the surface is small and known: the admin system prompt asks
 * for exactly these constructs, and the alternative is ~100KB of parser
 * shipped to every Settings visit for one tab. Anything it doesn't
 * recognize falls through as plain text, which reads fine — it never
 * swallows content it can't format.
 *
 * Note this is deliberately NOT the WhatsApp renderer used elsewhere in
 * the app: this pane shows an internal analytics answer in a browser,
 * not a message being sent to WhatsApp, so standard Markdown is the
 * right dialect here.
 */

/** `**bold**` and `` `code` `` inside a line of otherwise plain text. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('**')) {
      out.push(<strong key={key++} className="font-semibold text-slate-900">{token.slice(2, -2)}</strong>);
    } else {
      out.push(
        <code key={key++} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px] text-slate-700">
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim());
}

const isTableRow = (line: string) => line.trim().startsWith('|') && line.trim().endsWith('|');
const isDivider = (line: string) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');

export function MarkdownAnswer({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── Table ──
    if (isTableRow(line) && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={key++} className="my-2 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-slate-50">
                {header.map((h, hi) => (
                  <th key={hi} className="border-b border-slate-200 px-3 py-2 text-[12px] font-semibold text-slate-600">
                    {inline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="border-b border-slate-100 last:border-0">
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={`px-3 py-2 text-[12.5px] text-slate-700 ${ci > 0 ? 'tabular-nums' : ''}`}
                    >
                      {inline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // ── List ──
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d+\./.test(line);
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''));
        i++;
      }
      const ListTag = ordered ? 'ol' : 'ul';
      blocks.push(
        <ListTag
          key={key++}
          className={`my-1.5 space-y-1 pl-5 text-[13px] text-slate-700 ${ordered ? 'list-decimal' : 'list-disc'}`}
        >
          {items.map((item, ii) => (
            <li key={ii}>{inline(item)}</li>
          ))}
        </ListTag>,
      );
      continue;
    }

    // ── Heading (rendered as a bold line — this pane has no document
    //    hierarchy to anchor real heading levels to) ──
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      blocks.push(
        <p key={key++} className="mt-2 mb-1 text-[13.5px] font-semibold text-slate-900">
          {inline(heading[1])}
        </p>,
      );
      i++;
      continue;
    }

    // ── Paragraph (consecutive non-blank, non-special lines) ──
    if (line.trim()) {
      const para: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !isTableRow(lines[i]) &&
        !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) &&
        !/^#{1,6}\s+/.test(lines[i])
      ) {
        para.push(lines[i]);
        i++;
      }
      blocks.push(
        <p key={key++} className="text-[13px] leading-relaxed text-slate-700">
          {para.map((l, li) => (
            <Fragment key={li}>
              {li > 0 && <br />}
              {inline(l)}
            </Fragment>
          ))}
        </p>,
      );
      continue;
    }

    i++;
  }

  return <div className="space-y-1.5">{blocks}</div>;
}
