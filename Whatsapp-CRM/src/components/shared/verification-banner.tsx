"use client"

import Link from "next/link"
import { ShieldAlert, Mail, Phone } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"

/**
 * Shows on every login/Dashboard visit while the current user's own email
 * and/or WhatsApp number aren't verified — intentionally NOT dismissible
 * (no localStorage "hide this" flag), so it keeps surfacing until the
 * person actually verifies. Renders nothing once the profile is loaded and
 * both are verified (or the number was never added — that's optional).
 */
export function VerificationBanner() {
  const { profile, profileLoading } = useAuth()
  if (profileLoading || !profile) return null

  const missing: string[] = []
  if (!profile.email_verified) missing.push("email address")
  if (profile.phone && !profile.phone_verified) missing.push("WhatsApp number")
  if (missing.length === 0) return null

  return (
    <div className="mb-6 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="h-4.5 w-4.5 shrink-0 mt-0.5 text-amber-600" />
        <p className="text-[13px] text-amber-800">
          <span className="font-semibold">Verify your {missing.join(" and ")}</span> to keep your account secure.
        </p>
      </div>
      <Link
        href="/settings?tab=profile"
        className="flex shrink-0 items-center gap-1.5 self-start rounded-lg bg-amber-600 px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-amber-700 sm:self-auto"
      >
        {!profile.email_verified ? <Mail className="h-3.5 w-3.5" /> : <Phone className="h-3.5 w-3.5" />}
        Verify now
      </Link>
    </div>
  )
}
