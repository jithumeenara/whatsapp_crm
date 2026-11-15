/**
 * Which Meta API version each kind of call uses — one place to move them.
 *
 * Meta retires Marketing API versions far sooner than Graph API versions
 * (checked 15 Nov 2026): Marketing API v21.0–v24.0 are already retired, so
 * ad reads, insights, Lead Ads, audiences and the Conversions API must use a
 * current version. v27.0 (released 4 Nov 2026) is the latest.
 * https://developers.facebook.com/documentation/ads-commerce/marketing-api/marketing-api-changelog
 *
 * Messaging (WhatsApp Cloud API, Messenger, Instagram) still runs on Graph
 * API v21.0, available until 21 January 2027; it must move before then.
 * https://developers.facebook.com/docs/graph-api/changelog
 */

export const MARKETING_API_VERSION = 'v27.0'
export const MARKETING_API_BASE = `https://graph.facebook.com/${MARKETING_API_VERSION}`
