"use client"

/**
 * Drag and drop reordering, by a handle.
 *
 * Pointer events rather than the HTML5 drag API: those also work with a
 * finger on a phone, where native drag does not. The row follows the
 * pointer through the list as it moves; letting go saves the new order.
 * With the handle focused, ↑ and ↓ move the row too, so the order can
 * be changed without a mouse.
 */

import { useId, useState } from "react"
import { GripVertical } from "lucide-react"

export interface HandleProps {
  onPointerDown(e: React.PointerEvent<HTMLElement>): void
  onKeyDown(e: React.KeyboardEvent<HTMLElement>): void
  "aria-label": string
  title: string
  style: React.CSSProperties
}

export function SortableList<T>({
  items,
  getKey,
  getLabel,
  onReorder,
  renderItem,
  className,
}: {
  items: T[]
  getKey(item: T): string
  getLabel(item: T): string
  onReorder(keys: string[]): void
  renderItem(item: T, handle: HandleProps, state: { dragging: boolean }): React.ReactNode
  className?: string
}) {
  const [draft, setDraft] = useState<string[] | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  // Found from the event, not a ref: the handlers below only ever run
  // on a pointer or key press, and this keeps render free of refs.
  const listId = useId()
  const rootOf = (el: Element | null) => el?.closest<HTMLElement>("[data-sortable-root]") ?? null

  const keys = items.map(getKey)
  const order = draft ?? keys
  const byKey = new Map(items.map((i) => [getKey(i), i]))
  const shown = order.map((k) => byKey.get(k)).filter((i): i is T => i !== undefined)

  function targetIndex(root: HTMLElement | null, clientY: number, key: string, current: string[]): number {
    const rows = Array.from(root?.querySelectorAll<HTMLElement>(":scope > [data-sort-key]") ?? [])
    let index = 0
    for (const row of rows) {
      if (row.dataset.sortKey === key) continue
      const r = row.getBoundingClientRect()
      if (clientY > r.top + r.height / 2) index++
    }
    return Math.min(index, current.length - 1)
  }

  function start(key: string, e: React.PointerEvent<HTMLElement>) {
    if (e.button !== 0 && e.pointerType === "mouse") return
    e.preventDefault()
    const handle = e.currentTarget
    const root = rootOf(handle)
    handle.setPointerCapture(e.pointerId)
    let current = [...keys]
    setDragging(key)
    setDraft(current)

    const move = (ev: PointerEvent) => {
      const to = targetIndex(root, ev.clientY, key, current)
      const from = current.indexOf(key)
      if (to !== from) {
        const next = current.filter((k) => k !== key)
        next.splice(to, 0, key)
        current = next
        setDraft(next)
      }
    }
    const end = () => {
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", end)
      handle.removeEventListener("pointercancel", end)
      setDragging(null)
      setDraft(null)
      if (current.some((k, i) => k !== keys[i])) onReorder(current)
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", end)
    handle.addEventListener("pointercancel", end)
  }

  function nudge(from_el: HTMLElement, key: string, by: -1 | 1) {
    const root = rootOf(from_el)
    const from = keys.indexOf(key)
    const to = from + by
    if (from < 0 || to < 0 || to >= keys.length) return
    const next = [...keys]
    ;[next[from], next[to]] = [next[to], next[from]]
    onReorder(next)
    // Keep focus on the handle as the row moves.
    requestAnimationFrame(() => {
      root?.querySelector<HTMLElement>(`[data-sort-key="${CSS.escape(key)}"] [data-sort-handle]`)?.focus()
    })
  }

  return (
    <div data-sortable-root={listId} className={className}>
      {shown.map((item) => {
        const key = getKey(item)
        const handle: HandleProps = {
          onPointerDown: (e) => start(key, e),
          onKeyDown: (e) => {
            if (e.key === "ArrowUp") { e.preventDefault(); nudge(e.currentTarget, key, -1) }
            if (e.key === "ArrowDown") { e.preventDefault(); nudge(e.currentTarget, key, 1) }
          },
          "aria-label": `Move “${getLabel(item)}” — drag, or use the arrow keys`,
          title: "Drag to reorder",
          style: { touchAction: "none", cursor: dragging === key ? "grabbing" : "grab" },
        }
        return (
          <div
            key={key}
            data-sort-key={key}
            className={dragging === key ? "relative z-10 rounded-xl bg-white opacity-95 shadow-lg ring-2 ring-primary/40" : undefined}
          >
            {renderItem(item, handle, { dragging: dragging === key })}
          </div>
        )
      })}
    </div>
  )
}

/** The grip a row is dragged by. */
export function DragHandle(props: HandleProps & { className?: string }) {
  const { className, ...rest } = props
  return (
    <button
      type="button"
      data-sort-handle=""
      {...rest}
      className={`grid h-7 w-6 shrink-0 place-items-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${className ?? ""}`}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  )
}
