"use client";

import { useState, useRef, useCallback, KeyboardEvent } from "react";
import { Send, LayoutTemplate, Paperclip, FileText, Image, Music, X, Loader2, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import { useCan } from "@/hooks/use-can";
import { cn } from "@/lib/utils";
import { ReplyQuote } from "./reply-quote";
import { toast } from "sonner";
import { FileManagerPicker } from "./file-manager-picker";

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
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
}

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
  replyTo,
  onClearReply,
}: MessageComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadingFilename, setUploadingFilename] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentAttachType = useRef<typeof ATTACH_OPTIONS[number]['key']>('document');

  const canSend = useCan("send-messages");
  const readOnly = !canSend;

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
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

  const handleFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setUploading(true);
    setUploadProgress(0);
    setUploadingFilename(file.name);

    try {
      const fileUrl = await new Promise<string>((resolve, reject) => {
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
  }, [onSendMedia]);

  return (
    <div
      className="border-t border-slate-200 bg-white p-2.5 sm:p-3"
      style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }}
    >
      {/* Hidden file input */}
      <input
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

      <div className="flex items-end gap-1.5 sm:gap-2">
        {/* Attachment button + popover — hosts file uploads and (WhatsApp only) message templates */}
        <div className="relative shrink-0">
          <GatedButton
            variant="ghost"
            size="sm"
            canAct={!readOnly}
            gateReason="send messages"
            title="Attach"
            className="h-9 w-9 p-0 text-slate-500 hover:text-slate-800"
            onClick={() => setAttachOpen((o) => !o)}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Paperclip className="h-4 w-4" />
            )}
          </GatedButton>

          {attachOpen && (
            <>
              {/* Backdrop */}
              <div className="fixed inset-0 z-10" onClick={() => setAttachOpen(false)} />
              {/* Menu */}
              <div className="absolute bottom-11 left-0 z-20 w-56 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                {/* Message template — always available, WhatsApp only. This is the
                    one way to message a contact once the 24h session has expired,
                    so it must stay reachable even while everything below is gated. */}
                {channel !== 'instagram' && channel !== 'facebook' && (
                  <>
                    <button
                      type="button"
                      onClick={() => { setAttachOpen(false); onOpenTemplates(); }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-slate-800 hover:bg-slate-100 transition-colors"
                    >
                      <LayoutTemplate className="h-4 w-4 shrink-0 text-amber-500" />
                      Message Template
                    </button>
                    <div className="mx-3 my-1 border-t border-slate-100" />
                  </>
                )}
                {/* Device / File Manager options — need an open 24h session, same
                    restriction as free text, so these are disabled once it expires. */}
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
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-slate-800 hover:bg-slate-100 transition-colors disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                  >
                    <Icon className={cn("h-4 w-4 shrink-0", sessionExpired ? "text-slate-300" : color)} />
                    {label}
                  </button>
                ))}
                {/* File Manager option */}
                <div className="mx-3 my-1 border-t border-slate-100" />
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  From File Manager
                </div>
                <button
                  type="button"
                  disabled={sessionExpired}
                  onClick={() => { setAttachOpen(false); setFilePickerOpen(true); }}
                  title={sessionExpired ? "Session expired — send a template to re-engage first" : undefined}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-slate-800 hover:bg-slate-100 transition-colors disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                >
                  <FolderOpen className={cn("h-4 w-4 shrink-0", sessionExpired ? "text-slate-300" : "text-indigo-500")} />
                  Browse Files
                </button>
              </div>
            </>
          )}
        </div>

        <textarea
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
            "flex-1 resize-none rounded-xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm text-slate-800 placeholder-slate-500 outline-none transition-colors focus:border-primary/50",
            (sessionExpired || readOnly) && "cursor-not-allowed opacity-50",
          )}
        />

        <GatedButton
          size="sm"
          canAct={!readOnly}
          gateReason="send messages"
          disabled={!text.trim() || sessionExpired || sending}
          onClick={handleSend}
          className="h-9 w-9 shrink-0 bg-primary p-0 hover:bg-primary/90 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </GatedButton>
      </div>

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
