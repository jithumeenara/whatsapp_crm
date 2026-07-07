"use client"

import React, { useEffect, useState, useCallback } from "react"
import { toast } from "sonner"
import {
  Plug, Plus, RefreshCw, Trash2, Play, CheckCircle2, XCircle,
  Clock, AlertCircle, ChevronDown, ChevronUp, Shield, Database,
  Users, Wifi, WifiOff, FlaskConical, ArrowRight, Loader2,
  ShoppingCart, CreditCard, MessageSquare, Star, Heart,
  Package, Cog, Globe, IndianRupee,
} from "lucide-react"
type RazorpayConstructor = new (o: Record<string, unknown>) => { open(): void; on(e: string, h: (r: unknown) => void): void }
function getRazorpay() { return (window as unknown as { Razorpay: RazorpayConstructor }).Razorpay }

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

// ── Types ──────────────────────────────────────────────────────
interface SyncLog { id: string; status: string; records_synced: number; contacts_created: number; error_message?: string; started_at: string }
interface Integration { id: string; name: string; category: string; source_type: string; base_url: string; resource: string; auth_type: string; auth_config?: { username?: string; password?: string; token?: string; header?: string; value?: string }; table_name?: string; sync_interval_minutes?: number; status: string; last_synced_at?: string; created_at: string; syncs: SyncLog[] }
interface TestResult { success: boolean; records_count: number; sample_fields: { key: string; label: string; type: string }[]; sample_data: Record<string, string>[]; message: string; error?: string }

// ── Category config ─────────────────────────────────────────────
const CAT_CFG: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  ecommerce:  { label: "E-Commerce",       icon: ShoppingCart, color: "text-violet-600", bg: "bg-violet-50 border-violet-200" },
  payment:    { label: "Payment Gateway",  icon: CreditCard,   color: "text-emerald-600",bg: "bg-emerald-50 border-emerald-200" },
  crm:        { label: "CRM / Leads",      icon: Users,        color: "text-sky-600",    bg: "bg-sky-50 border-sky-200" },
  feedback:   { label: "Feedback",         icon: Star,         color: "text-amber-600",  bg: "bg-amber-50 border-amber-200" },
  healthcare: { label: "Healthcare",       icon: Heart,        color: "text-rose-600",   bg: "bg-rose-50 border-rose-200" },
  inventory:  { label: "Inventory / ERP",  icon: Package,      color: "text-indigo-600", bg: "bg-indigo-50 border-indigo-200" },
  custom:     { label: "Custom API",       icon: Cog,          color: "text-slate-600",  bg: "bg-slate-50 border-slate-200" },
}

const STATUS_CFG: Record<string, { dot: string; badge: string }> = {
  active: { dot: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  paused: { dot: "bg-slate-400",   badge: "bg-slate-100 text-slate-600 border-slate-200" },
  error:  { dot: "bg-rose-500",    badge: "bg-rose-50 text-rose-700 border-rose-200" },
}

const FIELD_TYPE_COLOR: Record<string, string> = {
  phone:   "bg-emerald-100 text-emerald-700",
  email:   "bg-sky-100 text-sky-700",
  date:    "bg-violet-100 text-violet-700",
  number:  "bg-amber-100 text-amber-700",
  boolean: "bg-pink-100 text-pink-700",
  url:     "bg-indigo-100 text-indigo-700",
  text:    "bg-slate-100 text-slate-600",
}

// ── Presets by category ─────────────────────────────────────────
const PRESETS = [
  // E-Commerce
  { cat: "ecommerce", label: "Shopify Orders",       source_type: "rest", base_url: "", resource: "/admin/api/2024-01/orders.json",    auth_type: "api_key", hint: "shopify.myshopify.com" },
  { cat: "ecommerce", label: "WooCommerce Orders",   source_type: "rest", base_url: "", resource: "/wp-json/wc/v3/orders",             auth_type: "basic",   hint: "yourstore.com" },
  { cat: "ecommerce", label: "Custom Store API",     source_type: "rest", base_url: "", resource: "/api/orders",                       auth_type: "api_key", hint: "" },
  // Payment
  { cat: "payment",   label: "Razorpay Customers",   source_type: "rest", base_url: "https://api.razorpay.com/v1", resource: "customers", auth_type: "basic", hint: "key_id:key_secret" },
  { cat: "payment",   label: "Stripe Customers",     source_type: "rest", base_url: "https://api.stripe.com/v1",   resource: "customers", auth_type: "bearer", hint: "sk_test_..." },
  { cat: "payment",   label: "PayPal Transactions",  source_type: "rest", base_url: "", resource: "/v1/payments/payment",               auth_type: "bearer", hint: "" },
  // CRM
  { cat: "crm",       label: "HubSpot Contacts",     source_type: "rest", base_url: "https://api.hubapi.com",    resource: "/crm/v3/objects/contacts", auth_type: "bearer", hint: "pat-..." },
  { cat: "crm",       label: "Custom CRM",           source_type: "rest", base_url: "", resource: "/api/contacts",                     auth_type: "api_key", hint: "" },
  // Feedback
  { cat: "feedback",  label: "Typeform Responses",   source_type: "rest", base_url: "https://api.typeform.com",  resource: "/forms/{form_id}/responses", auth_type: "bearer", hint: "" },
  { cat: "feedback",  label: "Google Sheets (Script)",source_type: "rest",base_url: "", resource: "/exec?action=getAll",                auth_type: "none",   hint: "script.google.com/..." },
  { cat: "feedback",  label: "Custom Feedback API",  source_type: "rest", base_url: "", resource: "/api/feedback",                     auth_type: "api_key", hint: "" },
  // Healthcare
  { cat: "healthcare",label: "HAPI FHIR Patients",   source_type: "fhir", base_url: "https://hapi.fhir.org/baseR4", resource: "Patient",      auth_type: "none", hint: "" },
  { cat: "healthcare",label: "HAPI FHIR Appointments",source_type:"fhir", base_url: "https://hapi.fhir.org/baseR4", resource: "Appointment",  auth_type: "none", hint: "" },
  { cat: "healthcare",label: "Custom HMS API",       source_type: "rest", base_url: "", resource: "/api/patients",                     auth_type: "api_key", hint: "" },
  // Inventory
  { cat: "inventory", label: "Custom Inventory API", source_type: "rest", base_url: "", resource: "/api/products",                     auth_type: "api_key", hint: "" },
  { cat: "inventory", label: "Zoho Inventory Items", source_type: "rest", base_url: "https://inventory.zoho.in/api/v1", resource: "items", auth_type: "bearer", hint: "" },
]

const SYNC_INTERVALS = [
  { value: "",    label: "Manual only" },
  { value: "5",   label: "Every 5 minutes" },
  { value: "15",  label: "Every 15 minutes" },
  { value: "30",  label: "Every 30 minutes" },
  { value: "60",  label: "Every 1 hour" },
  { value: "360", label: "Every 6 hours" },
  { value: "1440",label: "Every 24 hours" },
]

const EMPTY_FORM = { name: "", category: "custom", source_type: "rest", base_url: "", resource: "", auth_type: "none", auth_header: "X-API-Key", auth_value: "", table_name: "", sync_interval: "" }

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [activeCat, setActiveCat] = useState<string>("all")
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [testPayOpen, setTestPayOpen] = useState<string | null>(null)
  const [testAmount, setTestAmount] = useState("100")
  const [payStep, setPayStep] = useState<"idle"|"loading-script"|"creating-order"|"opening-modal"|"verifying"|"done"|"error">("idle")
  const [payError, setPayError] = useState<string | null>(null)
  const [fixCreds, setFixCreds] = useState<{ keyId: string; keySecret: string }>({ keyId: "", keySecret: "" })
  const [fixSaving, setFixSaving] = useState(false)
  const [lastPayment, setLastPayment] = useState<Record<string, { payment_id: string; order_id: string }>>({})


  const load = useCallback(async () => {
    try {
      const d = await fetch("/api/integrations").then((r) => r.json())
      setIntegrations(d.integrations ?? [])
    } catch { toast.error("Failed to load integrations") }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function setF(patch: Partial<typeof EMPTY_FORM>) {
    setForm((f) => ({ ...f, ...patch }))
    setTestResult(null) // reset test when form changes
  }

  function applyPreset(p: typeof PRESETS[0]) {
    // Reset auth fields so the placeholder matches the selected auth type
    const authHeader = p.auth_type === "basic" ? "" : p.auth_type === "bearer" ? "" : "X-API-Key"
    setF({ name: p.label, category: p.cat, source_type: p.source_type, base_url: p.base_url, resource: p.resource, auth_type: p.auth_type, auth_header: authHeader, auth_value: "" })
    setActiveCat(p.cat)
  }

  async function handleTest() {
    if (!form.base_url.trim() || !form.resource.trim()) {
      toast.error("Fill in Base URL and Resource first"); return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const auth_config = buildAuthConfig()
      const res = await fetch("/api/integrations/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_type: form.source_type, base_url: form.base_url.trim(), resource: form.resource.trim(), auth_type: form.auth_type, auth_config }),
      })
      const data = await res.json()
      setTestResult(data)
      if (data.success) toast.success(data.message)
      else toast.error(data.error ?? "Connection failed")
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Test failed"
      setTestResult({ success: false, records_count: 0, sample_fields: [], sample_data: [], message: msg, error: msg })
      toast.error(msg)
    } finally { setTesting(false) }
  }

  function buildAuthConfig() {
    if (form.auth_type === "api_key") return { header: form.auth_header || "X-API-Key", value: form.auth_value }
    if (form.auth_type === "bearer") return { token: form.auth_value }
    if (form.auth_type === "basic") return { username: form.auth_header, password: form.auth_value }
    return undefined
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error("Give this integration a name"); return }
    if (!testResult?.success) { toast.error("Test the connection first"); return }
    setSaving(true)
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          category: form.category,
          source_type: form.source_type,
          base_url: form.base_url.trim(),
          resource: form.resource.trim(),
          auth_type: form.auth_type,
          auth_config: buildAuthConfig(),
          table_name: form.table_name.trim() || null,
          sync_interval_minutes: form.sync_interval ? parseInt(form.sync_interval) : null,
        }),
      })
      const b = await res.json()
      if (!res.ok) { toast.error(b.error ?? "Failed to save"); return }
      toast.success("Integration saved!")
      setShowForm(false); setForm({ ...EMPTY_FORM }); setTestResult(null)
      load()
    } finally { setSaving(false) }
  }

  async function handleSync(id: string) {
    setSyncing(id)
    try {
      const res = await fetch(`/api/integrations/${id}/sync`, { method: "POST" })
      const b = await res.json()
      if (!res.ok) { toast.error(b.error ?? "Sync failed"); return }
      if (b.records_synced === 0) {
        toast.success("Connected — no records yet. Table created and ready for data.")
      } else {
        toast.success(`Synced ${b.records_synced} records · ${b.contacts_created} new contacts`)
      }
      load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error — check the server is running"
      toast.error(msg)
    } finally { setSyncing(null) }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this integration? Synced data in Data Store will remain.")) return
    await fetch(`/api/integrations/${id}`, { method: "DELETE" })
    toast.success("Integration deleted")
    setIntegrations((p) => p.filter((i) => i.id !== id))
  }

  async function toggleStatus(i: Integration) {
    const next = i.status === "paused" ? "active" : "paused"
    await fetch(`/api/integrations/${i.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) })
    setIntegrations((p) => p.map((x) => x.id === i.id ? { ...x, status: next } : x))
  }

  async function handleTestPay(intgId: string) {
    setPayStep("loading-script")
    setPayError(null)
    try {
      // 1 — load checkout.js
      await new Promise<void>((res, rej) => {
        if (window.Razorpay) { res(); return }
        const s = document.createElement("script")
        s.src = "https://checkout.razorpay.com/v1/checkout.js"
        s.onload = () => res()
        s.onerror = () => rej(new Error("Failed to load checkout.js — check internet connection"))
        document.head.appendChild(s)
      })

      // 2 — create order
      setPayStep("creating-order")
      const paise = Math.max(100, Math.round(parseFloat(testAmount || "1") * 100))
      const orderRes = await fetch("/api/razorpay/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: paise,
          currency: "INR",
          integration_id: intgId,   // credentials fetched from this integration's auth_config
          notes: { integration_id: intgId },
        }),
      })
      const orderData = await orderRes.json()
      if (!orderRes.ok) throw new Error(orderData.error ?? `Order failed (${orderRes.status})`)
      if (!orderData.key_id) throw new Error("Server env var RAZORPAY_KEY_ID missing — restart dev server")

      // 3 — open modal
      setPayStep("opening-modal")
      await new Promise<void>((res, rej) => {
        const Razorpay = getRazorpay()
        const rzp = new Razorpay({
          key: orderData.key_id,
          amount: orderData.amount,
          currency: orderData.currency,
          name: "WhatsApp CRM",
          description: "Test Payment",
          order_id: orderData.order_id,
          theme: { color: "#5B6CF9" },
          handler: async (response: unknown) => {
            const r = response as { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }
            setPayStep("verifying")
            try {
              const vRes = await fetch("/api/razorpay/verify-payment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ razorpay_order_id: r.razorpay_order_id, razorpay_payment_id: r.razorpay_payment_id, razorpay_signature: r.razorpay_signature, integration_id: intgId }),
              })
              const vData = await vRes.json()
              if (!vRes.ok) { rej(new Error(vData.error ?? "Verification failed")); return }
              setLastPayment((p) => ({ ...p, [intgId]: { payment_id: r.razorpay_payment_id, order_id: r.razorpay_order_id } }))
              setPayStep("verifying")
              // Save payment details to Data Store
              await fetch("/api/razorpay/save-payment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  payment_id: r.razorpay_payment_id,
                  order_id: r.razorpay_order_id,
                  integration_id: intgId,
                  amount: orderData.amount,
                  currency: orderData.currency,
                }),
              })
              setPayStep("done")
              toast.success(`Payment ₹${testAmount} successful! Saved to Data Store.`)
              res()
            } catch (e) { rej(e) }
          },
          modal: { ondismiss: () => { setPayStep("idle"); res() } },
        })
        rzp.on("payment.failed", ((r: { error: { description: string } }) => rej(new Error(r.error?.description ?? "Payment failed"))) as (r: unknown) => void)
        rzp.open()
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setPayStep("error")
      setPayError(msg)
      toast.error(msg)
    }
  }

  async function saveCredentials(intgId: string) {
    if (!fixCreds.keyId.trim() || !fixCreds.keySecret.trim()) {
      toast.error("Enter both Key ID and Key Secret")
      return
    }
    setFixSaving(true)
    try {
      const res = await fetch(`/api/integrations/${intgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth_type: "basic",
          auth_config: { username: fixCreds.keyId.trim(), password: fixCreds.keySecret.trim() },
        }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Save failed") }
      // Refresh integrations list so new auth_config is in memory
      const listRes = await fetch("/api/integrations")
      const listData = await listRes.json()
      setIntegrations(listData.integrations ?? [])
      toast.success("Credentials saved — try Pay again")
      setPayStep("idle")
      setPayError(null)
      setFixCreds({ keyId: "", keySecret: "" })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed")
    } finally {
      setFixSaving(false)
    }
  }

  const filteredPresets = activeCat === "all" ? PRESETS : PRESETS.filter((p) => p.cat === activeCat)
  const catKeys = ["all", ...Object.keys(CAT_CFG)]

  return (
    <div className="flex h-full flex-col bg-[#F4F6FA]">
      {/* Header */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm">
              <Plug className="h-4.5 w-4.5 text-white" />
            </div>
            <div>
              <h1 className="text-[16px] font-bold text-slate-900">Integrations</h1>
              <p className="text-[12px] text-slate-500">Connect any external app — e-commerce, payments, CRM, healthcare, inventory and more</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={load} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
            <button type="button" onClick={() => { setShowForm((v) => !v); setTestResult(null) }}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700 shadow-sm">
              <Plus className="h-3.5 w-3.5" /> Add Integration
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">

        {/* ── Add Form ── */}
        {showForm && (
          <div className="rounded-2xl border border-indigo-200 bg-white shadow-md overflow-hidden">
            {/* Form header */}
            <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-indigo-600 to-violet-600">
              <p className="text-[13px] font-semibold text-white">New Integration</p>
              <button type="button" onClick={() => { setShowForm(false); setTestResult(null) }} className="text-white/70 hover:text-white text-[20px] leading-none">×</button>
            </div>

            <div className="p-5 space-y-5">
              {/* Category filter */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">Category</p>
                <div className="flex flex-wrap gap-1.5">
                  {catKeys.map((k) => {
                    const cfg = k === "all" ? { label: "All", icon: Globe, color: "text-slate-600", bg: "" } : CAT_CFG[k]
                    const Icon = cfg.icon
                    const on = activeCat === k
                    return (
                      <button key={k} type="button" onClick={() => setActiveCat(k)}
                        className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-all",
                          on ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-700")}>
                        <Icon className="h-3 w-3" />{cfg.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Preset chips */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">Quick Presets</p>
                <div className="flex flex-wrap gap-2">
                  {filteredPresets.map((p) => {
                    const cat = CAT_CFG[p.cat]
                    const Icon = cat.icon
                    return (
                      <button key={p.label} type="button" onClick={() => applyPreset(p)}
                        className={cn("flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-all hover:shadow-sm",
                          form.name === p.label ? `${cat.bg} border-current ${cat.color}` : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300")}>
                        <Icon className={cn("h-3 w-3", cat.color)} />{p.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Fields */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Integration Name" required>
                  <input value={form.name} onChange={(e) => setF({ name: e.target.value })} placeholder="e.g. Shopify Store Orders" className="inp" />
                </Field>
                <Field label="Update Frequency">
                  <select value={form.sync_interval} onChange={(e) => setF({ sync_interval: e.target.value })} className="inp">
                    {SYNC_INTERVALS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </Field>
                <Field label="Base URL" required>
                  <input value={form.base_url} onChange={(e) => setF({ base_url: e.target.value })}
                    placeholder="https://api.yourapp.com" className="inp" />
                </Field>
                <Field label={form.source_type === "fhir" ? "FHIR Resource" : "API Endpoint"} required>
                  <input value={form.resource} onChange={(e) => setF({ resource: e.target.value })}
                    placeholder={form.source_type === "fhir" ? "Patient" : "/api/orders"} className="inp" />
                </Field>
                <Field label="Data Source Type">
                  <select value={form.source_type} onChange={(e) => setF({ source_type: e.target.value })} className="inp">
                    <option value="rest">REST API (most apps)</option>
                    <option value="fhir">FHIR (Healthcare standard)</option>
                  </select>
                </Field>
                <Field label="Authentication">
                  <select value={form.auth_type} onChange={(e) => setF({ auth_type: e.target.value })} className="inp">
                    <option value="none">None — Public API</option>
                    <option value="api_key">API Key</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="basic">Basic Auth (username + password)</option>
                  </select>
                </Field>
              </div>

              {/* Razorpay-specific auth hint */}
              {form.base_url.includes("razorpay.com") && form.auth_type !== "basic" && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12px] text-amber-800 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                  <span><strong>Razorpay requires Basic Auth.</strong> Change Authentication to <em>Basic Auth (username + password)</em>, then enter your Key ID as username and Key Secret as password.</span>
                </div>
              )}

              {/* Auth config */}
              {form.auth_type !== "none" && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 grid grid-cols-2 gap-3">
                  <p className="col-span-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5" /> Authentication Credentials
                    {form.base_url.includes("razorpay.com") && (
                      <span className="ml-auto text-[10px] font-normal text-slate-400 normal-case tracking-normal">Username = Key ID · Password = Key Secret</span>
                    )}
                  </p>
                  <Field label={form.auth_type === "api_key" ? "Header Name" : form.auth_type === "basic" ? "Key ID / Username" : "Token"}>
                    <input value={form.auth_header} onChange={(e) => setF({ auth_header: e.target.value })}
                      placeholder={form.auth_type === "api_key" ? "X-API-Key" : form.auth_type === "basic" ? "e.g. rzp_test_..." : ""}
                      className="inp" />
                  </Field>
                  <Field label={form.auth_type === "api_key" ? "API Key" : form.auth_type === "basic" ? "Key Secret / Password" : "Bearer Token"}>
                    <input type="password" value={form.auth_value} onChange={(e) => setF({ auth_value: e.target.value })}
                      placeholder="••••••••" className="inp" />
                  </Field>
                </div>
              )}

              <Field label="Custom Table Name (optional)">
                <input value={form.table_name} onChange={(e) => setF({ table_name: e.target.value })}
                  placeholder="Auto-generated from integration name" className="inp" />
              </Field>

              {/* ── Test Result ── */}
              {testResult && (
                <div className={cn("rounded-xl border p-4 space-y-3",
                  testResult.success ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50")}>
                  <div className="flex items-center gap-2">
                    {testResult.success
                      ? <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600 shrink-0" />
                      : <XCircle className="h-4.5 w-4.5 text-rose-600 shrink-0" />}
                    <p className={cn("text-[13px] font-semibold", testResult.success ? "text-emerald-800" : "text-rose-800")}>
                      {testResult.success ? "Connection Successful!" : "Connection Failed"}
                    </p>
                  </div>
                  <p className={cn("text-[12px]", testResult.success ? "text-emerald-700" : "text-rose-700")}>
                    {testResult.message || testResult.error}
                  </p>

                  {testResult.success && testResult.sample_fields.length > 0 && (
                    <>
                      <div>
                        <p className="text-[11px] font-semibold text-emerald-700 mb-1.5">Detected Fields ({testResult.sample_fields.length})</p>
                        <div className="flex flex-wrap gap-1.5">
                          {testResult.sample_fields.map((f) => (
                            <span key={f.key} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", FIELD_TYPE_COLOR[f.type] ?? FIELD_TYPE_COLOR.text)}>
                              {f.label} <span className="opacity-60">· {f.type}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                      {testResult.sample_data[0] && (
                        <div>
                          <p className="text-[11px] font-semibold text-emerald-700 mb-1.5">Sample Record</p>
                          <div className="rounded-lg bg-white border border-emerald-200 p-3 text-[11px] font-mono text-slate-600 max-h-28 overflow-y-auto space-y-0.5">
                            {Object.entries(testResult.sample_data[0]).slice(0, 8).map(([k, v]) => (
                              <div key={k} className="flex gap-2">
                                <span className="text-indigo-600 shrink-0">{k}:</span>
                                <span className="truncate text-slate-700">{v}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center justify-between border-t border-slate-100 pt-4">
                <button type="button" onClick={() => { setShowForm(false); setTestResult(null) }}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={handleTest} disabled={testing || !form.base_url.trim() || !form.resource.trim()}
                    className="flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-[13px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-40">
                    {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
                    {testing ? "Testing…" : "Test Connection"}
                  </button>
                  <button type="button" onClick={handleSave} disabled={saving || !testResult?.success}
                    className={cn("flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold transition-all",
                      testResult?.success
                        ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm"
                        : "bg-slate-200 text-slate-400 cursor-not-allowed")}>
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                    {saving ? "Saving…" : testResult?.success ? "Save Integration" : "Test First"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Integration List ── */}
        {loading ? (
          <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-28 rounded-2xl bg-white border border-slate-200 animate-pulse" />)}</div>
        ) : integrations.length === 0 && !showForm ? (
          <EmptyState onAdd={() => setShowForm(true)} />
        ) : (
          <div className="space-y-3">
            {integrations.map((intg) => {
              const cat = CAT_CFG[intg.category] ?? CAT_CFG.custom
              const CatIcon = cat.icon
              const sc = STATUS_CFG[intg.status] ?? STATUS_CFG.active
              const lastSync = intg.syncs[0]
              const isSyncing = syncing === intg.id
              const isExpanded = expanded === intg.id

              return (
                <div key={intg.id} className="rounded-2xl bg-white border border-slate-200 shadow-[0_1px_3px_rgba(0,0,0,0.05)] overflow-hidden">
                  <div className="flex items-center gap-4 p-5">
                    {/* Category icon */}
                    <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border", cat.bg)}>
                      <CatIcon className={cn("h-5 w-5", cat.color)} />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-0.5">
                        <p className="text-[14px] font-bold text-slate-900">{intg.name}</p>
                        <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", sc.badge)}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", sc.dot)} />
                          {intg.status.charAt(0).toUpperCase() + intg.status.slice(1)}
                        </span>
                        <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-500 uppercase">
                          {intg.source_type}
                        </span>
                        {intg.sync_interval_minutes && (
                          <span className="rounded-full bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[10px] font-semibold text-indigo-600 flex items-center gap-1">
                            <Wifi className="h-2.5 w-2.5" />
                            Every {intg.sync_interval_minutes >= 60 ? `${intg.sync_interval_minutes/60}h` : `${intg.sync_interval_minutes}m`}
                          </span>
                        )}
                      </div>
                      <p className="text-[12px] text-slate-400 truncate">{intg.base_url}/{intg.resource}</p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 mt-1.5 text-[11px] text-slate-500">
                        <span className="flex items-center gap-1"><Database className="h-3 w-3 text-slate-300" />{intg.table_name || "Auto table"}</span>
                        <span className="flex items-center gap-1"><Shield className="h-3 w-3 text-slate-300" />{intg.auth_type === "none" ? "No auth" : intg.auth_type}</span>
                        {intg.last_synced_at && <span className="flex items-center gap-1"><Clock className="h-3 w-3 text-slate-300" />Last sync {new Date(intg.last_synced_at).toLocaleString()}</span>}
                        {lastSync && (
                          <span className={cn("font-medium flex items-center gap-1",
                            lastSync.status === "success" ? "text-emerald-600" : lastSync.status === "error" ? "text-rose-600" : "text-indigo-600")}>
                            {lastSync.status === "success" ? <CheckCircle2 className="h-3 w-3" /> : lastSync.status === "error" ? <AlertCircle className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />}
                            {lastSync.records_synced} records · {lastSync.contacts_created} contacts
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* Razorpay: Test Pay button */}
                      {intg.base_url.includes("razorpay.com") && (
                        <button type="button"
                          onClick={() => setTestPayOpen(testPayOpen === intg.id ? null : intg.id)}
                          className={cn(
                            "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-all",
                            testPayOpen === intg.id
                              ? "border-emerald-400 bg-emerald-600 text-white"
                              : "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          )}>
                          <IndianRupee className="h-3.5 w-3.5" />
                          Test Pay
                        </button>
                      )}
                      <button type="button" onClick={() => handleSync(intg.id)} disabled={isSyncing || intg.status === "paused"}
                        className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
                        {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                        {isSyncing ? "Syncing…" : "Sync"}
                      </button>
                      <button type="button" onClick={() => toggleStatus(intg)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50">
                        {intg.status === "paused" ? <><Wifi className="h-3 w-3 inline mr-1" />Resume</> : <><WifiOff className="h-3 w-3 inline mr-1" />Pause</>}
                      </button>
                      <button type="button" onClick={() => setExpanded(isExpanded ? null : intg.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-50">
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      <button type="button" onClick={() => handleDelete(intg.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-rose-200 text-rose-400 hover:bg-rose-50">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Razorpay Test Payment Panel */}
                  {testPayOpen === intg.id && (
                    <div className="border-t border-emerald-100 bg-gradient-to-br from-emerald-50 to-teal-50 px-5 py-4">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600">
                          <IndianRupee className="h-3.5 w-3.5 text-white" />
                        </div>
                        <p className="text-[13px] font-bold text-slate-800">Test Razorpay Payment</p>
                        <span className="rounded-full bg-amber-100 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-700">TEST MODE</span>
                      </div>

                      {/* Success result from last payment */}
                      {lastPayment[intg.id] && (
                        <div className="mb-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 flex items-start gap-3">
                          <CheckCircle2 className="h-4.5 w-4.5 text-emerald-500 shrink-0 mt-0.5" />
                          <div className="text-[12px] space-y-0.5">
                            <p className="font-semibold text-emerald-800">Payment Successful!</p>
                            <p className="text-slate-500">Payment ID: <span className="font-mono text-slate-700">{lastPayment[intg.id].payment_id}</span></p>
                            <p className="text-slate-500">Order ID: <span className="font-mono text-slate-700">{lastPayment[intg.id].order_id}</span></p>
                            <p className="text-[11px] text-indigo-600 mt-1">
                              Click <strong>Sync</strong> above to pull this payment into Data Store.
                            </p>
                          </div>
                        </div>
                      )}

                      <div className="flex items-end gap-3">
                        {/* Amount input */}
                        <div className="flex-1 max-w-[180px]">
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Amount (₹)
                          </label>
                          <div className="relative">
                            <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={testAmount}
                              onChange={(e) => setTestAmount(e.target.value)}
                              className="inp pl-8"
                              placeholder="100"
                            />
                          </div>
                          <p className="text-[10px] text-slate-400 mt-0.5">Min ₹1 · Test card: 4111 1111 1111 1111</p>
                        </div>

                        {/* Pay button — uses inline handleTestPay (no child component) */}
                        <div className="flex flex-col gap-1">
                          <button type="button"
                            onClick={() => {
                              setPayStep("idle")
                              setPayError(null)
                              handleTestPay(intg.id)
                            }}
                            disabled={payStep !== "idle" && payStep !== "done" && payStep !== "error"}
                            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2 text-[13px] font-bold text-white hover:bg-emerald-700 disabled:opacity-60 shadow-sm shadow-emerald-200">
                            {payStep === "idle" || payStep === "done" || payStep === "error"
                              ? <><IndianRupee className="h-4 w-4" /> Pay ₹{testAmount || "1"}</>
                              : <>
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  {payStep === "loading-script" ? "Loading…" :
                                   payStep === "creating-order" ? "Creating order…" :
                                   payStep === "opening-modal" ? "Opening payment…" :
                                   "Verifying…"}
                                </>
                            }
                          </button>
                          {payError && !payError.toLowerCase().includes("auth") && (
                            <p className="text-[11px] text-rose-600 max-w-[240px]">{payError}</p>
                          )}
                        </div>
                      </div>

                      {/* Inline credential fix — shown when auth fails */}
                      {payError?.toLowerCase().includes("auth") && (
                        <div className="mt-4 rounded-xl border border-rose-200 bg-white p-4">
                          <p className="text-[12px] font-semibold text-rose-700 mb-1">Authentication Failed</p>
                          <p className="text-[11px] text-slate-500 mb-3">
                            {intg.auth_config?.username
                              ? <>Current Key ID: <span className="font-mono text-slate-700">{intg.auth_config.username.slice(0, 16)}…</span> — this key is being rejected by Razorpay.</>
                              : "No credentials saved in this integration."}
                            {" "}Get fresh keys from{" "}
                            <a href="https://dashboard.razorpay.com/app/keys" target="_blank" rel="noreferrer"
                              className="text-indigo-600 underline">dashboard.razorpay.com → Settings → API Keys</a> (Test Mode).
                          </p>
                          <div className="flex flex-col gap-2">
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Key ID (rzp_test_…)</label>
                                <input
                                  type="text"
                                  value={fixCreds.keyId}
                                  onChange={(e) => setFixCreds((p) => ({ ...p, keyId: e.target.value }))}
                                  placeholder="rzp_test_XXXXXXXXXXXXXXXX"
                                  className="inp text-[12px] font-mono"
                                />
                              </div>
                              <div className="flex-1">
                                <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Key Secret</label>
                                <input
                                  type="password"
                                  value={fixCreds.keySecret}
                                  onChange={(e) => setFixCreds((p) => ({ ...p, keySecret: e.target.value }))}
                                  placeholder="••••••••••••••••••••••••"
                                  className="inp text-[12px]"
                                />
                              </div>
                            </div>
                            <button type="button"
                              onClick={() => saveCredentials(intg.id)}
                              disabled={fixSaving}
                              className="self-start flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                              {fixSaving ? <><Loader2 className="h-3 w-3 animate-spin" /> Saving…</> : "Save & Retry"}
                            </button>
                          </div>
                        </div>
                      )}

                      <p className="mt-3 text-[11px] text-slate-400">
                        Uses test credentials. No real money is charged.
                        OTP for test: <span className="font-mono font-semibold text-slate-500">1234</span>
                      </p>
                    </div>
                  )}

                  {/* Sync history */}
                  {isExpanded && intg.syncs.length > 0 && (
                    <div className="border-t border-slate-100 px-5 py-3 bg-slate-50">
                      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Sync History</p>
                      <div className="space-y-1.5">
                        {intg.syncs.map((s) => (
                          <div key={s.id} className="flex items-center gap-3 text-[12px]">
                            <span className={cn("font-semibold w-16 shrink-0",
                              s.status === "success" ? "text-emerald-600" : s.status === "error" ? "text-rose-600" : "text-indigo-600")}>
                              {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                            </span>
                            <span className="text-slate-600">{s.records_synced} records</span>
                            <span className="flex items-center gap-1 text-slate-500"><Users className="h-3 w-3" />{s.contacts_created} new</span>
                            {s.error_message && <span className="text-rose-500 flex items-center gap-1 truncate"><AlertCircle className="h-3 w-3 shrink-0" />{s.error_message.slice(0, 80)}</span>}
                            <span className="ml-auto text-slate-400 shrink-0">{new Date(s.started_at).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <style jsx global>{`
        .inp { height:36px; width:100%; border-radius:8px; border:1px solid #e2e8f0; background:#f8fafc; padding:0 12px; font-size:13px; color:#1e293b; outline:none; }
        .inp:focus { border-color:#818cf8; box-shadow:0 0 0 2px #eef2ff; }
        select.inp { cursor:pointer; }
      `}</style>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
        {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white border border-slate-200 shadow-sm mb-5">
        <Plug className="h-8 w-8 text-slate-300" />
      </div>
      <p className="text-[15px] font-semibold text-slate-700">No integrations yet</p>
      <p className="mt-1 text-[13px] text-slate-400 max-w-sm">Connect any external app — Shopify, Razorpay, HubSpot, HMS, inventory systems or any custom REST/FHIR API.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {Object.entries(CAT_CFG).map(([k, v]) => {
          const Icon = v.icon
          return (
            <span key={k} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium", v.bg, v.color)}>
              <Icon className="h-3 w-3" />{v.label}
            </span>
          )
        })}
      </div>
      <button type="button" onClick={onAdd}
        className="mt-6 flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-indigo-700 shadow-sm">
        <Plus className="h-3.5 w-3.5" /> Add First Integration
      </button>
    </div>
  )
}
