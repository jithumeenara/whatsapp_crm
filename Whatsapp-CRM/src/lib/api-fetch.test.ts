import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_TIMEOUT_MS, API_WRITE_TIMEOUT_MS, ApiError, OFFLINE_MESSAGE, TIMEOUT_MESSAGE, WRITE_TIMEOUT_MESSAGE, apiFetch } from './api-fetch'

/**
 * A screen must never spin for ever: on a dropped connection apiFetch
 * gives up with a message the catch shows, while a refusal from the
 * server and the caller's own cancel keep working as before.
 */
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

function hangingFetch() {
  return vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  }))
}

describe('apiFetch', () => {
  it('a server refusal still throws its own message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Lead already claimed' }, { status: 409 })))
    await expect(apiFetch('/api/x')).rejects.toMatchObject({ message: 'Lead already claimed', status: 409 })
  })

  it('a server that never answers gives up with a clear message', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', hangingFetch())
    const p = apiFetch('/api/x')
    const check = expect(p).rejects.toEqual(new ApiError(TIMEOUT_MESSAGE, 0))
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS + 5)
    await check
  })

  it('no network says so instead of a raw "Failed to fetch"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(apiFetch('/api/x')).rejects.toMatchObject({ message: OFFLINE_MESSAGE, status: 0 })
  })

  it("the caller's own cancel is passed through unchanged", async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const ctrl = new AbortController()
    const p = apiFetch('/api/x', { signal: ctrl.signal })
    ctrl.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('a save that times out says it may still finish, after a longer wait', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', hangingFetch())
    let err: unknown = null
    const p = apiFetch('/api/leads/bulk', { method: 'POST', body: '{}' }).catch((e) => { err = e })
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS + 5)
    expect(err).toBeNull()
    await vi.advanceTimersByTimeAsync(API_WRITE_TIMEOUT_MS)
    await p
    expect(err).toEqual(new ApiError(WRITE_TIMEOUT_MESSAGE, 0))
  })

  it('an upload gets longer than an ordinary call', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', hangingFetch())
    const body = new FormData()
    let failed = false
    const p = apiFetch('/api/upload', { method: 'POST', body }).catch(() => { failed = true })
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS + 5)
    expect(failed).toBe(false)
    await vi.advanceTimersByTimeAsync(120_000)
    await p
    expect(failed).toBe(true)
  })
})
