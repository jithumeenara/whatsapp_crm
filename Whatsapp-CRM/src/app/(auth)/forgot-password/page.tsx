import Link from "next/link"
import { MessageSquare, KeyRound, ArrowLeft } from "lucide-react"

/**
 * There is no reset-by-email on this server: the form here used to post to
 * /api/auth/forgot-password, which does not exist, and every attempt ended
 * in an error. A password is reset by the workspace's administrator —
 * Settings → Members (a new password for a phone-number login), or by the
 * owner for an admin. Say that plainly instead of offering a form that
 * cannot work.
 */
export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-slate-50">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 shadow-lg mb-3">
            <MessageSquare className="h-6 w-6 text-white" aria-hidden="true" />
          </div>
          <h1 className="text-[22px] font-bold text-slate-900">Forgot password</h1>
        </div>

        <div className="rounded-2xl bg-white border border-slate-200 shadow-[0_4px_20px_rgba(0,0,0,0.08)] px-8 py-8">
          <div className="flex flex-col items-center text-center gap-3 py-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50">
              <KeyRound className="h-6 w-6 text-indigo-600" aria-hidden="true" />
            </div>
            <p className="text-[14px] font-semibold text-slate-900">Ask your administrator to reset your password</p>
            <p className="text-[13px] text-slate-500">
              Passwords on this workspace are reset by its administrator. Once they give you a new one, sign in
              with it and change it from your profile.
            </p>
            <Link
              href="/login"
              className="mt-3 flex items-center gap-1.5 text-[13px] text-indigo-600 font-medium hover:text-indigo-700"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
