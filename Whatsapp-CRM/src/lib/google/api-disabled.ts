/**
 * "<Some> API has not been used in project N before or it is disabled."
 *
 * Every Google service the CRM talks to has to be switched on, once, in
 * the business's own Google Cloud project. Google's error says so and
 * carries the exact page to do it on; this keeps that link instead of
 * telling the person to go and find it.
 */

const API_IDS: Record<string, string> = {
  'Google Drive API': 'drive.googleapis.com',
  'Google Sheets API': 'sheets.googleapis.com',
  'Gmail API': 'gmail.googleapis.com',
  'Google Calendar API': 'calendar-json.googleapis.com',
  'Google People API': 'people.googleapis.com',
  'Google Forms API': 'forms.googleapis.com',
}

export interface DisabledApi {
  api: string
  /** The Google Cloud page with the Enable button for this API. */
  enableUrl: string
}

export function isApiDisabled(googleMessage: string): boolean {
  return /has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(googleMessage)
}

export function disabledApi(googleMessage: string, api: string): DisabledApi {
  const project = /project[ =](\d{5,})/i.exec(googleMessage)?.[1]
  const id = API_IDS[api]
  const fromGoogle = /https:\/\/console\.(?:developers|cloud)\.google\.com\/apis\/api\/[^\s"')]+/.exec(googleMessage)?.[0]
  const enableUrl = id
    ? `https://console.cloud.google.com/apis/library/${id}${project ? `?project=${project}` : ''}`
    : (fromGoogle ?? 'https://console.cloud.google.com/apis/library')
  return { api, enableUrl }
}

/** The sentence to show where only text can be shown (a toast, a log). */
export function disabledApiMessage(d: DisabledApi): string {
  return `The ${d.api} is switched off in your Google Cloud project. Turn it on at ${d.enableUrl} and try again (it takes about a minute).`
}
