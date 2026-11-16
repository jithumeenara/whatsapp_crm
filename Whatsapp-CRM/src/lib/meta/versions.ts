/**
 * Which Meta API version each kind of call uses — one place to move them.
 *
 * Meta retires Marketing API versions far sooner than Graph API versions
 * (checked 15 Nov 2026): Marketing API v21.0–v24.0 are already retired, so
 * ad reads, insights, Lead Ads, audiences and the Conversions API must use a
 * current version. v27.0 (released 4 Nov 2026) is the latest.
 * https://developers.facebook.com/documentation/ads-commerce/marketing-api/marketing-api-changelog
 *
 * Messaging and everything else on the Graph API (WhatsApp Cloud API,
 * Messenger, Instagram, Pages, Flows, Business Login) use GRAPH_API_VERSION.
 * v21.0 is removed on 21 January 2027 and v22.0 on 20 May 2027, so all of
 * it moved to v27.0 (16 Nov 2026).
 * https://developers.facebook.com/docs/graph-api/changelog
 */

export const GRAPH_API_VERSION = 'v27.0'

export const MARKETING_API_VERSION = 'v27.0'
export const MARKETING_API_BASE = `https://graph.facebook.com/${MARKETING_API_VERSION}`
