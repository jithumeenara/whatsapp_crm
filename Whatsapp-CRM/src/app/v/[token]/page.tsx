import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { checkRateLimit } from '@/lib/rate-limit'
import { clientIpKey } from '@/lib/net/client-ip'
import { openLink, viewOf } from '@/lib/verify/verify-public'
import { verifyStrings } from '@/lib/verify/verify-strings'
import { VerifyView } from '@/components/verify/verify-view'

// Rendered per visit from the sheet (a read is kept 15 seconds; an answer
// always reads the row again before writing).
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: { absolute: 'Check your details' },
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

// Generous: many phones share one address on mobile networks.
const PER_IP = { limit: 200, windowMs: 10 * 60_000 }

export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const ip = clientIpKey(await headers())
  if (!checkRateLimit(`verify-view:${ip}`, PER_IP).success) {
    return <VerifyView mode="message" lang="en" business="" message={verifyStrings('en').tooMany} />
  }

  let link: Awaited<ReturnType<typeof openLink>>
  try {
    link = await openLink(token)
  } catch (err) {
    console.error('[verify-page] could not open:', err instanceof Error ? err.message : err)
    return <VerifyView mode="message" lang="en" business="" message={verifyStrings('en').error} retry />
  }

  if (link.kind === 'invalid') {
    return <VerifyView mode="message" lang="en" business="" message="This link is not valid. Please use the link in the message you were sent." />
  }
  const t = verifyStrings(link.lang)
  if (link.kind === 'closed') return <VerifyView mode="message" lang={link.lang} business={link.business} message={t.closed(link.business)} />
  if (link.kind === 'not_found' || link.kind === 'shared') return <VerifyView mode="message" lang={link.lang} business={link.business} message={t.notFound(link.business)} />

  return (
    <VerifyView
      mode="form"
      token={token}
      lang={link.lang}
      business={link.business}
      intro={link.v.intro}
      deadline={link.deadline}
      items={viewOf(link)}
      done={link.state === 'verified' || link.state === 'corrected' || link.state === 'phone'}
    />
  )
}
