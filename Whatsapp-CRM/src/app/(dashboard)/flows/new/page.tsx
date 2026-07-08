"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"

/**
 * /flows/new — creates a blank flow via POST /api/flows then
 * immediately redirects to /flows/{id} for editing.
 * This prevents /flows/new from hitting the [id] dynamic route
 * with the literal string "new", which breaks Prisma UUID parsing.
 */
export default function NewFlowPage() {
  const router = useRouter()

  useEffect(() => {
    fetch("/api/flows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Untitled Flow" }) })
      .then((r) => r.json())
      .then((d) => {
        const id = d?.flow?.id ?? d?.id
        if (id) router.replace(`/flows/${id}`)
        else router.replace("/flows")
      })
      .catch(() => router.replace("/flows"))
  }, [router])

  return (
    <div className="flex h-full items-center justify-center bg-[#F4F6FA]">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
    </div>
  )
}
