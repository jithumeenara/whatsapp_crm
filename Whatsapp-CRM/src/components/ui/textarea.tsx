import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea autoComplete="off"
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-xl border-0 bg-transparent px-3 py-2.5 text-base shadow-[0_1px_2px_rgba(15,23,42,0.03)] ring-1 ring-input transition-[box-shadow,background] duration-150 outline-none placeholder:text-muted-foreground hover:ring-ring/35 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:shadow-[0_0_0_4px_rgba(91,108,249,0.10)] disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
