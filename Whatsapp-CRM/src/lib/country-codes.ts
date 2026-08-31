/**
 * Common countries + their dial codes, for a two-part phone input
 * (country select + local number). Not the full ISO-3166 list — just
 * a practical set covering the regions this app's users are actually
 * in, with India first since that's the default audience.
 */
export interface CountryCode {
  iso: string;
  name: string;
  dial: string;
  flag: string;
}

export const COUNTRY_CODES: CountryCode[] = [
  { iso: "IN", name: "India", dial: "+91", flag: "🇮🇳" },
  { iso: "AE", name: "United Arab Emirates", dial: "+971", flag: "🇦🇪" },
  { iso: "SA", name: "Saudi Arabia", dial: "+966", flag: "🇸🇦" },
  { iso: "QA", name: "Qatar", dial: "+974", flag: "🇶🇦" },
  { iso: "KW", name: "Kuwait", dial: "+965", flag: "🇰🇼" },
  { iso: "OM", name: "Oman", dial: "+968", flag: "🇴🇲" },
  { iso: "BH", name: "Bahrain", dial: "+973", flag: "🇧🇭" },
  { iso: "US", name: "United States", dial: "+1", flag: "🇺🇸" },
  { iso: "CA", name: "Canada", dial: "+1", flag: "🇨🇦" },
  { iso: "GB", name: "United Kingdom", dial: "+44", flag: "🇬🇧" },
  { iso: "AU", name: "Australia", dial: "+61", flag: "🇦🇺" },
  { iso: "SG", name: "Singapore", dial: "+65", flag: "🇸🇬" },
  { iso: "MY", name: "Malaysia", dial: "+60", flag: "🇲🇾" },
  { iso: "NP", name: "Nepal", dial: "+977", flag: "🇳🇵" },
  { iso: "LK", name: "Sri Lanka", dial: "+94", flag: "🇱🇰" },
  { iso: "BD", name: "Bangladesh", dial: "+880", flag: "🇧🇩" },
  { iso: "PK", name: "Pakistan", dial: "+92", flag: "🇵🇰" },
  { iso: "DE", name: "Germany", dial: "+49", flag: "🇩🇪" },
  { iso: "FR", name: "France", dial: "+33", flag: "🇫🇷" },
  { iso: "IT", name: "Italy", dial: "+39", flag: "🇮🇹" },
  { iso: "ES", name: "Spain", dial: "+34", flag: "🇪🇸" },
  { iso: "NL", name: "Netherlands", dial: "+31", flag: "🇳🇱" },
  { iso: "ZA", name: "South Africa", dial: "+27", flag: "🇿🇦" },
  { iso: "NG", name: "Nigeria", dial: "+234", flag: "🇳🇬" },
  { iso: "KE", name: "Kenya", dial: "+254", flag: "🇰🇪" },
  { iso: "PH", name: "Philippines", dial: "+63", flag: "🇵🇭" },
  { iso: "ID", name: "Indonesia", dial: "+62", flag: "🇮🇩" },
  { iso: "TH", name: "Thailand", dial: "+66", flag: "🇹🇭" },
  { iso: "JP", name: "Japan", dial: "+81", flag: "🇯🇵" },
  { iso: "CN", name: "China", dial: "+86", flag: "🇨🇳" },
  { iso: "BR", name: "Brazil", dial: "+55", flag: "🇧🇷" },
  { iso: "MX", name: "Mexico", dial: "+52", flag: "🇲🇽" },
  { iso: "NZ", name: "New Zealand", dial: "+64", flag: "🇳🇿" },
];

export const DEFAULT_COUNTRY_ISO = "IN";

/**
 * Reverses the signup/profile combine step — splits a saved E.164 number
 * back into {iso, local} for editing in the two-part control. Tries dial
 * codes longest-first so a short code never shadows a longer one that
 * happens to start with the same digits. Ambiguous dial codes (US vs
 * Canada, both +1) resolve to whichever is listed first above.
 */
export function splitE164(phone: string): { iso: string; local: string } | null {
  if (!phone) return null;
  const byDialLengthDesc = [...COUNTRY_CODES].sort((a, b) => b.dial.length - a.dial.length);
  const match = byDialLengthDesc.find((c) => phone.startsWith(c.dial));
  if (!match) return null;
  return { iso: match.iso, local: phone.slice(match.dial.length) };
}
