import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      // Default every text field in the app to no browser/extension
      // autofill — a caller that genuinely wants it (e.g. a login
      // field) can still override by passing its own autoComplete
      // prop, since {...props} below wins if it's set. Found live
      // (Sept 2026): the Settings search box was getting silently
      // autofilled with the signed-in account's own email.
      autoComplete="off"
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-lg border-0 bg-transparent px-3 py-1 text-base shadow-[0_1px_2px_rgba(15,23,42,0.03)] ring-1 ring-input transition-[box-shadow,background] duration-150 outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:ring-ring/35 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:shadow-[0_0_0_4px_rgba(91,108,249,0.10)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
