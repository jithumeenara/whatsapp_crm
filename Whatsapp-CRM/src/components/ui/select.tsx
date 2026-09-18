"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"

import { cn } from "@/lib/utils"
import { ChevronDownIcon, CheckIcon, ChevronUpIcon, SearchIcon, XIcon } from "lucide-react"

/**
 * Select, with the selected item showing its label rather than its value.
 *
 * Base UI differs from Radix here in a way that is easy to miss and ugly
 * when it lands: `Select.Value` renders the raw value unless the root is
 * given an `items` map. Every picker in this app that shows a name and
 * stores an id was therefore displaying the id — a table picker reading
 * "a1c1263e-3a4e-40cf-90a4-e9e3c2dc61a1" where it meant "Training", an
 * agent picker showing a user id, a voice picker showing a slug. Each
 * looked like a separate bug and each would have been fixed separately
 * and forgotten again on the next Select somebody wrote.
 *
 * So the map is built here, from the items actually rendered. Callers
 * write the ordinary `<SelectItem value={id}>{name}</SelectItem>` they
 * already write, and the trigger shows the name. An explicit `items`
 * prop still wins, for a caller who wants to say it themselves.
 */
function collectItems(node: React.ReactNode, into: Record<string, React.ReactNode>): void {
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return
    const props = child.props as { value?: unknown; children?: React.ReactNode }
    if (child.type === SelectItem && props.value !== undefined && props.value !== null) {
      into[String(props.value)] = props.children
      return
    }
    if (props.children) collectItems(props.children, into)
  })
}

function Select<Value, Multiple extends boolean | undefined = false>({
  children,
  items,
  ...props
}: SelectPrimitive.Root.Props<Value, Multiple>) {
  const derived = React.useMemo(() => {
    if (items) return items
    const map: Record<string, React.ReactNode> = {}
    collectItems(children, map)
    // Nothing to map means nothing to gain — handing Base UI an empty
    // record would make it treat every value as unknown.
    return Object.keys(map).length > 0 ? map : undefined
  }, [children, items])

  return (
    <SelectPrimitive.Root items={derived} {...(props as SelectPrimitive.Root.Props<Value, Multiple>)}>
      {children}
    </SelectPrimitive.Root>
  )
}

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1", className)}
      {...props}
    />
  )
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("flex flex-1 text-left", className)}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
        }
      />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  // Left edge to left edge, the way every dropdown on the web opens.
  align = "start",
  alignOffset = 0,
  // Base UI defaults this on, which positions the popup so the *selected
  // item* lands on top of the trigger — the old desktop behaviour. It
  // covers the field you just clicked, so you cannot read the label you
  // are choosing for, and on a long list it drifts halfway up the page.
  // Dropping below the trigger is what this app's other menus do and
  // what anyone expects.
  alignItemWithTrigger = false,
  searchable,
  searchPlaceholder = "Search\u2026",
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  > & {
    /** Force the search box on or off. Left unset it appears once the
     *  list is long enough to be worth filtering. */
    searchable?: boolean
    searchPlaceholder?: string
  }) {
  const [query, setQuery] = React.useState("")

  // Whether to offer search at all.
  //
  // A field type list runs to twenty-five entries and a district list to
  // fourteen; scrolling those to find one word is the slowest part of
  // building a table. Below the threshold a search box is noise — three
  // options are read faster than they are typed.
  const total = React.useMemo(() => countItems(children), [children])
  const showSearch = searchable ?? total > 8

  // Cleared on close so reopening never shows yesterday's filter.
  const filtered = React.useMemo(
    () => (showSearch && query.trim() ? filterItems(children, query.trim().toLowerCase()) : children),
    [children, query, showSearch],
  )
  const nothingMatched = showSearch && query.trim() !== "" && countItems(filtered) === 0

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger}
          className={cn("relative isolate z-50 max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-xl bg-popover p-1.5 text-popover-foreground shadow-[0_4px_12px_rgba(15,23,42,0.06),0_16px_40px_-12px_rgba(15,23,42,0.25)] ring-1 ring-foreground/10 duration-150 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-1 data-[side=inline-end]:slide-in-from-left-1 data-[side=inline-start]:slide-in-from-right-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 dark:shadow-[0_4px_12px_rgba(0,0,0,0.3),0_16px_40px_-12px_rgba(0,0,0,0.6)]", className )}
          {...props}
        >
          {showSearch && (
            // Deliberately not a real <input> inside the list: Base UI's
            // Select owns keyboard navigation, and an input that steals
            // arrow keys would break selecting with the keyboard. This
            // only takes printable characters and backspace, and lets
            // everything else through to the list underneath.
            <div className="sticky top-0 z-10 -mx-1.5 -mt-1.5 mb-1 border-b border-border/60 bg-popover px-3 py-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <SearchIcon className="size-3.5 shrink-0" />
                <span className="flex-1 truncate text-sm text-foreground">
                  {query || <span className="text-muted-foreground">{searchPlaceholder}</span>}
                </span>
                {query && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onPointerDown={(e) => {
                      e.preventDefault()
                      setQuery("")
                    }}
                    className="rounded-md p-0.5 transition-colors hover:text-foreground"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}
          <SelectScrollUpButton />
          <SelectPrimitive.List
            onKeyDown={(e) => {
              if (!showSearch) return
              if (e.key === "Backspace") {
                setQuery((q) => q.slice(0, -1))
                return
              }
              // One printable character, and no modifier — so Ctrl+A and
              // the arrow keys still belong to the list.
              if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                setQuery((q) => q + e.key)
              }
            }}
          >
            {filtered}
          </SelectPrimitive.List>
          {nothingMatched && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing matches &ldquo;{query}&rdquo;
            </p>
          )}
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

/** How many selectable items a subtree holds. */
function countItems(node: React.ReactNode): number {
  let n = 0
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return
    if (child.type === SelectItem) {
      n += 1
      return
    }
    const props = child.props as { children?: React.ReactNode }
    if (props.children) n += countItems(props.children)
  })
  return n
}

/** The plain text of a node, for matching against what was typed. */
function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(" ")
  if (React.isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children)
  return ""
}

/**
 * The same tree with non-matching items removed.
 *
 * Group wrappers survive only if something inside them did, so filtering
 * never leaves a heading standing over an empty space.
 */
function filterItems(node: React.ReactNode, query: string): React.ReactNode {
  return React.Children.map(node, (child) => {
    if (!React.isValidElement(child)) return child
    if (child.type === SelectItem) {
      const props = child.props as { children?: React.ReactNode }
      return textOf(props.children).toLowerCase().includes(query) ? child : null
    }
    const props = child.props as { children?: React.ReactNode }
    if (!props.children) return child
    const inner = filterItems(props.children, query)
    return countItems(inner) > 0 ? React.cloneElement(child, {}, inner) : null
  })
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-2 pr-8 pl-2.5 text-sm outline-hidden transition-colors duration-100 select-none focus:bg-accent focus:text-accent-foreground data-selected:font-medium not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex flex-1 shrink-0 gap-2 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon className="pointer-events-none" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "top-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronUpIcon
      />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronDownIcon
      />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
