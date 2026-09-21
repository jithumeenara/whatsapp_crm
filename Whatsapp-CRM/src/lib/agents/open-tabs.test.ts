import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newTabId, touchTab, releaseTab, TAB_TOUCH_MS } from './open-tabs'

/** A localStorage that behaves like the real one, including throwing. */
function fakeStorage() {
  const map = new Map<string, string>()
  return {
    blocked: false,
    getItem(k: string) {
      if (this.blocked) throw new Error('storage is blocked')
      return map.get(k) ?? null
    },
    setItem(k: string, v: string) {
      if (this.blocked) throw new Error('storage is blocked')
      map.set(k, v)
    },
    raw: map,
  }
}

let store: ReturnType<typeof fakeStorage>

beforeEach(() => {
  store = fakeStorage()
  vi.stubGlobal('window', { localStorage: store })
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-20T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the last window out', () => {
  it('says so when there was only ever one tab', () => {
    const a = newTabId()
    touchTab(a)
    expect(releaseTab(a)).toBe(true)
  })

  it('stays quiet while another tab is still open', () => {
    // The failure this exists to prevent: an agent with the Inbox in one
    // tab and Leads in another closes one, and the app announces they
    // have left while they sit looking at the other.
    const inbox = newTabId()
    const leads = newTabId()
    touchTab(inbox)
    touchTab(leads)

    expect(releaseTab(inbox)).toBe(false)
    expect(releaseTab(leads)).toBe(true)
  })

  it('gives every tab a name of its own', () => {
    expect(newTabId()).not.toBe(newTabId())
  })
})

describe('tabs that never said goodbye', () => {
  it('ignores one that stopped reporting, so the farewell is not blocked forever', () => {
    // A crashed tab, a killed browser, a phone that ran out of battery.
    // A counter would sit at 1 for good and nothing would ever correct
    // it; a timestamp ages out on its own.
    const crashed = newTabId()
    touchTab(crashed)

    vi.advanceTimersByTime(4 * TAB_TOUCH_MS)

    const live = newTabId()
    touchTab(live)
    expect(releaseTab(live)).toBe(true)
  })

  it('keeps counting a tab that is still reporting', () => {
    const reader = newTabId()
    const other = newTabId()
    touchTab(reader)
    touchTab(other)

    // Somebody reading a long conversation without touching anything.
    // The registry ticks on a timer, not on activity, which is the whole
    // reason it is separate from the heartbeat.
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(TAB_TOUCH_MS)
      touchTab(reader)
    }

    expect(releaseTab(other)).toBe(false)
  })
})

describe('when the browser refuses to store anything', () => {
  it('assumes it is the only tab, because being early beats being silent', () => {
    // A private window, or site data turned off. Without the registry
    // there is no way to know about other tabs. Marking somebody offline
    // a minute early costs one heartbeat; saying nothing costs eleven
    // minutes of showing an agent who has gone home.
    store.blocked = true
    expect(releaseTab(newTabId())).toBe(true)
  })

  it('does not throw while recording a tab it cannot store', () => {
    store.blocked = true
    expect(() => touchTab(newTabId())).not.toThrow()
  })

  it('survives a registry that has been corrupted by something else', () => {
    store.raw.set('crm.open-tabs', 'not json')
    const a = newTabId()
    touchTab(a)
    expect(releaseTab(a)).toBe(true)
  })
})
