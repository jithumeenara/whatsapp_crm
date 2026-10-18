import type { ReactNode } from "react";

/**
 * WhatsApp's own text formatting, shown the way the WhatsApp app shows it:
 * *bold*, _italic_, ~strikethrough~, ```monospace```. Used by the Inbox,
 * the AI test chat and the template preview, so all three agree with what
 * the customer actually sees.
 *
 * A marker's inner content must not start or end with a space to count —
 * "* not bold *" stays literal in real WhatsApp, and here. Monospace is
 * always literal; bold, italic and strike can nest.
 */
const FORMAT_REGEX =
  /```([\s\S]+?)```|\*(\S(?:[^*\n]*\S)?)\*|_(\S(?:[^_\n]*\S)?)_|~(\S(?:[^~\n]*\S)?)~/;

function renderWhatsAppText(text: string, keyPrefix: string, depth = 0): ReactNode[] {
  if (!text) return [];
  if (depth > 4) return [text]; // guard against pathological nested input
  const regex = new RegExp(FORMAT_REGEX, "g");
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text))) {
    if (m.index > lastIndex) nodes.push(text.slice(lastIndex, m.index));
    const key = `${keyPrefix}-${i++}`;
    if (m[1] !== undefined) {
      nodes.push(
        <code key={key} className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.9em]">
          {m[1]}
        </code>,
      );
    } else if (m[2] !== undefined) {
      nodes.push(<strong key={key}>{renderWhatsAppText(m[2], key, depth + 1)}</strong>);
    } else if (m[3] !== undefined) {
      nodes.push(<em key={key}>{renderWhatsAppText(m[3], key, depth + 1)}</em>);
    } else if (m[4] !== undefined) {
      nodes.push(<s key={key}>{renderWhatsAppText(m[4], key, depth + 1)}</s>);
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/** Renders WhatsApp-formatted text (*bold*, _italic_, ~strike~, ```mono```)
 *  as real styled output. */
export function WhatsAppText({ text }: { text: string }) {
  return <>{renderWhatsAppText(text, "f")}</>;
}
