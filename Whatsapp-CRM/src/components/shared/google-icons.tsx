/**
 * Google product marks, drawn inline in Google's own colours, for the
 * places the CRM connects to them (Settings → Google, the sheet import).
 * Inline SVG: nothing is fetched from Google, and they stay sharp at any
 * size.
 */

type P = { className?: string }

export function GoogleSheetsIcon({ className = 'h-6 w-6' }: P) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#0F9D58" d="M29 3H11a4 4 0 0 0-4 4v34a4 4 0 0 0 4 4h26a4 4 0 0 0 4-4V15z" />
      <path fill="#87CEAC" d="M29 3v8a4 4 0 0 0 4 4h8z" />
      <path fill="#fff" d="M14 22h20v14H14zm2.5 2.5v3h6.25v-3zm8.75 0v3h6.25v-3zm-8.75 5.5v3.5h6.25V30zm8.75 0v3.5h6.25V30z" />
    </svg>
  )
}

export function GoogleDriveIcon({ className = 'h-6 w-6' }: P) {
  return (
    <svg viewBox="0 0 87.3 78" className={className} aria-hidden="true">
      <path fill="#0066DA" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" />
      <path fill="#00AC47" d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" />
      <path fill="#EA4335" d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" />
      <path fill="#00832D" d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" />
      <path fill="#2684FC" d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
      <path fill="#FFBA00" d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" />
    </svg>
  )
}

export function GmailIcon({ className = 'h-6 w-6' }: P) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#4CAF50" d="M45 16.2l-5 2.75-5 4.75V40h7a3 3 0 0 0 3-3z" />
      <path fill="#1E88E5" d="M3 16.2l3.614 1.71L13 23.7V40H6a3 3 0 0 1-3-3z" />
      <path fill="#E53935" d="M35 11.2 24 19.45 13 11.2 12 17l1 6.7 11 8.25 11-8.25L36 17z" />
      <path fill="#C62828" d="M3 12.298V16.2l10 7.5V11.2L9.876 8.859A4.298 4.298 0 0 0 3 12.298z" />
      <path fill="#FBC02D" d="M45 12.298V16.2l-10 7.5V11.2l3.124-2.341A4.298 4.298 0 0 1 45 12.298z" />
    </svg>
  )
}

export function GoogleCalendarIcon({ className = 'h-6 w-6' }: P) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <rect x="6" y="6" width="36" height="36" rx="5" fill="#fff" stroke="#4285F4" strokeWidth="3" />
      <path fill="#4285F4" d="M6 11a5 5 0 0 1 5-5h26a5 5 0 0 1 5 5v5H6z" />
      <path fill="#EA4335" d="M35 42h2a5 5 0 0 0 5-5v-2z" />
      <text x="24" y="36" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="15" fill="#1967D2">31</text>
    </svg>
  )
}

export function GoogleContactsIcon({ className = 'h-6 w-6' }: P) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <circle cx="24" cy="24" r="20" fill="#1A73E8" />
      <circle cx="24" cy="19" r="6.5" fill="#fff" />
      <path fill="#fff" d="M12.5 34.5c1.8-4.6 6.3-7.5 11.5-7.5s9.7 2.9 11.5 7.5A15.9 15.9 0 0 1 24 40a15.9 15.9 0 0 1-11.5-5.5z" />
    </svg>
  )
}

export function GoogleFormsIcon({ className = 'h-6 w-6' }: P) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#7248B9" d="M29 3H11a4 4 0 0 0-4 4v34a4 4 0 0 0 4 4h26a4 4 0 0 0 4-4V15z" />
      <path fill="#B9A2DC" d="M29 3v8a4 4 0 0 0 4 4h8z" />
      <circle cx="16.5" cy="23" r="2" fill="#fff" />
      <circle cx="16.5" cy="29.5" r="2" fill="#fff" />
      <circle cx="16.5" cy="36" r="2" fill="#fff" />
      <path fill="#fff" d="M21 21.75h12v2.5H21zm0 6.5h12v2.5H21zm0 6.5h12v2.5H21z" />
    </svg>
  )
}

export function GoogleBusinessIcon({ className = 'h-6 w-6' }: P) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#4285F4" d="M8 20h32v20a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z" />
      <path fill="#1A73E8" d="M6 10l3-5h30l3 5v6a5 5 0 0 1-9 3 5 5 0 0 1-9 0 5 5 0 0 1-9 0 5 5 0 0 1-9-3z" />
      <path fill="#fff" d="M28.5 30.2h6.3c.1.4.1.8.1 1.3 0 3.8-2.5 6.5-6.4 6.5a6.75 6.75 0 0 1 0-13.5c1.8 0 3.3.7 4.5 1.7l-1.9 1.8a3.9 3.9 0 0 0-2.6-1c-2.2 0-4 1.8-4 4.2s1.8 4.2 4 4.2c2 0 3.2-1.1 3.5-2.7h-3.5z" />
    </svg>
  )
}

/** The Google "G", for the account and the app. */
export function GoogleGIcon({ className = 'h-5 w-5' }: P) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A11.9 11.9 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}
