/**
 * What a connection can do, from the permissions Meta granted — in words
 * the owner understands. Pure.
 */

export type SocialChannelKey = 'facebook' | 'instagram'

const FEATURES: Record<SocialChannelKey, Array<{ key: string; label: string; any: string[] }>> = {
  facebook: [
    { key: 'messages', label: 'Messages', any: ['pages_messaging'] },
    { key: 'comments', label: 'Comments', any: ['pages_manage_engagement', 'pages_read_user_content'] },
    { key: 'insights', label: 'Insights', any: ['read_insights'] },
    { key: 'lead_ads', label: 'Lead Ads', any: ['leads_retrieval'] },
  ],
  instagram: [
    { key: 'messages', label: 'Messages', any: ['instagram_manage_messages', 'instagram_business_manage_messages'] },
    { key: 'comments', label: 'Comments', any: ['instagram_manage_comments', 'instagram_business_manage_comments'] },
    { key: 'insights', label: 'Insights', any: ['instagram_manage_insights', 'instagram_business_manage_insights'] },
    { key: 'publishing', label: 'Publishing', any: ['instagram_content_publish', 'instagram_business_content_publish'] },
  ],
}

export interface FeatureState { key: string; label: string; granted: boolean | null }

/** `scopes` null: unknown (a pasted token the app cannot inspect). */
export function featuresFor(channel: SocialChannelKey, scopes: string[] | null): FeatureState[] {
  return FEATURES[channel].map((f) => ({
    key: f.key,
    label: f.label,
    granted: scopes ? f.any.some((s) => scopes.includes(s)) : null,
  }))
}

/** Plain-language next steps for what is missing or wrong. */
export function hintsFor(channel: SocialChannelKey, input: {
  connected: boolean
  tokenValid: boolean | null
  features: FeatureState[]
  webhookFields: string[] | null
}): string[] {
  const hints: string[] = []
  const name = channel === 'facebook' ? 'Messenger' : 'Instagram'
  if (!input.connected) return [`${name} is not connected. Press Connect ${name}.`]
  if (input.tokenValid === false) hints.push(`The ${name} connection stopped working (the app was removed or the account moved). Press Reconnect.`)
  const messages = input.features.find((f) => f.key === 'messages')
  if (messages?.granted === false) hints.push(`Messages were not allowed. Press Reconnect and allow messaging for ${name}.`)
  if (input.webhookFields && !input.webhookFields.includes('messages')) {
    hints.push(`${name} is not sending new messages to this CRM yet. Press Reconnect to subscribe again.`)
  }
  if (channel === 'instagram') {
    hints.push('In the Instagram app, turn on Settings → Messages and story replies → Message controls → "Allow access to messages", or replies fail.')
  }
  return hints
}
