import { describe, expect, it, vi } from 'vitest'
import { CHUNK_RELOAD_KEY, CHUNK_RELOAD_SCRIPT } from './chunk-reload'

type Listener = (e: unknown) => void

/** Runs the script against a fake page; returns how to fire events and what happened. */
function page(opts: { storage?: 'ok' | 'blocked'; now?: () => number } = {}) {
  const listeners: Record<string, Listener[]> = {}
  const store = new Map<string, string>()
  const reload = vi.fn()
  const sessionStorage = {
    getItem: (k: string) => {
      if (opts.storage === 'blocked') throw new Error('blocked')
      return store.get(k) ?? null
    },
    setItem: (k: string, v: string) => {
      if (opts.storage === 'blocked') throw new Error('blocked')
      store.set(k, v)
    },
  }
  const addEventListener = (type: string, fn: Listener) => { (listeners[type] ??= []).push(fn) }
  const DateFake = { now: opts.now ?? (() => 1_000_000) }
  new Function('addEventListener', 'sessionStorage', 'location', 'Date', CHUNK_RELOAD_SCRIPT)(
    addEventListener, sessionStorage, { reload }, DateFake,
  )
  const fire = (type: string, e: unknown) => listeners[type]?.forEach((fn) => fn(e))
  return { fire, reload, store }
}

const deadScript = { target: { tagName: 'SCRIPT', src: 'https://crm.example/_next/static/chunks/app-old.js' } }

describe('chunk reload guard', () => {
  it('reloads once when one of the app\'s own script files fails to load', () => {
    const p = page()
    p.fire('error', deadScript)
    expect(p.reload).toHaveBeenCalledTimes(1)
    expect(p.store.get(CHUNK_RELOAD_KEY)).toBe('1000000')
  })

  it('reloads on a ChunkLoadError from a lazy import', () => {
    const p = page()
    p.fire('unhandledrejection', { reason: { name: 'ChunkLoadError', message: 'Loading chunk 42 failed.' } })
    expect(p.reload).toHaveBeenCalledTimes(1)
  })

  it('never loops: a second failure within a minute does not reload again', () => {
    let t = 1_000_000
    const p = page({ now: () => t })
    p.fire('error', deadScript)
    t += 30_000
    p.fire('error', deadScript)
    expect(p.reload).toHaveBeenCalledTimes(1)
    t += 60_000
    p.fire('error', deadScript)
    expect(p.reload).toHaveBeenCalledTimes(2)
  })

  it('does not reload when the browser blocks storage (it could not remember trying)', () => {
    const p = page({ storage: 'blocked' })
    p.fire('error', deadScript)
    expect(p.reload).not.toHaveBeenCalled()
  })

  it('ignores other errors: third-party scripts, images, ordinary bugs', () => {
    const p = page()
    p.fire('error', { target: { tagName: 'SCRIPT', src: 'https://connect.facebook.net/sdk.js' } })
    p.fire('error', { target: { tagName: 'IMG', src: 'https://crm.example/_next/static/media/x.png' } })
    p.fire('error', { message: 'TypeError: x is undefined', target: {} })
    p.fire('unhandledrejection', { reason: new Error('Network request failed') })
    p.fire('unhandledrejection', { reason: null })
    expect(p.reload).not.toHaveBeenCalled()
  })
})
