'use client'

import { useEffect, useState, useCallback } from 'react'

type PushState = 'unsupported' | 'denied' | 'default' | 'subscribed' | 'loading'

export function usePushNotifications() {
  const [state, setState] = useState<PushState>('loading')
  const [subscription, setSubscription] = useState<PushSubscription | null>(null)

  const getState = useCallback(async (): Promise<PushState> => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported'
    const perm = Notification.permission
    if (perm === 'denied') return 'denied'
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      setSubscription(sub)
      return 'subscribed'
    }
    return 'default'
  }, [])

  useEffect(() => {
    getState().then(setState).catch(() => setState('unsupported'))
  }, [getState])

  const subscribe = useCallback(async () => {
    setState('loading')
    try {
      // Register service worker
      await navigator.serviceWorker.register('/sw.js')
      const reg = await navigator.serviceWorker.ready

      // Get VAPID public key
      const res = await fetch('/api/push/vapid')
      const { publicKey } = await res.json() as { publicKey: string | null }
      if (!publicKey) throw new Error('Push not configured (VAPID keys missing)')

      // Request permission
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState('denied')
        return
      }

      // Subscribe
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as ArrayBuffer,
      })
      setSubscription(sub)

      // Save to server
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })

      setState('subscribed')
    } catch (err) {
      console.error('Push subscribe failed:', err)
      setState(await getState())
    }
  }, [getState])

  const unsubscribe = useCallback(async () => {
    if (!subscription) return
    setState('loading')
    try {
      await fetch('/api/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      })
      await subscription.unsubscribe()
      setSubscription(null)
      setState('default')
    } catch {
      setState(await getState())
    }
  }, [subscription, getState])

  return { state, subscribe, unsubscribe }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}
