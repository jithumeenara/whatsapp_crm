/**
 * Shared fetch + parse utilities for external API integrations.
 * Used by both the sync engine and the test endpoint.
 */

// ── Auth header builder ────────────────────────────────────────

export function buildFetchHeaders(
  auth_type: string,
  auth_config?: Record<string, string> | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/fhir+json, application/json",
  }
  if (!auth_config || auth_type === "none") return headers

  if (auth_type === "api_key" && auth_config.header && auth_config.value) {
    headers[auth_config.header] = auth_config.value
  } else if (auth_type === "bearer" && auth_config.token) {
    headers["Authorization"] = `Bearer ${auth_config.token}`
  } else if (auth_type === "basic" && auth_config.username && auth_config.password) {
    headers["Authorization"] = `Basic ${Buffer.from(
      `${auth_config.username}:${auth_config.password}`,
    ).toString("base64")}`
  }
  return headers
}

// ── FHIR flatteners ────────────────────────────────────────────

function flattenFhirPatient(r: Record<string, unknown>): Record<string, string> {
  const flat: Record<string, string> = { fhir_id: String(r.id ?? "") }
  const names = r.name as Array<{ family?: string; given?: string[] }> | undefined
  if (names?.length) {
    const n = names[0]
    flat.name = [n.given?.join(" "), n.family].filter(Boolean).join(" ").trim()
  }
  const telecoms = r.telecom as Array<{ system?: string; value?: string }> | undefined
  if (telecoms) {
    for (const t of telecoms) {
      if (t.system === "phone" && t.value) flat.phone = t.value
      if (t.system === "email" && t.value) flat.email = t.value
    }
  }
  if (r.birthDate) flat.birth_date = String(r.birthDate)
  if (r.gender) flat.gender = String(r.gender)
  const addresses = r.address as Array<{ city?: string; state?: string; country?: string }> | undefined
  if (addresses?.length) {
    const a = addresses[0]
    if (a.city) flat.city = a.city
    if (a.state) flat.state = a.state
    if (a.country) flat.country = a.country
  }
  return flat
}

function flattenFhirAppointment(r: Record<string, unknown>): Record<string, string> {
  const flat: Record<string, string> = { fhir_id: String(r.id ?? "") }
  if (r.status) flat.status = String(r.status)
  if (r.start) flat.start_time = String(r.start)
  if (r.end) flat.end_time = String(r.end)
  if (r.description) flat.description = String(r.description)
  const participants = r.participant as Array<{ actor?: { reference?: string; display?: string } }> | undefined
  if (participants) {
    for (const p of participants) {
      const ref = p.actor?.reference ?? ""
      if (ref.includes("Patient/")) flat.patient = p.actor?.display ?? ref.split("/").pop() ?? ""
      if (ref.includes("Practitioner/")) flat.doctor = p.actor?.display ?? ref.split("/").pop() ?? ""
    }
  }
  return flat
}

export function flattenFhirResource(resourceType: string, r: Record<string, unknown>): Record<string, string> {
  if (resourceType === "Patient") return flattenFhirPatient(r)
  if (resourceType === "Appointment") return flattenFhirAppointment(r)
  const flat: Record<string, string> = { fhir_id: String(r.id ?? "") }
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      flat[k] = String(v)
    }
  }
  return flat
}

// ── Plain REST flattener ───────────────────────────────────────

const DATE_KEY_PARTS = ["_at", "date", "time", "created", "updated", "captured"]
const UNIX_SEC_RE = /^\d{10}$/
const UNIX_MS_RE = /^\d{13}$/

function toStoredValue(key: string, value: unknown): string {
  const str = String(value)
  const isDateKey = DATE_KEY_PARTS.some((d) => key.toLowerCase().includes(d))
  if (isDateKey) {
    if (UNIX_SEC_RE.test(str)) return new Date(parseInt(str) * 1000).toISOString()
    if (UNIX_MS_RE.test(str)) return new Date(parseInt(str)).toISOString()
  }
  return str
}

export function flattenPlain(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const flat: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}_${k}` : k
    if (v === null || v === undefined) continue
    if (typeof v === "object" && !Array.isArray(v)) {
      Object.assign(flat, flattenPlain(v as Record<string, unknown>, key))
    } else if (!Array.isArray(v)) {
      flat[key] = toStoredValue(key, v)
    }
  }
  return flat
}

// ── Type detection ─────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/
const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL_RE = /^https?:\/\/.+/
const NUM_RE = /^-?\d+(\.\d+)?$/

// Unix epoch timestamps from payment APIs (10-digit seconds or 13-digit ms)
const UNIX_TS_RE = /^\d{10}(\d{3})?$/

export function detectType(key: string, value: string): string {
  const k = key.toLowerCase()
  // Phone: explicit phone keys OR Razorpay-style "contact" key with phone value
  if (k.includes("phone") || k.includes("mobile") || k.includes("tel") || k === "contact") {
    if (PHONE_RE.test(value)) return "phone"
  }
  if (k.includes("email")) return "email"
  // Date: ISO strings or Unix epoch timestamps in date-named fields
  if (k.includes("date") || k.includes("_at") || k.includes("time")) {
    if (DATE_RE.test(value)) return "date"
    if (UNIX_TS_RE.test(value)) return "date"
  }
  if (k === "id" || k.endsWith("_id")) return "text"
  if ((k.includes("url") || k.includes("link") || k.includes("image")) && URL_RE.test(value)) return "url"
  if (value === "true" || value === "false") return "boolean"
  if (NUM_RE.test(value)) return "number"
  if (EMAIL_RE.test(value)) return "email"
  if (PHONE_RE.test(value) && value.startsWith("+")) return "phone"
  if (DATE_RE.test(value)) return "date"
  if (URL_RE.test(value)) return "url"
  return "text"
}

export function detectFieldTypes(sample: Record<string, string>): { key: string; label: string; type: string }[] {
  return Object.entries(sample).map(([key, value]) => ({
    key,
    label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    type: detectType(key, value),
  }))
}

// ── Fetch rows from external API ───────────────────────────────

export async function fetchExternalRows(opts: {
  source_type: string
  base_url: string
  resource: string
  headers: Record<string, string>
  limit?: number
}): Promise<Record<string, string>[]> {
  const { source_type, base_url, resource, headers, limit = 100 } = opts
  const isFhir = source_type === "fhir"

  const url = isFhir
    ? `${base_url.replace(/\/$/, "")}/${resource}?_count=${limit}`
    : `${base_url.replace(/\/$/, "")}/${resource.replace(/^\//, "")}`

  // Use AbortController for timeout — more compatible than AbortSignal.timeout()
  // across Node.js versions and Next.js's fetch override.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error("Request timed out after 20s")), 20000)

  let res: Response
  try {
    res = await fetch(url, { headers, signal: controller.signal })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Normalize the generic "fetch failed" into something actionable
    if (msg === "fetch failed" || msg.includes("ENOTFOUND") || msg.includes("ECONNREFUSED")) {
      throw new Error(`Cannot reach ${new URL(url).hostname} — check the Base URL and your internet connection`)
    }
    if (msg.includes("abort") || msg.includes("timed out")) {
      throw new Error(`Request to ${new URL(url).hostname} timed out — server took more than 20 seconds to respond`)
    }
    throw new Error(`Network error: ${msg}`)
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ""}`)
  }

  const json = await res.json()

  if (isFhir) {
    const entries = (json.entry ?? []) as Array<{ resource?: Record<string, unknown> }>
    return entries
      .filter((e) => e.resource)
      .map((e) => flattenFhirResource(
        (e.resource!.resourceType as string) ?? resource,
        e.resource!,
      ))
  }

  // Plain REST — accept array or wrapper objects
  let rows: unknown[] = []
  if (Array.isArray(json)) {
    rows = json
  } else {
    const ARRAY_KEYS = ["data", "items", "results", "records", "rows",
      "orders", "customers", "products", "payments", "contacts",
      "entries", "patients", "bookings", "feedback", "responses"]
    for (const key of ARRAY_KEYS) {
      if (Array.isArray(json[key])) { rows = json[key]; break }
    }
  }

  return rows
    .filter((r) => r && typeof r === "object" && !Array.isArray(r))
    .slice(0, limit)
    .map((r) => flattenPlain(r as Record<string, unknown>))
}
