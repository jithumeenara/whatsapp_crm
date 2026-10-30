import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { NextResponse } from "next/server"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

export function badId(param = 'id'): NextResponse {
  return NextResponse.json({ error: `Invalid ${param}` }, { status: 400 })
}

const RASTER_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i

/**
 * A link or media address that came from data (a record, a message, a
 * profile) made safe to put in `href` / `src`: an http(s) address, a path
 * on this app, or a blob: URL this page made. Anything else — javascript:,
 * vbscript:, data:text/html, protocol-relative "//host" — gives undefined,
 * so the element simply has no link. `dataImage` also lets through an
 * inline PNG/JPEG/GIF/WebP (a drawn signature); never SVG, which can
 * carry script.
 */
export function safeHref(value: unknown, opts: { dataImage?: boolean } = {}): string | undefined {
  if (typeof value !== "string") return undefined
  const v = value.trim()
  if (!v) return undefined
  if (v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\")) return v
  if (opts.dataImage && RASTER_DATA_IMAGE.test(v)) return v
  try {
    const url = new URL(v)
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "blob:" ? v : undefined
  } catch {
    return undefined
  }
}
