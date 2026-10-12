import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { accuracyPromptBlock, accuracyRulesFor, parseAccuracyRules, setAccuracyRules, suggestedTopics } from '@/lib/ai/accuracy-rules'
import { businessUnderstanding, formatCompanyBlock, loadCompanyProfile, resolveCategory } from '@/lib/ai/company-profile'

/**
 * The Accuracy tab's rules (lib/ai/accuracy-rules.ts), and what the
 * assistant knows about the business — the exact company text it reads
 * with every reply, and what is missing from it. Admin only.
 */

export const dynamic = 'force-dynamic'

async function view(accountId: string) {
  const [rules, profile] = await Promise.all([accuracyRulesFor(accountId), loadCompanyProfile(accountId).catch(() => null)])
  const category = profile ? resolveCategory(profile) : null
  return {
    rules,
    suggested_topics: suggestedTopics(category),
    category,
    understanding: businessUnderstanding(profile),
    company_block: formatCompanyBlock(profile, 'customer'),
    rules_block: accuracyPromptBlock(rules),
  }
}

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    return NextResponse.json(await view(ctx.accountId))
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await req.json().catch(() => null)) as { rules?: unknown } | null
    if (!body?.rules) return NextResponse.json({ error: 'rules is required.' }, { status: 400 })
    await setAccuracyRules(ctx.accountId, parseAccuracyRules(body.rules))
    return NextResponse.json(await view(ctx.accountId))
  } catch (err) {
    return toErrorResponse(err)
  }
}
