"use client";

/**
 * The email body as people expect it: bold looks bold, a list is a list
 * and carries on when you press Enter, "- " or "1. " at the start of a
 * line starts one, Ctrl+B / I / U / K work.
 *
 * It is a contentEditable box driven by the browser's own editing
 * commands — no editor library, so nothing extra to ship to the 2 GB
 * server's build. What leaves it is never HTML: every change is read
 * back into the composer's light markup (lib/email/editor-dom), and the
 * server builds the email from that. Pasted content arrives as plain
 * text, so styles and scripts from a web page or Word never come in.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { editorHtmlFromMarkup, markupFromEditor } from "@/lib/email/editor-dom";
import { escapeHtml, safeLink } from "@/lib/email/markup";
import { cn } from "@/lib/utils";

export interface FormatState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  ul: boolean;
  ol: boolean;
  link: string | null;
}

export const NO_FORMAT: FormatState = { bold: false, italic: false, underline: false, ul: false, ol: false, link: null };

export interface RichEmailEditorHandle {
  focus(): void;
  /** Replaces everything (a saved draft, an AI draft, a translation). */
  setMarkup(markup: string): void;
  /** Plain text at the cursor (emoji). */
  insertText(text: string): void;
  /** Formatted content at the cursor (a product line). */
  insertMarkup(markup: string): void;
  command(cmd: "bold" | "italic" | "underline" | "ul" | "ol"): void;
  /** Remembers the selection before a link box takes focus. */
  saveSelection(): void;
  applyLink(url: string): boolean;
  removeLink(): void;
}

interface Props {
  id: string;
  initialMarkup: string;
  placeholder: string;
  onChange(markup: string): void;
  onFormatChange(state: FormatState): void;
  onSubmit(): void;
  onLinkShortcut(): void;
  /** Files pasted or dropped in — they become attachments, never inline. */
  onFiles?(files: File[]): void;
  className?: string;
}

function exec(command: string, value?: string) {
  // Deprecated on paper, and still the one editing API every browser
  // implements with a working undo stack. Nothing here depends on its
  // HTML output — the DOM is read back into markup either way.
  return document.execCommand(command, false, value);
}

export const RichEmailEditor = forwardRef<RichEmailEditorHandle, Props>(function RichEmailEditor(
  { id, initialMarkup, placeholder, onChange, onFormatChange, onSubmit, onLinkShortcut, onFiles, className },
  ref,
) {
  const boxRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const initial = useRef(initialMarkup);

  const emit = useCallback(() => {
    const box = boxRef.current;
    if (box) onChange(markupFromEditor(box));
  }, [onChange]);

  const inside = useCallback((node: Node | null) => !!node && !!boxRef.current?.contains(node), []);

  const readFormat = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || !inside(sel.anchorNode)) return;
    let node: Node | null = sel.anchorNode;
    let ul = false;
    let ol = false;
    let link: string | null = null;
    while (node && node !== boxRef.current) {
      if (node.nodeType === 1) {
        const tag = (node as Element).tagName;
        if (tag === "UL" && !ol) ul = true;
        if (tag === "OL" && !ul) ol = true;
        if (tag === "A" && !link) link = (node as Element).getAttribute("href");
      }
      node = node.parentNode;
    }
    onFormatChange({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
      ul,
      ol,
      link,
    });
  }, [onFormatChange, inside]);

  // The starting content, once. Everything after is the browser's.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.innerHTML = editorHtmlFromMarkup(initial.current);
  }, []);

  useEffect(() => {
    const onSelection = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && inside(sel.anchorNode)) {
        savedRange.current = sel.getRangeAt(0).cloneRange();
        readFormat();
      }
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, [readFormat, inside]);

  function restoreSelection() {
    const box = boxRef.current;
    if (!box) return;
    box.focus();
    const sel = window.getSelection();
    if (!sel) return;
    if (savedRange.current && inside(savedRange.current.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    } else if (!inside(sel.anchorNode)) {
      // Nothing remembered: the end of the text.
      const r = document.createRange();
      r.selectNodeContents(box);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }

  function prepare() {
    restoreSelection();
    exec("styleWithCSS", "false");
    exec("defaultParagraphSeparator", "div");
  }

  useImperativeHandle(ref, () => ({
    focus() {
      restoreSelection();
    },
    setMarkup(markup: string) {
      const box = boxRef.current;
      if (!box) return;
      box.innerHTML = editorHtmlFromMarkup(markup);
      savedRange.current = null;
      emit();
    },
    insertText(text: string) {
      prepare();
      exec("insertText", text);
      emit();
    },
    insertMarkup(markup: string) {
      prepare();
      exec("insertHTML", editorHtmlFromMarkup(markup));
      emit();
    },
    command(cmd) {
      prepare();
      if (cmd === "ul") exec("insertUnorderedList");
      else if (cmd === "ol") exec("insertOrderedList");
      else exec(cmd);
      emit();
      readFormat();
    },
    saveSelection() {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && inside(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange();
    },
    applyLink(raw: string) {
      const trimmed = raw.trim();
      const url = safeLink(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
      if (!url) return false;
      prepare();
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) exec("createLink", url);
      else exec("insertHTML", `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>&nbsp;`);
      emit();
      readFormat();
      return true;
    },
    removeLink() {
      prepare();
      const sel = window.getSelection();
      // With only a cursor inside a link, take the whole link.
      if (sel && sel.isCollapsed) {
        let node: Node | null = sel.anchorNode;
        while (node && node !== boxRef.current && !(node.nodeType === 1 && (node as Element).tagName === "A")) node = node.parentNode;
        if (node && node !== boxRef.current) {
          const r = document.createRange();
          r.selectNodeContents(node);
          sel.removeAllRanges();
          sel.addRange(r);
        }
      }
      exec("unlink");
      emit();
      readFormat();
    },
  }));

  /** "- " or "1. " typed at the start of a line becomes a list. */
  function autoList(e: React.KeyboardEvent<HTMLDivElement>) {
    const sel = window.getSelection();
    const box = boxRef.current;
    if (!box || !sel || !sel.isCollapsed || !inside(sel.anchorNode)) return false;
    // The line the cursor is on: the nearest block around it. Chrome nests
    // the line after a list inside the list's own wrapper, so the box's
    // direct child is not always the line.
    let block: Node | null = sel.anchorNode;
    while (block && block !== box && !(block.nodeType === 1 && ["DIV", "P", "LI"].includes((block as Element).tagName))) {
      block = block.parentNode;
    }
    if (!block) return false;
    if (block !== box && (block as Element).tagName === "LI") return false;
    if (block === box) {
      // The unwrapped first line: only when nothing block-like comes before it.
      let top: Node | null = sel.anchorNode;
      while (top && top.parentNode !== box) top = top.parentNode;
      let prev = top?.previousSibling ?? null;
      while (prev) {
        if (prev.nodeType === 1 && ["DIV", "BR", "UL", "OL", "P"].includes((prev as Element).tagName)) return false;
        prev = prev.previousSibling;
      }
    }
    const before = document.createRange();
    before.setStart(block, 0);
    before.setEnd(sel.anchorNode!, sel.anchorOffset);
    const typed = before.toString();
    const bullet = /^[-*•]$/.test(typed);
    const numbered = /^\d{1,3}[.)]$/.test(typed);
    if (!bullet && !numbered) return false;
    e.preventDefault();
    sel.removeAllRanges();
    sel.addRange(before);
    exec("delete");
    exec(bullet ? "insertUnorderedList" : "insertOrderedList");
    return true;
  }

  return (
    <div
      id={id}
      ref={boxRef}
      role="textbox"
      aria-multiline="true"
      aria-label="Email"
      aria-placeholder={placeholder}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      data-placeholder={placeholder}
      onInput={emit}
      onKeyUp={readFormat}
      onMouseUp={readFormat}
      onKeyDown={(e) => {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.key === "Enter") {
          e.preventDefault();
          onSubmit();
          return;
        }
        if (mod && e.key.toLowerCase() === "k") {
          e.preventDefault();
          const sel = window.getSelection();
          if (sel && sel.rangeCount) savedRange.current = sel.getRangeAt(0).cloneRange();
          onLinkShortcut();
          return;
        }
        if (e.key === " " && !mod && !e.altKey && autoList(e)) emit();
      }}
      onPaste={(e) => {
        e.preventDefault();
        const pasted = Array.from(e.clipboardData.files ?? []);
        if (pasted.length && onFiles) {
          onFiles(pasted);
          return;
        }
        const text = e.clipboardData.getData("text/plain");
        if (!text) return;
        const sel = window.getSelection();
        const url = safeLink(text.trim());
        // An address pasted over selected words links them, as in Gmail.
        if (url && sel && !sel.isCollapsed && !/\s/.test(text.trim())) exec("createLink", url);
        else exec("insertText", text.replace(/\r\n?/g, "\n"));
        emit();
      }}
      onDrop={(e) => {
        // Text is inserted as text; files become attachments.
        e.preventDefault();
        const dropped = Array.from(e.dataTransfer.files ?? []);
        if (dropped.length) {
          e.stopPropagation();
          onFiles?.(dropped);
          return;
        }
        const text = e.dataTransfer.getData("text/plain");
        if (text) {
          exec("insertText", text);
          emit();
        }
      }}
      className={cn(
        "relative min-h-[120px] max-h-80 w-full overflow-y-auto whitespace-pre-wrap break-words px-3 py-2.5 text-[14px] leading-relaxed text-slate-800 outline-none",
        "[&_a]:text-sky-700 [&_a]:underline [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-6",
        className,
      )}
    />
  );
});
