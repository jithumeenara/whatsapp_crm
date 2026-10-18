// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

/**
 * Bug (18 Oct 2026): every component using useRealtime shares one socket,
 * and each one's cleanup sent "leave_account" on it — so the server took
 * the shared socket out of the account's room the moment ANY of them
 * unmounted (opening a chat, a dialog closing). The socket stayed
 * connected, so nothing reconnected or resynced: the Inbox, the
 * incoming-call popup and the alerts all silently stopped getting live
 * updates (blue ticks, replies) until the page was reloaded.
 */

const h = vi.hoisted(() => ({
  emitted: [] as unknown[][],
  socket: null as null | Record<string, unknown>,
}))

vi.mock('@/lib/realtime-client', () => ({
  connectAccountSocket: () => {
    const listeners = new Map<string, Set<(...a: unknown[]) => void>>()
    h.socket = {
      connected: true,
      emit: (...a: unknown[]) => { h.emitted.push(a) },
      on: (ev: string, fn: (...a: unknown[]) => void) => { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev)!.add(fn) },
      off: (ev: string, fn: (...a: unknown[]) => void) => { listeners.get(ev)?.delete(fn) },
      listeners,
    }
    return h.socket
  },
}))
vi.mock('./use-auth', () => ({ useAuth: () => ({ accountId: 'acc-1' }) }))

import { useRealtime } from './use-realtime'

function Listener({ name }: { name: string }) {
  useRealtime({ channelName: name, onMessageEvent: () => {} })
  return null
}

describe('one shared live connection', () => {
  it('stays in the account room when one of its listeners goes away', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const a = createRoot(document.createElement('div'))
    const b = createRoot(document.createElement('div'))
    await act(async () => { a.render(createElement(Listener, { name: 'inbox' })) })
    await act(async () => { b.render(createElement(Listener, { name: 'call-popup' })) })

    await act(async () => { b.unmount() }) // e.g. a panel closing while the Inbox stays open

    expect(h.emitted.filter((e) => e[0] === 'leave_account')).toEqual([])
    // The Inbox's listener is still attached.
    const messageListeners = (h.socket!.listeners as Map<string, Set<unknown>>).get('message')
    expect(messageListeners?.size).toBe(1)
    await act(async () => { a.unmount() })
  })
})
