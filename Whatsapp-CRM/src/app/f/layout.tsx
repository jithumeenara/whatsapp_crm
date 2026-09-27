import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// The form's token is in the URL. no-referrer keeps it out of the
// Referer header of anything the page might ever load, and the page is
// kept out of search engines — a form link is shared on purpose, not
// found.
export const metadata: Metadata = {
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
}

export default function PublicFormLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-slate-50">{children}</div>
}
