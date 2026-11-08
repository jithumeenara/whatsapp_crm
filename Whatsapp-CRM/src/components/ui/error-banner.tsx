import { AlertCircle } from "lucide-react"

import { cn } from "@/lib/utils"

interface ErrorBannerProps {
  message: string
  /** Shows a Retry button when given. */
  onRetry?: () => void
  retryLabel?: string
  /** "error" is soft rose, "warning" is soft amber. */
  tone?: "error" | "warning"
  className?: string
}

function ErrorBanner({ message, onRetry, retryLabel = "Retry", tone = "error", className }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      data-slot="error-banner"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 text-[12.5px]",
        tone === "error" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-amber-200 bg-amber-50 text-amber-800",
        className
      )}
    >
      <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 break-words">{message}</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-md px-2 py-1 text-[12px] font-semibold underline underline-offset-2 hover:bg-black/5"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  )
}

export { ErrorBanner }
