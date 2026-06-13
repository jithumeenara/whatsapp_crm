"use client";

/**
 * Rich text area for chatbot message fields.
 * Provides WhatsApp-compatible formatting (bold, italic, strikethrough,
 * bullets, numbers), emoji picker, variable dropdown, and an expand modal.
 */

import { useRef, useState, useEffect, useCallback } from "react";
import {
  Bold,
  Italic,
  Strikethrough,
  List,
  ListOrdered,
  Smile,
  Maximize2,
  ChevronDown,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Emoji data ──────────────────────────────────────────────────

const EMOJI_GROUPS = [
  {
    label: "Smileys",
    emojis: ["😀","😊","😂","🤣","😍","🥰","😘","😁","😄","🙂","😉","😋","😎","🤩","🥳","😅","😇","🫠","😏","🤔"],
  },
  {
    label: "Gestures",
    emojis: ["👋","✋","👏","🙌","🤝","👍","👎","✌️","🤞","🙏","💪","☝️","🤙","🫶","🫵","👌","🤏","🖖"],
  },
  {
    label: "Hearts",
    emojis: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","💕","💞","💓","💗","💖","💝","❤️‍🔥","🩵","🩶","💔"],
  },
  {
    label: "Business",
    emojis: ["✅","❌","⚠️","💡","📢","🔔","📌","📝","📊","📈","💼","🏆","⭐","🔥","💯","🎯","🚨","📣","🔒","📎"],
  },
  {
    label: "Shopping",
    emojis: ["🛒","🎁","📦","💰","💳","🏷️","🛍️","🎀","💎","🏅","🥇","🎉","🎊","🎈","🆕","🆓","🔑"],
  },
  {
    label: "Travel & Tech",
    emojis: ["🚀","✈️","🏠","📱","💻","⏰","📅","🌍","📍","🔗","💬","📲","🚗","🏪","🏥","🎓","⚡"],
  },
];

// ─── Props ───────────────────────────────────────────────────────

export interface RichTextAreaProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Variable names from collect_input nodes */
  vars?: string[];
  minHeight?: number;
  className?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

function useSel(ref: React.RefObject<HTMLTextAreaElement | null>) {
  return () => {
    const ta = ref.current;
    if (!ta) return { start: 0, end: 0 };
    return { start: ta.selectionStart, end: ta.selectionEnd };
  };
}

// ─── Toolbar component ───────────────────────────────────────────

interface ToolbarProps {
  onWrap: (prefix: string, suffix: string) => void;
  onPrefixLines: (fn: (i: number) => string) => void;
  onInsert: (text: string) => void;
  vars: string[];
  size?: "sm" | "md";
}

function Toolbar({ onWrap, onPrefixLines, onInsert, vars, size = "sm" }: ToolbarProps) {
  const [showEmoji, setShowEmoji] = useState(false);
  const [showVars, setShowVars] = useState(false);
  const btnH = size === "md" ? "h-7 w-7" : "h-6 w-6";
  const iconH = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";

  return (
    <div className="flex flex-wrap items-center gap-0.5">
      {/* Format buttons */}
      {[
        { icon: Bold,          title: "Bold (*text*)",       fn: () => onWrap("*", "*") },
        { icon: Italic,        title: "Italic (_text_)",     fn: () => onWrap("_", "_") },
        { icon: Strikethrough, title: "Strikethrough (~text~)", fn: () => onWrap("~", "~") },
        { icon: List,          title: "Bullet list",         fn: () => onPrefixLines(() => "• ") },
        { icon: ListOrdered,   title: "Numbered list",       fn: () => onPrefixLines((i) => `${i + 1}. `) },
      ].map(({ icon: Icon, title, fn }) => (
        <button
          key={title}
          type="button"
          title={title}
          onMouseDown={(e) => { e.preventDefault(); fn(); }}
          className={cn(
            "flex items-center justify-center rounded text-muted-foreground",
            "hover:bg-muted hover:text-foreground transition-colors",
            btnH,
          )}
        >
          <Icon className={iconH} />
        </button>
      ))}

      <span className="mx-1 h-4 w-px shrink-0 bg-border" />

      {/* Emoji picker */}
      <div className="relative">
        <button
          type="button"
          title="Insert emoji"
          onMouseDown={(e) => { e.preventDefault(); setShowEmoji((v) => !v); setShowVars(false); }}
          className={cn(
            "flex items-center justify-center rounded text-muted-foreground",
            "hover:bg-muted hover:text-foreground transition-colors",
            btnH,
            showEmoji && "bg-muted text-foreground",
          )}
        >
          <Smile className={iconH} />
        </button>

        {showEmoji && (
          <div
            className="absolute bottom-full left-0 z-[100] mb-1 w-72 rounded-lg border border-border bg-card shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Emoji
              </span>
              <button
                onMouseDown={(e) => { e.preventDefault(); setShowEmoji(false); }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <div className="max-h-52 overflow-y-auto p-2 space-y-1.5">
              {EMOJI_GROUPS.map((g) => (
                <div key={g.label}>
                  <p className="mb-0.5 px-0.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                    {g.label}
                  </p>
                  <div className="flex flex-wrap">
                    {g.emojis.map((em) => (
                      <button
                        key={em}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); onInsert(em); setShowEmoji(false); }}
                        className="flex h-7 w-7 items-center justify-center rounded text-base hover:bg-muted transition-colors"
                      >
                        {em}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Variables dropdown */}
      {vars.length > 0 && (
        <div className="relative">
          <button
            type="button"
            title="Insert variable"
            onMouseDown={(e) => { e.preventDefault(); setShowVars((v) => !v); setShowEmoji(false); }}
            className={cn(
              "flex h-6 items-center gap-0.5 rounded px-1.5 font-mono text-[10px] font-semibold",
              "text-teal-700 hover:bg-teal-50 transition-colors",
              showVars && "bg-teal-50",
            )}
          >
            {"{{x}}"}
            <ChevronDown className="h-2.5 w-2.5" />
          </button>

          {showVars && (
            <div
              className="absolute bottom-full left-0 z-[100] mb-1 min-w-[190px] overflow-hidden rounded-lg border border-border bg-card shadow-xl"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="border-b border-border px-3 py-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Collected variables
                </p>
              </div>
              <div className="py-1 max-h-48 overflow-y-auto">
                {vars.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); onInsert(`{{${v}}}`); setShowVars(false); }}
                    className="flex w-full items-center px-3 py-1.5 hover:bg-muted transition-colors"
                  >
                    <span className="rounded bg-teal-500/10 px-1.5 py-0.5 font-mono text-[10px] text-teal-700">
                      {`{{${v}}}`}
                    </span>
                    <span className="ml-2 text-[10px] text-muted-foreground truncate">
                      → collected answer
                    </span>
                  </button>
                ))}
                {/* Contact fields */}
                {["contact.name", "contact.phone", "contact.email"].map((cf) => (
                  <button
                    key={cf}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); onInsert(`{{${cf}}}`); setShowVars(false); }}
                    className="flex w-full items-center px-3 py-1.5 hover:bg-muted transition-colors"
                  >
                    <span className="rounded bg-sky-500/10 px-1.5 py-0.5 font-mono text-[10px] text-sky-700">
                      {`{{${cf}}}`}
                    </span>
                    <span className="ml-2 text-[10px] text-muted-foreground truncate">
                      contact field
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Expand modal ────────────────────────────────────────────────

function ExpandModal({
  value,
  onChange,
  vars,
  placeholder,
  onApply,
  onClose,
}: {
  value: string;
  onChange: (v: string) => void;
  vars: string[];
  placeholder?: string;
  onApply: (v: string) => void;
  onClose: () => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  const getSel = useSel(taRef);

  function wrapWith(prefix: string, suffix: string) {
    const { start, end } = getSel();
    const selected = value.slice(start, end) || "text";
    const nv = value.slice(0, start) + prefix + selected + suffix + value.slice(end);
    onChange(nv);
    setTimeout(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(
        start + prefix.length,
        start + prefix.length + selected.length,
      );
    }, 0);
  }

  function prefixLines(fn: (i: number) => string) {
    const { start, end } = getSel();
    const chunk = start === end ? value : value.slice(start, end);
    const lines = chunk.split("\n").map((l, i) => fn(i) + l).join("\n");
    const nv = start === end ? lines : value.slice(0, start) + lines + value.slice(end);
    onChange(nv);
    setTimeout(() => taRef.current?.focus(), 0);
  }

  function insertAt(text: string) {
    const { start } = getSel();
    const nv = value.slice(0, start) + text + value.slice(start);
    onChange(nv);
    setTimeout(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(start + text.length, start + text.length);
    }, 0);
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex w-[700px] max-w-[96vw] flex-col rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <p className="text-sm font-semibold text-foreground">Edit message</p>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-4 py-2">
          <Toolbar
            onWrap={wrapWith}
            onPrefixLines={prefixLines}
            onInsert={insertAt}
            vars={vars}
            size="md"
          />
          <div className="flex-1" />
          <span className="text-[10px] text-muted-foreground">
            *bold*&nbsp; _italic_&nbsp; ~strike~&nbsp; • bullet
          </span>
        </div>

        {/* Textarea */}
        <div className="p-5">
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            autoFocus
            className="h-60 w-full resize-none rounded-lg border border-border bg-background p-3 text-sm leading-relaxed text-foreground outline-none transition-shadow focus:ring-2 focus:ring-primary/30"
          />
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            WhatsApp formatting: *bold* · _italic_ · ~strikethrough~ · • bullet · 1. numbered
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onApply(value)}>
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main RichTextArea component ─────────────────────────────────

export function RichTextArea({
  value,
  onChange,
  placeholder,
  vars = [],
  minHeight = 80,
  className,
}: RichTextAreaProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  // After a format action, we want to restore cursor position post-render
  const cursorRef = useRef<[number, number] | null>(null);
  const [showExpand, setShowExpand] = useState(false);
  const [expandValue, setExpandValue] = useState(value);

  // Restore cursor after React updates textarea value
  useEffect(() => {
    if (cursorRef.current && taRef.current) {
      taRef.current.setSelectionRange(...cursorRef.current);
      cursorRef.current = null;
    }
  });

  const getSel = useSel(taRef);

  const wrapWith = useCallback(
    (prefix: string, suffix: string) => {
      const { start, end } = getSel();
      const selected = value.slice(start, end) || "text";
      const nv = value.slice(0, start) + prefix + selected + suffix + value.slice(end);
      cursorRef.current = [start + prefix.length, start + prefix.length + selected.length];
      onChange(nv);
    },
    [value, onChange, getSel],
  );

  const prefixLines = useCallback(
    (fn: (i: number) => string) => {
      const { start, end } = getSel();
      const chunk = start === end ? value : value.slice(start, end);
      const lines = chunk.split("\n").map((l, i) => fn(i) + l).join("\n");
      const nv = start === end ? lines : value.slice(0, start) + lines + value.slice(end);
      onChange(nv);
      cursorRef.current = [start, start + lines.length];
    },
    [value, onChange, getSel],
  );

  const insertAt = useCallback(
    (text: string) => {
      const { start } = getSel();
      const nv = value.slice(0, start) + text + value.slice(start);
      cursorRef.current = [start + text.length, start + text.length];
      onChange(nv);
    },
    [value, onChange, getSel],
  );

  return (
    <>
      <div className={cn("overflow-visible rounded-md border border-border", className)}>
        {/* Toolbar strip */}
        <div className="flex items-center gap-1 border-b border-border bg-muted/40 px-1.5 py-1">
          <Toolbar
            onWrap={wrapWith}
            onPrefixLines={prefixLines}
            onInsert={insertAt}
            vars={vars}
            size="sm"
          />
          <div className="flex-1" />
          {/* Expand button */}
          <button
            type="button"
            title="Expand to full editor"
            onMouseDown={(e) => {
              e.preventDefault();
              setExpandValue(value);
              setShowExpand(true);
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
        </div>

        {/* Controlled textarea */}
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ minHeight }}
          className={cn(
            "w-full resize-y rounded-b-md bg-transparent px-3 py-2 text-xs leading-relaxed",
            "text-foreground placeholder:text-muted-foreground/60",
            "outline-none focus:ring-0",
          )}
        />
      </div>

      {showExpand && (
        <ExpandModal
          value={expandValue}
          onChange={setExpandValue}
          vars={vars}
          placeholder={placeholder}
          onApply={(v) => {
            onChange(v);
            setShowExpand(false);
          }}
          onClose={() => setShowExpand(false)}
        />
      )}
    </>
  );
}

// ─── VarInput: Input field with variable dropdown ────────────────

export function VarInput({
  value,
  onChange,
  placeholder,
  vars = [],
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  vars?: string[];
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [showVars, setShowVars] = useState(false);

  function insertAt(text: string) {
    const input = inputRef.current;
    if (!input) {
      onChange(value + text);
      return;
    }
    const start = input.selectionStart ?? value.length;
    const nv = value.slice(0, start) + text + value.slice(start);
    onChange(nv);
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(start + text.length, start + text.length);
    }, 0);
  }

  if (vars.length === 0) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "flex h-8 w-full rounded-md border border-border bg-background px-3 py-1 text-xs",
          "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50",
          className,
        )}
      />
    );
  }

  return (
    <div className="relative flex items-center gap-1">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "flex h-8 flex-1 rounded-md border border-border bg-background px-3 py-1 text-xs",
          "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50",
          className,
        )}
      />
      <div className="relative">
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); setShowVars((v) => !v); }}
          className={cn(
            "flex h-8 items-center gap-0.5 rounded-md border border-border bg-background px-2",
            "font-mono text-[10px] font-semibold text-teal-700 hover:bg-teal-50 transition-colors shrink-0",
            showVars && "bg-teal-50",
          )}
          title="Insert variable"
        >
          {"{{x}}"}
          <ChevronDown className="h-2.5 w-2.5" />
        </button>
        {showVars && (
          <div className="absolute right-0 top-full z-[100] mt-1 min-w-[200px] overflow-hidden rounded-lg border border-border bg-card shadow-xl">
            <div className="border-b border-border px-3 py-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Variables
              </p>
            </div>
            <div className="max-h-48 overflow-y-auto py-1">
              {vars.map((v) => (
                <button
                  key={v}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); insertAt(`{{${v}}}`); setShowVars(false); }}
                  className="flex w-full items-center px-3 py-1.5 hover:bg-muted transition-colors"
                >
                  <span className="rounded bg-teal-500/10 px-1.5 py-0.5 font-mono text-[10px] text-teal-700">
                    {`{{${v}}}`}
                  </span>
                </button>
              ))}
              {["contact.name", "contact.phone", "contact.email"].map((cf) => (
                <button
                  key={cf}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); insertAt(`{{${cf}}}`); setShowVars(false); }}
                  className="flex w-full items-center px-3 py-1.5 hover:bg-muted transition-colors"
                >
                  <span className="rounded bg-sky-500/10 px-1.5 py-0.5 font-mono text-[10px] text-sky-700">
                    {`{{${cf}}}`}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
