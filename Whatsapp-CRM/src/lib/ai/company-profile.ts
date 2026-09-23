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

export async function loadCompanyProfile(accountId: string): Promise<CompanyProfileShape | null> {
  return prisma.companyProfile.findUnique({ where: { account_id: accountId } })
}
