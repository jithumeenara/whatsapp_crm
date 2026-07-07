"use client"

import { useState } from "react"
import Link from "next/link"
import { MessageSquare, Mail, ArrowLeft, CheckCircle } from "lucide-react"

export default function ForgotPasswordV2() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? "Failed to send reset email")
      }
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-slate-50">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 shadow-lg mb-3">
            <MessageSquare className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-[22px] font-bold text-slate-900">Forgot Password</h1>
          <p className="mt-1 text-[13px] text-slate-500">Enter your email to receive a reset link</p>
        </div>

        <div className="rounded-2xl bg-white border border-slate-200 shadow-[0_4px_20px_rgba(0,0,0,0.08)] px-8 py-8">
          {sent ? (
            <div className="flex flex-col items-center text-center gap-3 py-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
                <CheckCircle className="h-6 w-6 text-emerald-600" />
              </div>
              <p className="text-[14px] font-semibold text-slate-900">Check your inbox</p>
              <p className="text-[13px] text-slate-500">A reset link was sent to <strong>{email}</strong></p>
              <Link href="/login" className="mt-3 flex items-center gap-1.5 text-[13px] text-indigo-600 font-medium hover:text-indigo-700">
                <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
              </Link>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error}</div>
              )}
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">Email Address</label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input type="email" placeholder="email@company.com" required value={email} onChange={(e) => setEmail(e.target.value)}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-[13px] text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100" />
                  </div>
                </div>
                <button type="submit" disabled={loading}
                  className="h-11 w-full rounded-xl bg-indigo-600 text-[14px] font-semibold text-white hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-60 transition-all">
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />Sending…
                    </span>
                  ) : "Send Reset Link"}
                </button>
              </form>
              <div className="mt-5 text-center">
                <Link href="/login" className="flex items-center justify-center gap-1.5 text-[13px] text-slate-500 hover:text-indigo-600">
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
