"use client"

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { signIn } from "next-auth/react"
import { MessageSquare, Eye, EyeOff, Lock, Mail, User, Phone } from "lucide-react"
import { COUNTRY_CODES, DEFAULT_COUNTRY_ISO } from "@/lib/country-codes"
import { CountryCodeSelect } from "@/components/shared/country-code-select"

function SignupContent() {
  const searchParams = useSearchParams()
  const inviteToken = searchParams.get("invite")
  const router = useRouter()

  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  // Two separate controls (country select, then local number) — combined
  // into one E.164 string only when actually submitting.
  const [countryIso, setCountryIso] = useState(DEFAULT_COUNTRY_ISO)
  const [localNumber, setLocalNumber] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPw, setConfirmPw] = useState("")
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirmPw) { setError("Passwords do not match"); return }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return }
    setLoading(true)
    // Combine the two controls into one E.164 string here, right before
    // sending — country code + digits-only local number. Left blank if
    // no local number was actually typed (the field is optional).
    const dialCode = COUNTRY_CODES.find((c) => c.iso === countryIso)?.dial ?? ""
    const digitsOnly = localNumber.replace(/\D/g, "")
    const phone = digitsOnly ? `${dialCode}${digitsOnly}` : ""
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, full_name: fullName, phone }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? "Registration failed"); setLoading(false); return }
    const result = await signIn("credentials", { email, password, redirect: false })
    if (result?.error) { setError("Account created but sign-in failed. Please go to login."); setLoading(false); return }
    router.push(inviteToken ? `/join/${encodeURIComponent(inviteToken)}` : "/dashboard")
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-slate-50">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 shadow-lg mb-3">
            <MessageSquare className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-[22px] font-bold text-slate-900">Create Account</h1>
          <p className="mt-1 text-[13px] text-slate-500">Start your WhatsApp CRM workspace</p>
        </div>

        <div className="rounded-2xl bg-white border border-slate-200 shadow-[0_4px_20px_rgba(0,0,0,0.08)] px-8 py-8">
          {error && (
            <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">Full Name</label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input type="text" placeholder="Your name" required value={fullName} onChange={(e) => setFullName(e.target.value)}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-[13px] text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100" />
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">
                  WhatsApp Number <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <CountryCodeSelect value={countryIso} onChange={setCountryIso} />
              </div>
              <div>
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="tel"
                    inputMode="numeric"
                    placeholder="98765 43210"
                    value={localNumber}
                    onChange={(e) => setLocalNumber(e.target.value)}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-[13px] text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-slate-400">Select your country, then enter the number without the country code.</p>
              </div>
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">Email</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input type="email" placeholder="email@company.com" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-[13px] text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100" />
              </div>
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">Password</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input type={showPw ? "text" : "password"} placeholder="Min. 6 characters" required value={password} onChange={(e) => setPassword(e.target.value)}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-11 text-[13px] text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100" />
                <button type="button" onClick={() => setShowPw(!showPw)} tabIndex={-1} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">Confirm Password</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input type={showPw ? "text" : "password"} placeholder="Repeat password" required value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-[13px] text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100" />
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="mt-2 h-11 w-full rounded-xl bg-indigo-600 text-[14px] font-semibold text-white shadow-sm transition-all hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-60">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />Creating account…
                </span>
              ) : "Create Account"}
            </button>
          </form>

          <p className="mt-6 text-center text-[12.5px] text-slate-500">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-indigo-600 hover:text-indigo-700">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default function SignupV2() {
  return (
    <Suspense fallback={null}>
      <SignupContent />
    </Suspense>
  )
}
