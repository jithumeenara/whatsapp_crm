"use client"

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { signIn } from "next-auth/react"
import { MessageSquare, Eye, EyeOff, Lock, Mail, ShieldCheck, ArrowLeft, KeyRound, Clock } from "lucide-react"

type Step = "credentials" | "mfa"
type MfaMethod = "sms" | "whatsapp" | "totp"

const MFA_LABEL: Record<MfaMethod, string> = {
  sms: "Enter the code we texted you",
  whatsapp: "Enter the code we sent on WhatsApp",
  totp: "Enter the 6-digit code from your authenticator app",
}

function LoginContent() {
  const searchParams = useSearchParams()
  const inviteToken = searchParams.get("invite")
  const idleLogout = searchParams.get("reason") === "idle"
  const router = useRouter()

  const [step, setStep] = useState<Step>("credentials")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // MFA step state
  const [mfaMethod, setMfaMethod] = useState<MfaMethod | null>(null)
  const [maskedPhone, setMaskedPhone] = useState<string | undefined>(undefined)
  const [challengeId, setChallengeId] = useState("")
  const [code, setCode] = useState("")
  const [resending, setResending] = useState(false)

  function goToDestination() {
    router.push(inviteToken ? `/join/${encodeURIComponent(inviteToken)}` : "/dashboard")
  }

  async function handleCredentialsSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch("/api/auth/mfa/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || "Invalid email or password")
        return
      }
      if (!data.mfaRequired) {
        // No MFA configured — sign in the same way this always has.
        const result = await signIn("credentials", { email, password, redirect: false })
        if (result?.error) { setError("Invalid email or password"); return }
        goToDestination()
        return
      }
      setMfaMethod(data.method)
      setMaskedPhone(data.maskedPhone)
      setChallengeId(data.challengeId)
      setStep("mfa")
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const verifyRes = await fetch("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, code }),
      })
      const verifyData = await verifyRes.json().catch(() => ({}))
      if (!verifyRes.ok) {
        setError(verifyData?.error || "Incorrect code")
        return
      }
      const result = await signIn("credentials", { email, password, challengeId, redirect: false })
      if (result?.error) { setError("Sign-in failed — try again."); return }
      goToDestination()
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    if (mfaMethod === "totp") return
    setResending(true)
    setError(null)
    try {
      const res = await fetch("/api/auth/mfa/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data?.error || "Failed to resend code"); return }
      setChallengeId(data.challengeId)
      setCode("")
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-slate-50">
      <div className="w-full max-w-[400px]">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 shadow-lg mb-3">
            <MessageSquare className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-[22px] font-bold text-slate-900">WhatsApp CRM</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            {inviteToken ? "Sign in to accept your invitation" : "Sign in to your workspace"}
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl bg-white border border-slate-200 shadow-[0_4px_20px_rgba(0,0,0,0.08)] px-8 py-8">
          {idleLogout && !error && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-700">
              <Clock className="h-4 w-4 shrink-0 mt-0.5" />
              <span>You were signed out after 10 minutes of inactivity — sign back in to continue.</span>
            </div>
          )}
          {error && (
            <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">
              {error}
            </div>
          )}

          {step === "credentials" ? (
            <form onSubmit={handleCredentialsSubmit} className="space-y-5">
              <div>
                <label htmlFor="email" className="block text-[12px] font-semibold text-slate-600 mb-1.5">Email / Phone</label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="email"
                    type="text"
                    autoComplete="username"
                    placeholder="email@company.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-[13px] text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="password" className="block text-[12px] font-semibold text-slate-600">Password</label>
                  <Link href="/forgot-password" className="text-[12px] text-indigo-600 hover:text-indigo-700 font-medium">Forgot?</Link>
                </div>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="password"
                    type={showPw ? "text" : "password"}
                    placeholder="••••••••"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-11 text-[13px] text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                  />
                  <button type="button" onClick={() => setShowPw(!showPw)} tabIndex={-1} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-1 h-11 w-full rounded-xl bg-indigo-600 text-[14px] font-semibold text-white shadow-sm transition-all hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-60"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Signing in…
                  </span>
                ) : "Sign In"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleMfaSubmit} className="space-y-5">
              <div className="flex flex-col items-center text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-100 mb-2">
                  <ShieldCheck className="h-5 w-5 text-indigo-600" />
                </div>
                <p className="text-[14px] font-semibold text-slate-800">Two-factor verification</p>
                <p className="mt-0.5 text-[12.5px] text-slate-500">
                  {mfaMethod ? MFA_LABEL[mfaMethod] : ""}
                  {maskedPhone && <> to <span className="font-medium text-slate-700">{maskedPhone}</span></>}
                </p>
              </div>

              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-center text-[18px] tracking-[0.3em] text-slate-900 placeholder:tracking-normal placeholder:text-slate-400 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="h-11 w-full rounded-xl bg-indigo-600 text-[14px] font-semibold text-white shadow-sm transition-all hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-60"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Verifying…
                  </span>
                ) : "Verify & Sign In"}
              </button>

              <div className="flex items-center justify-between">
                <button type="button" onClick={() => { setStep("credentials"); setCode(""); setError(null) }}
                  className="flex items-center gap-1 text-[12px] font-medium text-slate-500 hover:text-slate-700">
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
                {mfaMethod !== "totp" && (
                  <button type="button" onClick={handleResend} disabled={resending}
                    className="text-[12px] font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-60">
                    {resending ? "Sending…" : "Resend code"}
                  </button>
                )}
              </div>
            </form>
          )}

          {step === "credentials" && (
            <p className="mt-6 text-center text-[12.5px] text-slate-500">
              Don&apos;t have an account?{" "}
              <Link href={inviteToken ? `/signup?invite=${encodeURIComponent(inviteToken)}` : "/signup"} className="font-semibold text-indigo-600 hover:text-indigo-700">
                Create account
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export default function LoginV2() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  )
}
