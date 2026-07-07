"use client"

import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import { Eye, EyeOff, Copy, CheckCircle2, XCircle, Loader2, ExternalLink, RefreshCw } from "lucide-react"

const MASKED = "••••••••••••••••"

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="#1877F2">
      <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.514c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
    </svg>
  )
}

type ConfigData = {
  configured: boolean
  status: string
  access_token: string
  verify_token: string
  page_id: string
  app_secret: string
  page_name?: string | null
  last_tested_at?: string | null
  test_error?: string | null
}

export function FacebookConfig() {
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [testing, setTesting]     = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const [tokenEdited, setTokenEdited]   = useState(false)
  const [secretEdited, setSecretEdited] = useState(false)

  const [accessToken, setAccessToken] = useState("")
  const [verifyToken, setVerifyToken] = useState("")
  const [pageId, setPageId]           = useState("")
  const [appSecret, setAppSecret]     = useState("")
  const [cfg, setCfg]                 = useState<ConfigData | null>(null)
  const [appUrl, setAppUrl]           = useState("")

  const defaultOrigin = typeof window !== "undefined" ? window.location.origin : ""
  const baseUrl = appUrl.trim().replace(/\/$/, "") || defaultOrigin
  const webhookUrl = `${baseUrl}/api/facebook/webhook`

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/facebook/config").then((x) => x.json()) as ConfigData
      setCfg(r)
      if (r.configured) {
        setAccessToken(r.access_token ?? "")
        setVerifyToken(r.verify_token ?? "")
        setPageId(r.page_id ?? "")
        setAppSecret(r.app_secret ?? "")
      }
    } catch {
      toast.error("Failed to load Facebook config")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSave() {
    if (!accessToken) {
      toast.error("Enter your Page Access Token")
      return
    }
    if (!verifyToken.trim()) {
      toast.error("Enter a verify token for webhooks")
      return
    }
    setSaving(true)
    try {
      const r = await fetch("/api/facebook/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: tokenEdited ? accessToken : MASKED,
          app_secret:   secretEdited ? appSecret : MASKED,
          verify_token: verifyToken,
          page_id:      pageId,
        }),
      }).then((x) => x.json()) as { success: boolean; error?: string }
      if (!r.success) throw new Error(r.error ?? "Save failed")
      toast.success("Facebook config saved")
      setTokenEdited(false)
      setSecretEdited(false)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    try {
      const r = await fetch("/api/facebook/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      }).then((x) => x.json()) as { success: boolean; error?: string; name?: string }
      if (r.success) {
        toast.success(`Connected! Page: ${r.name}`)
      } else {
        toast.error(r.error ?? "Test failed")
      }
      await load()
    } catch {
      toast.error("Test failed — check your token")
    } finally {
      setTesting(false)
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => toast.success("Copied!"))
  }

  function generateVerifyToken() {
    setVerifyToken(`fb_verify_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
      </div>
    )
  }

  const isConnected = cfg?.status === "connected"
  const hasError    = cfg?.status === "error"

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <FacebookIcon className="h-8 w-8" />
        <div>
          <h2 className="text-[15px] font-semibold text-slate-900">Facebook Messenger</h2>
          <p className="text-[12px] text-slate-500">Connect your Facebook Page to receive and reply to Messenger DMs</p>
        </div>
        <span className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
          isConnected ? "bg-emerald-50 text-emerald-700" :
          hasError    ? "bg-rose-50 text-rose-700" :
                        "bg-slate-100 text-slate-500"
        }`}>
          {isConnected ? <><CheckCircle2 className="h-3 w-3" />Connected</> :
           hasError    ? <><XCircle className="h-3 w-3" />Error</> :
                         "Not configured"}
        </span>
      </div>

      {isConnected && cfg?.page_name && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3 flex items-center gap-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <div>
            <p className="text-[13px] font-semibold text-emerald-800">{cfg.page_name}</p>
            {cfg.last_tested_at && (
              <p className="text-[11px] text-emerald-600">Tested {new Date(cfg.last_tested_at).toLocaleString()}</p>
            )}
          </div>
        </div>
      )}

      {hasError && cfg?.test_error && (
        <div className="rounded-xl bg-rose-50 border border-rose-100 px-4 py-3">
          <p className="text-[12px] font-semibold text-rose-700">Connection error</p>
          <p className="text-[12px] text-rose-600 mt-1">{cfg.test_error}</p>
        </div>
      )}

      {/* Step 1 — Page Access Token */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
          <p className="text-[12px] font-semibold text-slate-700">Step 1 — Page Access Token</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Meta Developer Console → your App → Messenger → API Settings → Access Tokens → Generate Token
          </p>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1.5">
              Page Access Token
              {!tokenEdited && accessToken === MASKED && (
                <span className="ml-2 text-[10px] text-amber-600 font-normal">(saved — click Clear to replace)</span>
              )}
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showToken ? "text" : "password"}
                  value={accessToken}
                  onChange={(e) => { setAccessToken(e.target.value); setTokenEdited(true) }}
                  onFocus={() => { if (accessToken === MASKED) { setAccessToken(""); setTokenEdited(true) } }}
                  placeholder="Paste your Page Access Token (starts with EAA…)"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] pr-10 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 font-mono"
                />
                <button type="button" onClick={() => setShowToken((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {accessToken && !tokenEdited && (
                <button type="button" onClick={() => { setAccessToken(""); setTokenEdited(true) }}
                  className="flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-[12px] font-medium text-rose-600 hover:bg-rose-50 transition-colors whitespace-nowrap">
                  <XCircle className="h-3.5 w-3.5" /> Clear
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1.5">
              App Secret <span className="text-slate-400 font-normal text-[10px]">(optional — for webhook signature verification)</span>
              {!secretEdited && appSecret === MASKED && (
                <span className="ml-2 text-[10px] text-amber-600 font-normal">(saved)</span>
              )}
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showSecret ? "text" : "password"}
                  value={appSecret}
                  onChange={(e) => { setAppSecret(e.target.value); setSecretEdited(true) }}
                  onFocus={() => { if (appSecret === MASKED) { setAppSecret(""); setSecretEdited(true) } }}
                  placeholder="App Secret from App Settings → Basic"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] pr-10 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 font-mono"
                />
                <button type="button" onClick={() => setShowSecret((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {appSecret && !secretEdited && (
                <button type="button" onClick={() => { setAppSecret(""); setSecretEdited(true) }}
                  className="flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-[12px] font-medium text-rose-600 hover:bg-rose-50 transition-colors whitespace-nowrap">
                  <XCircle className="h-3.5 w-3.5" /> Clear
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Step 2 — Page ID */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
          <p className="text-[12px] font-semibold text-slate-700">Step 2 — Page ID</p>
        </div>
        <div className="p-4">
          <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Facebook Page ID</label>
          <input
            value={pageId}
            onChange={(e) => setPageId(e.target.value)}
            placeholder="e.g. 101489656173087"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 font-mono"
          />
          <p className="text-[10px] text-slate-400 mt-1">Found in Meta Business Suite → Pages → click your page → ID shown below the page name</p>
        </div>
      </div>

      {/* Step 3 — Webhook */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
          <p className="text-[12px] font-semibold text-slate-700">Step 3 — Webhook Configuration</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Paste these into Meta Developer Console → Messenger → API Settings → Webhooks</p>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1.5">
              Your App URL <span className="text-rose-500 text-[10px] font-semibold ml-1">← enter your ngrok or production URL</span>
            </label>
            <input
              value={appUrl}
              onChange={(e) => setAppUrl(e.target.value)}
              placeholder="https://xxxx.ngrok-free.dev"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 font-mono"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Callback URL <span className="text-slate-400 text-[10px]">(paste in Meta)</span></label>
            <div className="flex gap-2">
              <input readOnly value={webhookUrl}
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-[13px] bg-slate-50 text-slate-600 font-mono outline-none" />
              <button type="button" onClick={() => copyToClipboard(webhookUrl)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[12px] font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                <Copy className="h-3.5 w-3.5" /> Copy
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Verify Token <span className="text-slate-400 text-[10px]">(paste in Meta)</span></label>
            <div className="flex gap-2">
              <input
                value={verifyToken}
                onChange={(e) => setVerifyToken(e.target.value)}
                placeholder="Type or generate a secret string…"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 font-mono"
              />
              <button type="button" onClick={generateVerifyToken}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[12px] font-medium text-slate-600 hover:bg-slate-50 transition-colors whitespace-nowrap">
                <RefreshCw className="h-3.5 w-3.5" /> Generate
              </button>
              {verifyToken && (
                <button type="button" onClick={() => copyToClipboard(verifyToken)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[12px] font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                  <Copy className="h-3.5 w-3.5" /> Copy
                </button>
              )}
            </div>
          </div>

          <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-[11px] text-blue-700 space-y-1">
            <p className="font-semibold">Webhook subscriptions to enable in Meta:</p>
            <p className="text-blue-600">
              <code className="bg-blue-100 px-1 rounded">messages</code>{" "}
              <code className="bg-blue-100 px-1 rounded">messaging_postbacks</code>{" "}
              <code className="bg-blue-100 px-1 rounded">message_deliveries</code>{" "}
              <code className="bg-blue-100 px-1 rounded">message_reads</code>{" "}
              <code className="bg-blue-100 px-1 rounded">message_reactions</code>
            </p>
            <a href="https://developers.facebook.com/docs/messenger-platform/webhooks"
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-1 text-blue-500 hover:underline">
              <ExternalLink className="h-3 w-3" /> Messenger Webhooks docs
            </a>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save Settings
        </button>
        <button type="button" onClick={handleTest} disabled={testing || !cfg?.configured}
          className="flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-2.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          title={!cfg?.configured ? "Save your config first" : ""}>
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          Test Connection
        </button>
        <button type="button" onClick={load}
          className="ml-auto flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2.5 text-[12px] text-slate-500 hover:bg-slate-50 transition-colors">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>
    </div>
  )
}
