"use client";

import { useState, useRef, useCallback, useEffect, KeyboardEvent } from "react";
import { Send, LayoutTemplate, Paperclip, FileText, Image, Music, Loader2, FolderOpen, ShoppingBag, KeyRound, IndianRupee, Languages, Sparkles, Check, AlertTriangle, Maximize2, Minimize2, Mic, Square, Trash2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import { useCan } from "@/hooks/use-can";
import { cn } from "@/lib/utils";
import { ReplyQuote } from "./reply-quote";
import { toast } from "sonner";
import { FileManagerPicker } from "./file-manager-picker";
import { EmojiPickerPopover } from "./emoji-picker-popover";
import { useVoiceRecorder, formatElapsed } from "./use-voice-recorder";
import { ScheduleMenuButton } from "./schedule-menu-button";

interface ReplyDraft {
  id: string;
  authorLabel: string;
  preview: string;
}

interface MessageComposerProps {
  conversationId: string;
  sessionExpired: boolean;
  channel?: string;
  onSend: (text: string, replyToId?: string) => void;
  onSendMedia: (mediaUrl: string, mediaType: 'image' | 'document' | 'audio' | 'video', filename?: string) => void;
  onOpenTemplates: () => void;
  onOpenCatalog: () => void;
  onSendOtp: () => void;
  onRequestPayment: () => void;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
  /** Language this contact's messages were last detected in (chat
   *  translation) — lets the translate button below know what language
   *  to translate the draft into. Undefined/null hides the button. */
  contactDetectedLanguage?: string | null;
}

/**
 * Offered translation targets.
 *
 * Deliberately a short list of what this customer base actually writes
 * in, rather than every language the model knows: a menu of two hundred
 * is a search box in disguise, and nobody here is answering in Finnish.
 * The customer's own detected language is added at the top at runtime,
 * because that is the one wanted nine times out of ten.
 */
const TRANSLATE_TARGETS = [
  'Malayalam',
  'English',
  'Tamil',
  'Hindi',
  'Kannada',
  'Telugu',
  'Arabic',
] as const;

/** How much of a long reply stays visible before the box scrolls. */
const MAX_VISIBLE_LINES = 10;

/** A press shorter than this was a click, not someone starting to talk. */
const TAP_MS = 350;
/** How long a click waits to see whether a second one follows it. */
const DOUBLE_CLICK_MS = 400;

const ATTACH_OPTIONS = [
  {
    key: 'document' as const,
    label: 'Document',
    icon: FileText,
    color: 'text-blue-500',
    accept: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt',
  },
  {
    key: 'image' as const,
    label: 'Photos & Videos',
    icon: Image,
    color: 'text-emerald-500',
    accept: 'image/png,image/jpeg,image/webp,video/mp4,video/3gpp',
  },
  {
    key: 'audio' as const,
    label: 'Audio',
    icon: Music,
    color: 'text-purple-500',
    accept: 'audio/*',
  },
] as const;

export function MessageComposer({
  conversationId,
  sessionExpired,
  channel,
  onSend,
  onSendMedia,
  onOpenTemplates,
  onOpenCatalog,
  onSendOtp,
  onRequestPayment,
  replyTo,
  onClearReply,
  contactDetectedLanguage,
}: MessageComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadingFilename, setUploadingFilename] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translateOpen, setTranslateOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draftWarnings, setDraftWarnings] = useState<string[]>([]);
  const translateRef = useRef<HTMLDivElement>(null);
  // The agent's own preferred language is no longer consulted: it used
  // to decide whether the translate button appeared at all, which hid it
  // from anyone whose profile language happened to match the customer's
  // — exactly the person who might still want to answer in a third one.
  // The customer's own language first — the one wanted nine times out of
  // ten — then the rest, without repeating it.
  const translateTargets = [
    ...(contactDetectedLanguage?.trim() ? [contactDetectedLanguage.trim()] : []),
    ...TRANSLATE_TARGETS.filter(
      (l) => l.toLowerCase() !== (contactDetectedLanguage ?? '').trim().toLowerCase(),
    ),
  ];

  /**
   * Replaces the draft with its translation.
   *
   * `romanized` returns the same sentence in English letters. For an
   * agent who speaks the language but does not read its script, a
   * native-script translation is unreadable — and an agent who cannot
   * read what they are about to send cannot approve it, which defeats
   * the point of a draft.
   */
  const handleTranslateDraft = useCallback(
    async (targetLanguage: string, romanized: boolean) => {
      if (!text.trim() || translating) return;
      setTranslateOpen(false);
      setTranslating(true);
      try {
        const res = await fetch("/api/messages/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, target_language: targetLanguage, romanized }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Translation failed");
        const next = romanized ? data.romanized_text || data.translated_text : data.translated_text;
        setText(next);
        toast.success(
          romanized ? `Translated to ${targetLanguage}, in English letters` : `Translated to ${targetLanguage}`,
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Translation failed");
      } finally {
        setTranslating(false);
      }
    },
    [text, translating],
  );

  /** Drafts a reply from the thread. Nothing is sent — it lands in the
   *  box for the agent to approve, edit or throw away. */
  const handleDraftReply = useCallback(async () => {
    if (drafting || !conversationId) return;
    setDrafting(true);
    setDraftWarnings([]);
    try {
      const res = await fetch("/api/messages/ai-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not draft a reply");
      setText(data.draft);
      setDraftWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      textareaRef.current?.focus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not draft a reply");
    } finally {
      setDrafting(false);
    }
  }, [conversationId, drafting]);

  // Click-away for the language menu. Registered only while it is open,
  // so the inbox is not carrying a document listener the whole time it
  // is mounted.
  useEffect(() => {
    if (!translateOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!translateRef.current?.contains(e.target as Node)) setTranslateOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setTranslateOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [translateOpen]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const expandedRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentAttachType = useRef<typeof ATTACH_OPTIONS[number]['key']>('document');

  const canSend = useCan("send-messages");
  const readOnly = !canSend;

  /**
   * Grows the box with the message, up to ten lines.
   *
   * Measured from the element's own computed style rather than a pixel
   * constant: the old cap was a hardcoded 96px, which is four lines at
   * today's font size and silently becomes some other number of lines
   * the moment the type scale changes.
   *
   * The scrollbar stays off until the cap is actually reached - left on,
   * it appears on a two-line message and takes a slice of the text width
   * with it.
   */
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";

    const styles = window.getComputedStyle(el);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
    const padding =
      Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
    const maxHeight = lineHeight * MAX_VISIBLE_LINES + padding;

    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  // Also runs when the text arrives from somewhere other than typing -
  // an AI draft, a translation, the large editor, or a box cleared after
  // sending - none of which go through the change handler.
  useEffect(() => {
    adjustHeight();
  }, [text, adjustHeight]);

  const insertEmoji = useCallback((emoji: string) => {
    setText((prev) => prev + emoji);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      adjustHeight();
    });
  }, [adjustHeight]);

  /**
   * Emoji for the large editor, placed at the cursor rather than
   * appended. In the small box the cursor is almost always at the end;
   * in a long reply it is wherever the writer stopped, and appending
   * would drop the emoji at the bottom of the message instead.
   */
  const insertEmojiExpanded = useCallback((emoji: string) => {
    const el = expandedRef.current;
    if (!el) {
      setText((prev) => prev + emoji);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    setText((prev) => prev.slice(0, start) + emoji + prev.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + emoji.length;
      el.setSelectionRange(caret, caret);
    });
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || sessionExpired) return;
    setSending(true);
    try {
      onSend(trimmed, replyTo?.id);
      setText("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    } finally {
      setSending(false);
    }
  }, [text, sending, sessionExpired, onSend, replyTo?.id]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      adjustHeight();
    },
    [adjustHeight],
  );

  const openFilePicker = useCallback((type: typeof ATTACH_OPTIONS[number]['key'], accept: string) => {
    setAttachOpen(false);
    currentAttachType.current = type;
    if (fileInputRef.current) {
      fileInputRef.current.accept = accept;
      fileInputRef.current.click();
    }
  }, []);

  /** Uploads a file and resolves to its URL, reporting progress as it
   *  goes. Shared by the attach menu and the voice recorder — a
   *  recording is a file being sent like any other. */
  const uploadFile = useCallback((file: File) => {
    return new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          setUploadProgress(Math.round((event.loaded / event.total) * 100));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve(data.url);
          } catch {
            reject(new Error('Invalid server response'));
          }
        } else {
          try {
            const data = JSON.parse(xhr.responseText);
            reject(new Error(data.error || `Upload failed (${xhr.status})`));
          } catch {
            reject(new Error(`Upload failed (${xhr.status})`));
          }
        }
      };

      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.onabort = () => reject(new Error('Upload cancelled'));

      const form = new FormData();
      form.append('file', file);
      xhr.send(form);
    });
  }, []);

  const handleFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setUploading(true);
    setUploadProgress(0);
    setUploadingFilename(file.name);

    try {
      const fileUrl = await uploadFile(file);
      let mediaType: 'image' | 'document' | 'audio' | 'video' =
        currentAttachType.current === 'audio' ? 'audio' :
        currentAttachType.current === 'image' ? 'image' :
        'document';
      if (file.type.startsWith('video/')) mediaType = 'video';
      onSendMedia(fileUrl, mediaType, file.name);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      setUploadProgress(null);
      setUploadingFilename(null);
    }
  }, [onSendMedia, uploadFile]);

  /** Uploads the finished recording and sends it as a voice note. */
  const handleRecordingComplete = useCallback(
    async (file: File) => {
      setUploading(true);
      setUploadProgress(0);
      setUploadingFilename('Voice message');
      try {
        const url = await uploadFile(file);
        onSendMedia(url, 'audio', file.name);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'The voice message could not be sent.');
      } finally {
        setUploading(false);
        setUploadProgress(null);
        setUploadingFilename(null);
      }
    },
    [uploadFile, onSendMedia],
  );

  const handleRecorderError = useCallback((message: string) => {
    // The microphone diagnosis runs to several lines, and the important
    // one is usually not the first — a short toast would cut it off.
    toast.error(message, { duration: message.length > 90 ? 12000 : 5000 });
  }, []);

  const recorder = useVoiceRecorder({
    onComplete: handleRecordingComplete,
    onError: handleRecorderError,
  });

  // Open while a click waits to see whether a second one follows it.
  const clickWindowRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStartRef = useRef(0);

  useEffect(() => () => {
    if (clickWindowRef.current) clearTimeout(clickWindowRef.current);
  }, []);

  /**
   * Hold to record; double-click to lock.
   *
   * Both gestures start on the same press, so the decision can only be
   * made on release: a press held past TAP_MS was someone talking, and a
   * shorter one waits DOUBLE_CLICK_MS to see whether a second click
   * arrives. A first click that stands alone is cancelled outright
   * rather than sent — the alternative is mailing a customer half a
   * second of room noise every time somebody brushes the icon.
   */
  const handleMicPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (recorder.status === 'encoding' || uploading) return;
      // Keeps the release on this button even if the pointer slides off
      // it, which it does constantly on a touchscreen.
      e.currentTarget.setPointerCapture?.(e.pointerId);

      if (recorder.status === 'recording') {
        // Locked: the button is a stop button now, and this press ends
        // the recording and sends it.
        if (recorder.locked) {
          recorder.stop();
          return;
        }
        // Not locked, and a click is still waiting to see whether a
        // second one follows — this is that second one.
        if (clickWindowRef.current) {
          clearTimeout(clickWindowRef.current);
          clickWindowRef.current = null;
          recorder.lock();
        }
        return;
      }
      pressStartRef.current = Date.now();
      void recorder.start();
    },
    [recorder, uploading],
  );

  const handleMicPointerUp = useCallback(() => {
    if (recorder.status !== 'recording' || recorder.locked) return;
    if (Date.now() - pressStartRef.current >= TAP_MS) {
      recorder.stop();
      return;
    }
    clickWindowRef.current = setTimeout(() => {
      clickWindowRef.current = null;
      recorder.cancel();
      toast.info('Hold the mic to record — or double-click it to record hands-free.');
    }, DOUBLE_CLICK_MS);
  }, [recorder]);

  const recording = recorder.status === 'recording';
  const preparing = recorder.status === 'encoding';

  return (
    <div
      className="border-t border-slate-200 bg-white p-2.5 sm:p-3"
      style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }}
    >
      {/* Hidden file input */}
      <input autoComplete="off"
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileSelected}
      />

      {replyTo && (
        <div className="mb-2">
          <ReplyQuote
            authorLabel={replyTo.authorLabel}
            preview={replyTo.preview}
            onDismiss={onClearReply}
          />
        </div>
      )}

      {sessionExpired && channel !== 'instagram' && channel !== 'facebook' && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-500/10 px-3 py-2">
          <p className="text-xs text-amber-400">
            24-hour session expired. Use a template to re-engage.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-amber-400 hover:text-amber-300"
            onClick={onOpenTemplates}
          >
            <LayoutTemplate className="mr-1 h-3 w-3" />
            Templates
          </Button>
        </div>
      )}

      {uploading && (
        <div className="mb-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="truncate text-xs text-slate-500">
              {uploadingFilename ? `Uploading ${uploadingFilename}…` : 'Uploading…'}
            </span>
            <span className="ml-2 shrink-0 text-xs font-medium text-primary">
              {uploadProgress ?? 0}%
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-primary transition-all duration-150"
              style={{ width: `${uploadProgress ?? 0}%` }}
            />
          </div>
        </div>
      )}

      {/* The message itself, full width. An expand control opens the same
          value in a large editor — a long reply written through three
          visible rows is edited blind. */}
      <div className="flex items-end gap-2">
        {recording || preparing ? (
          /* The message box gives way while recording. Nothing else on
             screen can tell you whether the microphone is live, and a
             small red dot beside an unchanged composer is not enough for
             something that is listening to the room. */
          <div className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl bg-rose-50 px-3.5 ring-1 ring-rose-500/20">
            {preparing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-rose-500" />
                <span className="text-[13px] font-medium text-rose-900">Preparing your message…</span>
              </>
            ) : (
              <>
                <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
                </span>
                <span className="shrink-0 text-[14px] font-semibold tabular-nums text-rose-900">
                  {formatElapsed(recorder.elapsedMs)}
                </span>
                {recorder.locked ? (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10.5px] font-semibold text-rose-700">
                    <Lock className="h-3 w-3" />
                    Hands-free
                  </span>
                ) : null}
                <span className="min-w-0 truncate text-[11.5px] text-rose-700/80">
                  {recorder.locked ? 'Recording — press stop when you are done' : 'Release to send · double-click to lock'}
                </span>
                <button
                  type="button"
                  onClick={recorder.cancel}
                  aria-label="Discard this recording"
                  title="Discard this recording"
                  className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-lg text-rose-500 transition-colors hover:bg-rose-100 hover:text-rose-700"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        ) : (
        <div className="relative min-w-0 flex-1">
        <textarea autoComplete="off"
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            readOnly
              ? "Read-only — viewers can browse but not reply"
              : sessionExpired
                ? "Session expired - use a template"
                : "Type a message..."
          }
          disabled={sessionExpired || readOnly}
          rows={1}
          title={readOnly ? "Read-only — your role can't send messages" : undefined}
          className={cn(
            "w-full resize-none rounded-xl border border-slate-200 bg-slate-100 py-2.5 pl-4 pr-11 text-sm text-slate-800 placeholder-slate-500 outline-none transition-colors focus:border-primary/50",
            (sessionExpired || readOnly) && "cursor-not-allowed opacity-50",
          )}
        />
        <button
          type="button"
          onClick={() => setExpanded(true)}
          disabled={readOnly}
          aria-label="Open a larger editor"
          title="Open a larger editor"
          className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-md text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-700 disabled:opacity-40"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        </div>
        )}

        {/* Hold to record, double-click to lock. It sits beside Send
            because it is the other way of answering, not a tool. While it
            is live it becomes the stop button, so the control that
            started the recording is the one that ends it. */}
        <button
          type="button"
          onPointerDown={handleMicPointerDown}
          onPointerUp={handleMicPointerUp}
          onPointerCancel={handleMicPointerUp}
          onContextMenu={(e) => e.preventDefault()}
          disabled={readOnly || sessionExpired || uploading || preparing}
          aria-label={recording ? 'Stop recording and send' : 'Record a voice message'}
          title={recording ? 'Stop and send' : 'Hold to record · double-click to record hands-free'}
          className={cn(
            "grid h-10 w-10 shrink-0 touch-none select-none place-items-center rounded-xl transition-colors disabled:opacity-40",
            recording
              ? "bg-rose-500 text-white hover:bg-rose-600"
              : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
          )}
        >
          {recording ? <Square className="h-3.5 w-3.5 fill-current" /> : <Mic className="h-4 w-4" />}
        </button>

        {/* Beside the message, not at the end of the tool row below: this
            is the one control that acts on what was typed. Bottom-aligned
            so it stays level with the last line as the box grows. */}
        <GatedButton
          size="sm"
          canAct={!readOnly}
          gateReason="send messages"
          disabled={!text.trim() || sessionExpired || sending || recording || preparing}
          onClick={handleSend}
          className="h-10 w-10 shrink-0 bg-primary p-0 hover:bg-primary/90 disabled:opacity-40"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </GatedButton>
      </div>

      {/* Actions, spread across the full width: compose, send-something,
          AI. No scroll container here - an absolutely positioned menu
          inside one is clipped by it, which is what was cutting off the
          attach and translate popups. Spread, there is nothing to scroll
          anyway. */}
      <div className="mt-2 flex items-center justify-between gap-0.5">
          <EmojiPickerPopover onSelect={insertEmoji} disabled={readOnly} />

          <ScheduleMenuButton conversationId={conversationId} disabled={readOnly} />

          {/* Attach keeps only what it is for: device files and the file
              manager. The four WhatsApp actions that used to live in here
              are their own icons now — they are things you send, not
              things you attach. */}
          <div className="relative shrink-0">
            <GatedButton
              variant="ghost"
              size="sm"
              canAct={!readOnly}
              gateReason="send messages"
              title="Attach a file"
              className="h-9 w-9 p-0 text-slate-500 hover:text-slate-800"
              onClick={() => setAttachOpen((o) => !o)}
              disabled={uploading}
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
            </GatedButton>

            {attachOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setAttachOpen(false)} />
                <div className="absolute bottom-11 left-0 z-20 w-56 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    From Device
                  </div>
                  {ATTACH_OPTIONS.map(({ key, label, icon: Icon, color, accept }) => (
                    <button
                      key={key}
                      type="button"
                      disabled={sessionExpired}
                      onClick={() => openFilePicker(key, accept)}
                      title={sessionExpired ? "Session expired — send a template to re-engage first" : undefined}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-slate-800 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", sessionExpired ? "text-slate-300" : color)} />
                      {label}
                    </button>
                  ))}
                  <div className="mx-3 my-1 border-t border-slate-100" />
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    From File Manager
                  </div>
                  <button
                    type="button"
                    disabled={sessionExpired}
                    onClick={() => { setAttachOpen(false); setFilePickerOpen(true); }}
                    title={sessionExpired ? "Session expired — send a template to re-engage first" : undefined}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-slate-800 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                  >
                    <FolderOpen className={cn("h-4 w-4 shrink-0", sessionExpired ? "text-slate-300" : "text-indigo-500")} />
                    Browse Files
                  </button>
                </div>
              </>
            )}
          </div>

          {channel !== 'instagram' && channel !== 'facebook' && (
            <>
              {/* Templates stay reachable while the session is expired —
                  they are the only way to reopen it. */}
              <ComposerAction
                label="Message template"
                onClick={onOpenTemplates}
                disabled={readOnly}
                tint="text-amber-500"
              >
                <LayoutTemplate className="h-4 w-4" />
              </ComposerAction>

              <ComposerAction
                label="Send OTP"
                onClick={onSendOtp}
                disabled={readOnly}
                tint="text-fuchsia-500"
              >
                <KeyRound className="h-4 w-4" />
              </ComposerAction>

              <ComposerAction
                label={sessionExpired ? "Send catalog — session expired, send a template first" : "Send catalog"}
                onClick={onOpenCatalog}
                disabled={readOnly || sessionExpired}
                tint="text-sky-500"
              >
                <ShoppingBag className="h-4 w-4" />
              </ComposerAction>

              <ComposerAction
                label="Request payment"
                onClick={onRequestPayment}
                disabled={readOnly}
                tint="text-emerald-600"
              >
                <IndianRupee className="h-4 w-4" />
              </ComposerAction>
            </>
          )}

          <ComposerAction
            label="Draft a reply from this conversation — you approve it before it sends"
            onClick={() => void handleDraftReply()}
            disabled={drafting || readOnly || sessionExpired}
            tint="text-indigo-600"
            active
          >
            {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          </ComposerAction>

          <div className="relative shrink-0" ref={translateRef}>
            <ComposerAction
              label="Translate your reply"
              onClick={() => setTranslateOpen((o) => !o)}
              disabled={!text.trim() || translating || readOnly}
              tint="text-slate-500"
              expanded={translateOpen}
            >
              {translating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
            </ComposerAction>

            {translateOpen && (
              <div
                role="menu"
                className="absolute bottom-11 right-0 z-50 w-60 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,.06),0_12px_32px_-8px_rgba(15,23,42,.22)]"
              >
                <p className="px-3 pt-2.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Translate your reply into
                </p>
                <ul className="max-h-64 overflow-y-auto p-1.5">
                  {translateTargets.map((language, index) => (
                    <li key={language}>
                      <div className="group flex items-center gap-1 rounded-lg px-1 hover:bg-slate-50">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => void handleTranslateDraft(language, false)}
                          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-2 pl-2 text-left text-[13px] text-slate-700"
                        >
                          <span className="min-w-0 flex-1 truncate">{language}</span>
                          {index === 0 && contactDetectedLanguage && (
                            <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[9.5px] font-semibold text-emerald-700">
                              Theirs
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => void handleTranslateDraft(language, true)}
                          title={`${language}, written in English letters`}
                          className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-slate-400 opacity-0 transition-opacity hover:bg-indigo-50 hover:text-indigo-600 focus:opacity-100 group-hover:opacity-100"
                        >
                          Aa
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="border-t border-slate-100 px-3 py-2 text-[10.5px] leading-relaxed text-slate-500">
                  <span className="font-semibold text-slate-600">Aa</span> gives the same sentence in English
                  letters, for a language you speak but do not read.
                </p>
              </div>
            )}
          </div>
      </div>

      {/* Large editor. Edits the same state directly rather than a draft
          copy — closing it is not a cancel, and a reply half-written here
          should still be there in the small box. */}
      {expanded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="flex h-full max-h-[80vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between rounded-t-2xl border-b border-slate-100 px-4 py-3">
              <p className="text-[14px] font-semibold text-slate-900">Write your reply</p>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                aria-label="Close the larger editor"
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <Minimize2 className="h-4 w-4" />
              </button>
            </div>
            <textarea
              autoComplete="off"
              autoFocus
              ref={expandedRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a message..."
              className="min-h-0 flex-1 resize-none px-5 py-4 text-[14px] leading-relaxed text-slate-800 outline-none"
            />
            <div className="flex items-center justify-between gap-3 rounded-b-2xl border-t border-slate-100 bg-slate-50/70 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                {/* The small box has emoji; the long message is written
                    here, so this needs it more, not less. */}
                <EmojiPickerPopover onSelect={insertEmojiExpanded} disabled={readOnly} />
                <span className="min-w-0 truncate text-[11.5px] text-slate-500">
                  {text.trim().length} characters · closing keeps what you have written
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-white"
                >
                  Done
                </button>
                <GatedButton
                  size="sm"
                  canAct={!readOnly}
                  gateReason="send messages"
                  disabled={!text.trim() || sessionExpired || sending}
                  onClick={() => { setExpanded(false); handleSend(); }}
                  className="h-8 bg-primary px-3 text-[13px] hover:bg-primary/90 disabled:opacity-40"
                >
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  Send
                </GatedButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {draftWarnings.length > 0 && (
        <div className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800 ring-1 ring-amber-500/20">
          <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            {draftWarnings.map((w) => (
              <span key={w} className="block">{w}</span>
            ))}
          </span>
          <button
            type="button"
            onClick={() => setDraftWarnings([])}
            aria-label="Dismiss"
            className="shrink-0 rounded p-0.5 hover:bg-amber-100"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <p className="mt-1 pl-[46px] text-[10px] text-slate-600 hidden sm:block">
        Type &apos;/&apos; for quick replies · Shift+Enter for new line
      </p>

      <FileManagerPicker
        open={filePickerOpen}
        onClose={() => setFilePickerOpen(false)}
        onSelect={(file) => {
          const mediaType: 'image' | 'document' | 'audio' | 'video' =
            file.file_category === 'image' ? 'image' :
            file.file_category === 'video' ? 'video' :
            file.file_category === 'audio' ? 'audio' : 'document';
          onSendMedia(file.url, mediaType, file.original_name);
        }}
      />
    </div>
  );
}

/**
 * One composer action.
 *
 * A shared component rather than nine copies of the same class string:
 * these sit in a row and have to match each other exactly — same size,
 * same hover, same disabled treatment — or the row reads as a jumble.
 * The tint is the only thing that varies, which is what makes each one
 * findable at a glance.
 */
function ComposerAction({
  children, label, onClick, disabled, tint, active, expanded,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tint: string;
  /** Draws attention to it — used for the AI draft. */
  active?: boolean;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-expanded={expanded}
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "bg-indigo-50/70 ring-1 ring-indigo-200 hover:bg-indigo-100"
          : "hover:bg-slate-100",
        disabled ? "text-slate-300" : tint,
      )}
    >
      {children}
    </button>
  );
}
