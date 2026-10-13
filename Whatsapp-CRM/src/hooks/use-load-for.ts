'use client'

/**
 * Data loaded for a key — a table id, a contact id, a number of days —
 * with "loading" worked out rather than set.
 *
 * The usual way, setLoading(true) at the top of an effect, renders twice
 * for every change (once loading, once not) and is what React's
 * set-state-in-effect rule exists to stop. Here the result remembers the
 * key it was loaded for: while the key in hand is not that one, it is
 * loading, and the previous key's data is never shown for the new key.
 * Only the newest request may answer (a quick switch between two tables
 * never shows the slower one's fields).
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export function useLoadFor<T>(
  key: string | number | null | undefined,
  load: (key: string) => Promise<T>,
  empty: T,
): { data: T; loading: boolean; reload: () => void; setData: (update: (prev: T) => T) => void } {
  const k = key === null || key === undefined || key === '' ? null : String(key)
  const [state, setState] = useState<{ key: string | null; data: T; nonce: number }>({ key: null, data: empty, nonce: 0 })
  const [nonce, setNonce] = useState(0)
  const loadRef = useRef(load)
  const emptyRef = useRef(empty)
  useEffect(() => {
    loadRef.current = load
    emptyRef.current = empty
  })

  useEffect(() => {
    if (k === null) return
    let live = true
    loadRef
      .current(k)
      .then((data) => {
        if (live) setState({ key: k, data, nonce })
      })
      .catch((err) => {
        console.error('[useLoadFor] load failed:', err)
        if (live) setState({ key: k, data: emptyRef.current, nonce })
      })
    return () => {
      live = false
    }
  }, [k, nonce])

  const ready = k !== null && state.key === k && state.nonce === nonce
  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const setData = useCallback((update: (prev: T) => T) => setState((s) => ({ ...s, data: update(s.data) })), [])
  return { data: k !== null && state.key === k ? state.data : empty, loading: k !== null && !ready, reload, setData }
}
