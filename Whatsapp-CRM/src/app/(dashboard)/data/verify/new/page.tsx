"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { EMPTY_SETTINGS, VerifySettings } from "@/components/verify/verify-settings"

export default function NewVerifyPage() {
  const router = useRouter()
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#F4F6FA]">
      <div className="border-b border-slate-200 bg-white px-4 sm:px-6">
        <div className="flex min-h-14 items-center gap-2.5 py-2">
          <Link href="/data/verify" aria-label="Back" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /></Link>
          <h1 className="text-[15px] font-semibold text-slate-900">New check</h1>
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
        <VerifySettings initial={EMPTY_SETTINGS} onSaved={(id) => router.push(id ? `/data/verify/${id}` : "/data/verify")} />
      </div>
    </div>
  )
}
