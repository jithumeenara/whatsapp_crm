import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false },
}

export default function AuthLayoutV2({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50">
      {children}
    </main>
  )
}
