import { describe, expect, it } from 'vitest'
import { conversationsStarted } from './insights'

// Meta's own count of messaging conversations its ads started, shown next
// to the chats that really arrived in the CRM (the two never match exactly).
describe('conversationsStarted', () => {
  it('reads the 7-day messaging conversations started action', () => {
    expect(conversationsStarted({ actions: [
      { action_type: 'link_click', value: '90' },
      { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '42' },
    ] })).toBe(42)
  })
  it('no such action is unknown, never zero', () => {
    expect(conversationsStarted({ actions: [{ action_type: 'link_click', value: '9' }] })).toBeNull()
    expect(conversationsStarted({})).toBeNull()
    expect(conversationsStarted(undefined)).toBeNull()
  })
  it('a malformed value is unknown', () => {
    expect(conversationsStarted({ actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: 'x' }] })).toBeNull()
    expect(conversationsStarted({ actions: 'nope' })).toBeNull()
  })
})
