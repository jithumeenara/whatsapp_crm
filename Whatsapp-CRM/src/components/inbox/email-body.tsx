"use client";

import { Fragment } from "react";
import { FileText, Image as ImageIcon, Paperclip } from "lucide-react";
import { parseMarkup, type Inline } from "@/lib/email/markup";
import type { Message } from "@/types";

/**
 * The composer's light formatting, drawn as React elements — never as
 * HTML — so what an agent typed can only ever be text with bold,
 * italic, underline and lists.
 */
function Runs({ runs }: { runs: Inline[] }) {
  return (
    <>
      {runs.map((r, i) => {
        let node: React.ReactNode = r.text;
        if (r.u) node = <u>{node}</u>;
        if (r.i) node = <em>{node}</em>;
        if (r.b) node = <strong>{node}</strong>;
        return <Fragment key={i}>{node}</Fragment>;
      })}
    </>
  );
}

export function RichEmailBody({ text }: { text: string }) {
  return (
    <div className="space-y-3 break-words text-[14px] leading-relaxed text-slate-800">
      {parseMarkup(text).map((b, i) => {
        if (b.type === "p") {
          return (
            <p key={i}>
              {b.lines.map((l, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  <Runs runs={l} />
                </Fragment>
              ))}
            </p>
          );
        }
        const List = b.type === "ul" ? "ul" : "ol";
        return (
          <List key={i} className={b.type === "ul" ? "list-disc pl-6" : "list-decimal pl-6"}>
            {b.items.map((item, j) => (
              <li key={j}><Runs runs={item} /></li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

function sizeLabel(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The files an email carried, each opening in a new tab through the
 *  signed-in, account-checked file route. */
export function EmailAttachments({ message }: { message: Message }) {
  const files = message.email_meta?.attachments ?? [];
  const skipped = message.email_meta?.skipped_attachments ?? [];
  if (files.length === 0 && skipped.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f) => {
            const Icon = f.mime.startsWith("image/") ? ImageIcon : f.mime === "application/pdf" ? FileText : Paperclip;
            return (
              <a
                key={f.file_id}
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex max-w-[260px] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-700 hover:bg-slate-100"
              >
                <Icon className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="truncate">{f.name}</span>
                <span className="shrink-0 text-[11px] text-slate-400">{sizeLabel(f.size)}</span>
              </a>
            );
          })}
        </div>
      )}
      {skipped.length > 0 && (
        <p className="text-[11px] text-amber-700">
          Not brought in (type not allowed, over 10 MB, or not what it claimed to be): {skipped.join(", ")}.
          Open the email in Outlook to see them.
        </p>
      )}
    </div>
  );
}
