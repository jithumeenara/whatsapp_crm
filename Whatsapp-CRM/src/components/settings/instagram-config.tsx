"use client"

import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import { Eye, EyeOff, Copy, CheckCircle2, XCircle, Loader2, ExternalLink, RefreshCw } from "lucide-react"
import { EmbeddedSignupButton } from "@/components/settings/embedded-signup-button"
import { ConnectChannelScreen } from "@/components/settings/connect-channel-screen"
import { InstagramIcon } from "@/components/icons/brand-icons"

const MASKED = "••••••••••••••••"

type ConfigData = {
  configured: boolean
  status: string
  access_token: string
  verify_token: string
  instagram_account_id: string
  page_id: string
  ig_username?: string | null
  ig_name?: string | null
  last_tested_at?: string | null
  test_error?: string | null
}

export function InstagramConfig() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [connectMethod, setConnectMethod] = useState<'quick' | 'manual'>('quick')
  const [tokenEdited, setTokenEdited] = useState(false)

  const [accessToken, setAccessToken] = useState("")
  const [verifyToken, setVerifyToken] = useState("")
  const [igAccountId, setIgAccountId] = useState("")
  const [pageId, setPageId] = useState("")
  const [cfg, setCfg] = useState<ConfigData | null>(null)
  const [appUrl, setAppUrl] = useState("")

  // Build webhook URL from the user-editable app URL, fallback to current origin
  const defaultOrigin = typeof window !== "undefined" ? window.location.origin : ""
  const baseUrl = appUrl.trim().replace(/\/$/, "") || defaultOrigin
  const webhookUrl = `${baseUrl}/api/instagram/webhook`

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/instagram/config").then((x) => x.json()) as ConfigData
      setCfg(r)
      if (r.configured) {
        setAccessToken(r.access_token ?? "")
        setVerifyToken(r.verify_token ?? "")
        setIgAccountId(r.instagram_account_id ?? "")
        setPageId(r.page_id ?? "")
      }
    } catch {
      toast.error("Failed to load Instagram config")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSave() {
    // Block only if truly empty — MASKED means an existing token is kept by the server
    if (!accessToken) {
      toast.error("Enter your Instagram access token")
      return
    }
    if (!verifyToken.trim()) {
      toast.error("Enter a verify token for webhooks")
      return
    }
    setSaving(true)
    try {
      const r = await fetch("/api/instagram/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: tokenEdited ? accessToken : MASKED,
          verify_token: verifyToken,
          instagram_account_id: igAccountId,
          page_id: pageId,
        }),
      }).then((x) => x.json()) as { success: boolean; error?: string }

      if (!r.success) throw new Error(r.error ?? "Save failed")
      toast.success("Instagram config saved")
      setTokenEdited(false)
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
      const r = await fetch("/api/instagram/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      }).then((x) => x.json()) as { success: boolean; error?: string; name?: string; username?: string }

      if (r.success) {
        toast.success(`Connected! Account: ${r.name} (@${r.username})`)
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
    const token = `ig_verify_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`
    setVerifyToken(token)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-[#5B6CF9]" />
      </div>
    )
  }

  const isConnected = cfg?.status === "connected"
  const hasError = cfg?.status === "error"

  return (
    <div className="space-y-6">
      {!isConnected && (
        <ConnectChannelScreen
          icon={InstagramIcon}
          channelName="Instagram"
          method={connectMethod}
          onMethodChange={setConnectMethod}
          quickConnect={<EmbeddedSignupButton onConnected={load} />}
          manualConnect={null}
        />
      )}

      {(isConnected || connectMethod === 'manual') && (
      <>

      {/* Header */}
      <div className="flex items-center gap-3">
        <InstagramIcon className="h-8 w-8" />
        <div>
          <h2 className="text-[15px] font-semibold text-slate-900">Instagram Messaging</h2>
          <p className="text-[12px] text-slate-500">Connect your Instagram Business account to receive and reply to DMs</p>
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

      {/* Connected account info */}
      {isConnected && cfg?.ig_name && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3 flex items-center gap-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <div>
            <p className="text-[13px] font-semibold text-emerald-800">{cfg.ig_name}</p>
            {cfg.ig_username && <p className="text-[11px] text-emerald-600">@{cfg.ig_username}</p>}
          </div>
          {cfg.last_tested_at && (
            <p className="ml-auto text-[10px] text-emerald-500">
              Tested {new Date(cfg.last_tested_at).toLocaleString()}
            </p>
          )}
        </div>
      )}

      {/* Error */}
      {hasError && cfg?.test_error && (
        <div className="rounded-xl bg-rose-50 border border-rose-100 px-4 py-3 space-y-2">
          <p className="text-[12px] font-semibold text-rose-700">Connection error</p>
          <p className="text-[12px] text-rose-600">{cfg.test_error}</p>
          {cfg.test_error.includes("parse access token") && (
            <div className="rounded-lg bg-white border border-rose-200 p-3 text-[11px] text-rose-700 space-y-1">
              <p className="font-semibold">How to fix:</p>
              <ol className="list-decimal list-inside space-y-1 text-rose-600">
                <li>Go to Meta Developer Console → Your App → Instagram → <strong>API setup with Instagram login</strong></li>
                <li>Under <strong>&quot;2. Generate access tokens&quot;</strong>, click <strong>&quot;Generate token&quot;</strong> next to your Instagram account</li>
                <li>Copy the <strong>full token</strong> from the popup (it starts with <code className="bg-rose-100 px-1 rounded">IGQ...</code> and is 200+ characters long)</li>
                <li>Click the Access Token field below, clear it, paste the new token</li>
                <li>Click <strong>Save Settings</strong> then <strong>Test Connection</strong></li>
              </ol>
            </div>
          )}
        </div>
      )}

      {/* Step 1 — Access Token */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-start gap-2.5 px-4 py-3 bg-slate-50 border-b border-slate-100">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#5B6CF9] text-[10px] font-bold text-white">1</span>
          <div>
            <p className="text-[12px] font-semibold text-slate-700">Access Token</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              From Meta Developer Console → Instagram → API setup → Generate token
            </p>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1.5">
              Access Token
              {!tokenEdited && accessToken === MASKED && (
                <span className="ml-2 text-[10px] text-amber-600 font-normal">(token saved — click field or Clear to replace)</span>
              )}
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showToken ? "text" : "password"}
                  value={accessToken}
                  onChange={(e) => { setAccessToken(e.target.value); setTokenEdited(true) }}
                  onFocus={() => { if (accessToken === MASKED) { setAccessToken(""); setTokenEdited(true) } }}
                  placeholder="Paste your Instagram access token (starts with IGQ… or EAA…)"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] pr-10 outline-none focus:border-[#5B6CF9]/40 focus:ring-2 focus:ring-[#5B6CF9]/10 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {accessToken && !tokenEdited && (
                <button
                  type="button"
                  onClick={() => { setAccessToken(""); setTokenEdited(true) }}
                  className="flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-[12px] font-medium text-rose-600 hover:bg-rose-50 transition-colors whitespace-nowrap"
                >
                  <XCircle className="h-3.5 w-3.5" /> Clear
                </button>
              )}
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              Token starts with <code className="bg-slate-100 px-1 rounded">IGQ...</code> or <code className="bg-slate-100 px-1 rounded">EAA...</code> and is 200+ characters. Copy the full token from Meta.
            </p>
          </div>
        </div>
      </div>

      {/* Step 2 — Account IDs */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-start gap-2.5 px-4 py-3 bg-slate-50 border-b border-slate-100">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#5B6CF9] text-[10px] font-bold text-white">2</span>
          <div>
            <p className="text-[12px] font-semibold text-slate-700">Account IDs</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Find these in Meta Developer Console or by calling /me with your token
            </p>
          </div>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Instagram Account ID</label>
            <input
              value={igAccountId}
              onChange={(e) => setIgAccountId(e.target.value)}
              placeholder="e.g. 17841400000000000"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-[#5B6CF9]/40 focus:ring-2 focus:ring-[#5B6CF9]/10 font-mono"
            />
            <p className="text-[10px] text-slate-400 mt-1">Auto-filled after Test Connection succeeds</p>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Facebook Page ID <span className="text-slate-400 font-normal">(optional)</span></label>
            <input
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
              placeholder="e.g. 100000000000000"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-[#5B6CF9]/40 focus:ring-2 focus:ring-[#5B6CF9]/10 font-mono"
            />
          </div>
        </div>
      </div>

      {/* Step 3 — Webhook */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-start gap-2.5 px-4 py-3 bg-slate-50 border-b border-slate-100">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#5B6CF9] text-[10px] font-bold text-white">3</span>
          <div>
            <p className="text-[12px] font-semibold text-slate-700">Webhook Configuration</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Paste these into Meta Developer Console → Webhooks → Instagram
            </p>
          </div>
        </div>
        <div className="p-4 space-y-4">
          {/* App / ngrok URL */}
          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1.5">
              Your App URL <span className="text-rose-500 text-[10px] font-semibold ml-1">← enter your ngrok URL here</span>
            </label>
            <input
              value={appUrl}
              onChange={(e) => setAppUrl(e.target.value)}
              placeholder="https://xxxx.ngrok-free.dev  (or your production domain)"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-[#5B6CF9]/40 focus:ring-2 focus:ring-[#5B6CF9]/10 font-mono"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              In development: copy the Forwarding URL from ngrok (e.g. <code>https://rugulose-xxx.ngrok-free.dev</code>).
              In production: your real domain.
            </p>
          </div>

          {/* Webhook URL */}
          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Webhook URL <span className="text-slate-400 text-[10px]">(paste this in Meta)</span></label>
            <div className="flex gap-2">
              <input
                readOnly
                value={webhookUrl}
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-[13px] bg-slate-50 text-slate-600 font-mono outline-none"
              />
              <button
                type="button"
                onClick={() => copyToClipboard(webhookUrl)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[12px] font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <Copy className="h-3.5 w-3.5" /> Copy
              </button>
            </div>
          </div>

          {/* Verify Token */}
          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Verify Token <span className="text-slate-400 text-[10px]">(paste this in Meta)</span></label>
            <div className="flex gap-2">
              <input
                value={verifyToken}
                onChange={(e) => setVerifyToken(e.target.value)}
                placeholder="Type or generate a secret string…"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-[#5B6CF9]/40 focus:ring-2 focus:ring-[#5B6CF9]/10 font-mono"
              />
              <button
                type="button"
                onClick={generateVerifyToken}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[12px] font-medium text-slate-600 hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Generate
              </button>
              {verifyToken && (
                <button
                  type="button"
                  onClick={() => copyToClipboard(verifyToken)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[12px] font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy
                </button>
              )}
            </div>
            <p className="text-[10px] text-slate-400 mt-1">Any secret string. Must match exactly what you paste in Meta.</p>
          </div>

          {/* Instructions */}
          <div className="rounded-lg bg-[#EEF0FF] border border-[#5B6CF9]/15 p-3 text-[11px] text-[#4a5ce8] space-y-1">
            <p className="font-semibold">In Meta Developer Console:</p>
            <ol className="list-decimal list-inside space-y-0.5 text-[#5B6CF9]">
              <li>Go to your App → Webhooks</li>
              <li>Click <strong>Add Subscription</strong> → Instagram</li>
              <li>Paste the Webhook URL and Verify Token above</li>
              <li>Select fields: <code className="bg-[#5B6CF9]/10 px-1 rounded">messages</code>, <code className="bg-[#5B6CF9]/10 px-1 rounded">messaging_postbacks</code></li>
              <li>Click Verify and Save</li>
            </ol>
            <a
              href="https://developers.facebook.com/docs/messenger-platform/webhooks"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-1 text-[#5B6CF9] hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> Meta Webhooks docs
            </a>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-xl bg-[#5B6CF9] px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-[#4a5ce8] disabled:opacity-60 transition-colors"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save Settings
        </button>

        <button
          type="button"
          onClick={handleTest}
          disabled={testing || !cfg?.configured}
          className="flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-2.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          title={!cfg?.configured ? "Save your config first" : ""}
        >
          {testing
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <CheckCircle2 className="h-3.5 w-3.5" />
          }
          Test Connection
        </button>

        <button
          type="button"
          onClick={load}
          className="ml-auto flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2.5 text-[12px] text-slate-500 hover:bg-slate-50 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>
      </>
      )}
    </div>
  )
}
