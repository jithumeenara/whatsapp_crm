/**
 * The business's own details, and how they reach a prompt.
 *
 * Category and section are pickers with an "Other" escape hatch, because
 * the alternative — forcing every account into a fixed list — produces
 * an AI that describes a driving school as an "educational institution"
 * and a diagnostic lab as "healthcare, other". The typed-in value is
 * used verbatim when the picker doesn't fit.
 */

import { prisma } from '@/lib/db'
import { onceSchemaPatch } from '@/lib/db/schema-patch'

/** Broad industries, chosen to cover what this CRM's accounts actually
 *  are rather than to be an exhaustive taxonomy. Anything outside the
 *  list is typed into the "Other" box, which is why the list can stay
 *  short. */
export const COMPANY_CATEGORIES = [
  'Education & Training',
  'Healthcare & Medical',
  'Retail & E-commerce',
  'Real Estate',
  'Travel & Hospitality',
  'Professional Services',
  'Manufacturing & Industrial',
  'Financial Services',
  'Automotive',
  'Beauty & Wellness',
  'Food & Beverage',
  'Events & Media',
  'Non-profit & Government',
  'Other',
] as const

/** Narrower lines of business per category. Same rule: 'Other' is always
 *  available and always means "use the typed value instead". */
export const COMPANY_SECTIONS: Record<string, string[]> = {
  'Education & Training': [
    'School', 'College / University', 'Coaching & Test Prep', 'Vocational & Skill Training',
    'Computer / IT Training', 'Driving School', 'Language Institute', 'Online Courses', 'Other',
  ],
  'Healthcare & Medical': [
    'Hospital', 'Clinic', 'Diagnostic Lab', 'Dental', 'Ayurveda / Alternative',
    'Pharmacy', 'Physiotherapy & Rehab', 'Veterinary', 'Other',
  ],
  'Retail & E-commerce': [
    'Clothing & Fashion', 'Electronics', 'Groceries & Supermarket', 'Furniture & Home',
    'Jewellery', 'Sports & Outdoors', 'Online Store', 'Other',
  ],
  'Real Estate': ['Residential Sales', 'Commercial', 'Rentals & Leasing', 'Property Management', 'Construction', 'Other'],
  'Travel & Hospitality': ['Hotel & Resort', 'Travel Agency', 'Tour Operator', 'Homestay', 'Restaurant', 'Event Venue', 'Other'],
  'Professional Services': ['Legal', 'Accounting & Tax', 'Consulting', 'Marketing Agency', 'IT Services', 'Recruitment', 'Other'],
  'Manufacturing & Industrial': ['Textiles', 'Food Processing', 'Machinery', 'Chemicals', 'Packaging', 'Other'],
  'Financial Services': ['Insurance', 'Loans & Mortgage', 'Investment & Wealth', 'Banking', 'Other'],
  Automotive: ['Dealership', 'Service & Repair', 'Spare Parts', 'Rentals', 'Other'],
  'Beauty & Wellness': ['Salon', 'Spa', 'Gym & Fitness', 'Yoga & Meditation', 'Cosmetics', 'Other'],
  'Food & Beverage': ['Restaurant', 'Cafe & Bakery', 'Catering', 'Cloud Kitchen', 'Other'],
  'Events & Media': ['Event Management', 'Photography & Video', 'Printing', 'Publishing', 'Other'],
  'Non-profit & Government': ['NGO / Charity', 'Trust & Foundation', 'Government Body', 'Other'],
  Other: ['Other'],
}

export interface CompanyProfileShape {
  legal_name?: string | null
  display_name?: string | null
  category?: string | null
  category_other?: string | null
  section?: string | null
  section_other?: string | null
  about?: string | null
  services?: string | null
  website?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  working_hours?: string | null
  languages?: string | null
  /** IANA zone the business runs on, from Settings → Business. Not part
   *  of the description the model is given — it is what turns a time
   *  somebody names into a moment. See lib/agents/zoned-time.ts. */
  timezone?: string | null
  /** Migration 128: what customers ask about most and the assistant
   *  must never guess. */
  payment_methods?: string | null
  service_area?: string | null
  policies?: string | null
  not_offered?: string | null
}

/** 'Other' in the picker means the real answer is in the free-text box;
 *  a stored value of 'Other' on its own tells the model nothing. */
export function resolveCategory(p: CompanyProfileShape): string | null {
  const value = p.category === 'Other' ? p.category_other : p.category
  return value?.trim() || null
}

export function resolveSection(p: CompanyProfileShape): string | null {
  const value = p.section === 'Other' ? p.section_other : p.section
  return value?.trim() || null
}

/**
 * Renders the profile as the company block that opens a prompt.
 *
 * `audience` changes the framing, not the facts: a customer-facing reply
 * is told "you work for this business, speak as them", while the admin
 * assistant is told "this is the business whose data you're reading".
 */
export function formatCompanyBlock(
  profile: CompanyProfileShape | null,
  audience: 'customer' | 'admin',
): string {
  if (!profile) return ''

  const name = profile.display_name?.trim() || profile.legal_name?.trim()
  const category = resolveCategory(profile)
  const section = resolveSection(profile)

  const lines: string[] = []
  if (name) lines.push(`Business name: ${name}`)
  if (category) lines.push(`Industry: ${category}${section ? ` — ${section}` : ''}`)
  if (profile.about?.trim()) lines.push(`About: ${profile.about.trim()}`)
  if (profile.services?.trim()) lines.push(`What they offer: ${profile.services.trim()}`)

  const place = [profile.address, profile.city, profile.state, profile.country]
    .map((v) => v?.trim())
    .filter(Boolean)
    .join(', ')
  if (place) lines.push(`Location: ${place}`)
  if (profile.working_hours?.trim()) lines.push(`Working hours: ${profile.working_hours.trim()}`)
  if (profile.languages?.trim()) lines.push(`Serves customers in: ${profile.languages.trim()}`)
  if (profile.service_area?.trim()) lines.push(`Areas served: ${profile.service_area.trim()}`)
  if (profile.payment_methods?.trim()) lines.push(`Payment methods accepted: ${profile.payment_methods.trim()}`)
  if (profile.policies?.trim()) lines.push(`Policies (refunds, cancellation, booking and the like — quote them, never improvise one): ${profile.policies.trim()}`)
  // Said plainly, because a model asked "do you also do X?" leans to yes.
  if (profile.not_offered?.trim()) lines.push(`NOT offered — say clearly the business does not do these: ${profile.not_offered.trim()}`)

  // Contact details are given to the customer-facing assistant only. The
  // admin assistant is talking to people who already work there.
  if (audience === 'customer') {
    if (profile.phone?.trim()) lines.push(`Phone: ${profile.phone.trim()}`)
    if (profile.email?.trim()) lines.push(`Email: ${profile.email.trim()}`)
    if (profile.website?.trim()) lines.push(`Website: ${profile.website.trim()}`)
  }

  if (lines.length === 0) return ''

  const header =
    audience === 'customer'
      ? 'ABOUT THE BUSINESS YOU WORK FOR (answer as a member of this team, never as a third party):'
      : 'ABOUT THIS BUSINESS (the account whose CRM data you are reading):'

  return `${header}\n${lines.join('\n')}`
}

/** Adds migration 128's columns if it has not run, once per process —
 *  Prisma reads every column, so a missing one would fail every reply. */
export function ensureCompanyProfileColumns(): Promise<void> {
  return onceSchemaPatch('company_profile_128', async () => {
    for (const col of ['payment_methods', 'service_area', 'policies', 'not_offered']) {
      await prisma.$executeRawUnsafe(`ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS ${col} TEXT`)
    }
  })
}

export async function loadCompanyProfile(accountId: string): Promise<CompanyProfileShape | null> {
  await ensureCompanyProfileColumns().catch(() => {})
  return prisma.companyProfile.findUnique({ where: { account_id: accountId } })
}

export interface UnderstandingItem {
  key: string
  label: string
  filled: boolean
  /** What the assistant cannot do while this is empty. */
  without: string
}

/**
 * What the assistant knows about the business, field by field, and what
 * each missing one costs. The Accuracy tab shows it beside the exact text
 * the assistant reads, so "is it using our details?" has an answer.
 */
export function businessUnderstanding(p: CompanyProfileShape | null): { items: UnderstandingItem[]; score: number } {
  const has = (v: string | null | undefined) => Boolean(v?.trim())
  const items: UnderstandingItem[] = [
    { key: 'display_name', label: 'Business name', filled: has(p?.display_name) || has(p?.legal_name), without: 'It cannot say who it speaks for.' },
    { key: 'category', label: 'Industry', filled: Boolean(p && resolveCategory(p)), without: 'It guesses what kind of business this is.' },
    { key: 'about', label: 'About the business', filled: has(p?.about), without: 'Questions like "what do you do?" get a vague answer.' },
    { key: 'services', label: 'Services / products', filled: has(p?.services), without: 'It cannot list what you offer without the knowledge base.' },
    { key: 'not_offered', label: 'What you do NOT offer', filled: has(p?.not_offered), without: 'Asked "do you also do…?", it may say yes.' },
    { key: 'working_hours', label: 'Working hours', filled: has(p?.working_hours), without: '"Are you open now?" has to be handed over.' },
    { key: 'address', label: 'Address / location', filled: has(p?.address) || has(p?.city), without: '"Where are you?" has to be handed over.' },
    { key: 'service_area', label: 'Areas served', filled: has(p?.service_area), without: '"Do you deliver / come to my place?" has to be handed over.' },
    { key: 'payment_methods', label: 'Payment methods', filled: has(p?.payment_methods), without: '"Can I pay by UPI / card?" has to be handed over.' },
    { key: 'policies', label: 'Policies', filled: has(p?.policies), without: 'Refund, cancellation and booking questions have to be handed over.' },
    { key: 'phone', label: 'Contact phone / email', filled: has(p?.phone) || has(p?.email), without: 'It cannot give a number or email to reach you.' },
    { key: 'timezone', label: 'Time zone', filled: has(p?.timezone), without: 'Dates and "tomorrow" are worked out in India time by default.' },
    { key: 'languages', label: 'Languages served', filled: has(p?.languages), without: 'It follows the customer\'s language with no list to check against.' },
  ]
  return { items, score: Math.round((items.filter((i) => i.filled).length / items.length) * 100) }
}
