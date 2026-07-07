import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "WhatsApp CRM",
  robots: { index: false },
}

export default function AuthLayoutV2({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      {children}
    </div>
  )
}
