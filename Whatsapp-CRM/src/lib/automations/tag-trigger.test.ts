import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('./meta-send', () => ({}))
vi.mock('@/lib/leads/create-from-automation', () => ({}))

import { triggerMatches } from './engine'
import type { Automation } from '@/types'

/**
 * "Tag added" automations name one tag. Found 18 Oct: the matcher let every
 * tag_added automation run whatever tag was added, so a "VIP added →
 * welcome" automation would have fired when "Cold lead" was added.
 */
const automation = (tagId: string) =>
  ({ trigger_type: 'tag_added', trigger_config: { tag_id: tagId } }) as unknown as Automation

describe('a "Tag added" automation', () => {
  it('runs when its own tag is added', () => {
    expect(triggerMatches(automation('vip'), { tag_id: 'vip' })).toBe(true)
  })

  it('does not run when a different tag is added', () => {
    expect(triggerMatches(automation('vip'), { tag_id: 'cold' })).toBe(false)
  })

  it('does not run when no tag is named', () => {
    expect(triggerMatches(automation('vip'), {})).toBe(false)
  })
})
