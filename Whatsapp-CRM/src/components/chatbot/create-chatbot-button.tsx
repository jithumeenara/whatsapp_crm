"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CreateChatbotButtonProps {
  templateSlug?: string;
  templateName?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
}

export function CreateChatbotButton({
  templateSlug,
  templateName,
  variant = "default",
  size = "sm",
}: CreateChatbotButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(templateName ? `${templateName} copy` : "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/chatbot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          ...(templateSlug ? { template_slug: templateSlug } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to create");
      }
      const data = (await res.json()) as { chatbot: { id: string } };
      router.push(`/chatbot/${data.chatbot.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  if (templateSlug) {
    return (
      <>
        <Button
          variant={variant}
          size={size}
          className="w-full gap-1.5 text-xs"
          onClick={() => setOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Use template
        </Button>
        <NameDialog
          open={open}
          onOpenChange={setOpen}
          name={name}
          setName={setName}
          loading={loading}
          error={error}
          onCreate={create}
          title={`Create from "${templateName}"`}
          description="Give your chatbot a name to get started."
        />
      </>
    );
  }

  return (
    <>
      <Button variant={variant} size={size} className="gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        New chatbot
      </Button>
      <NameDialog
        open={open}
        onOpenChange={setOpen}
        name={name}
        setName={setName}
        loading={loading}
        error={error}
        onCreate={create}
        title="Create chatbot"
        description="Give your chatbot a name. You can change it later."
      />
    </>
  );
}

function NameDialog({
  open,
  onOpenChange,
  name,
  setName,
  loading,
  error,
  onCreate,
  title,
  description,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  name: string;
  setName: (v: string) => void;
  loading: boolean;
  error: string;
  onCreate: () => void;
  title: string;
  description: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="bot-name" className="text-xs">Name</Label>
          <Input
            id="bot-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My chatbot…"
            className="h-9"
            onKeyDown={(e) => e.key === "Enter" && !loading && onCreate()}
            autoFocus
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button size="sm" onClick={onCreate} disabled={loading || !name.trim()}>
            {loading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
