import { describe, expect, it } from 'vitest'
import { clearEmailDrafts } from './local-drafts'

function memoryStorage(initial: Record<string, string>) {
  const map = new Map(Object.entries(initial))
  return {
    get length() { return map.size },
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => { map.delete(k) },
    map,
  }
}

describe('clearEmailDrafts', () => {
  it('removes every email draft and nothing else', () => {
    const s = memoryStorage({
      'email-draft:v1:a': '{"text":"customer pii"}',
      'email-draft:v1:b': '{}',
      'leads-view': 'tiles',
      'crm-theme': 'dark',
    })
    clearEmailDrafts(s)
    expect([...s.map.keys()].sort()).toEqual(['crm-theme', 'leads-view'])
  })

  it('does nothing without storage', () => {
    expect(() => clearEmailDrafts(null)).not.toThrow()
  })
})
