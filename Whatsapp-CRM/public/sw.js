// Service Worker for WhatsApp CRM Push Notifications

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'New Notification', body: event.data.text() }
  }

  const title = payload.title ?? 'WhatsApp CRM'
  const options = {
    body: payload.body ?? '',
    icon: '/image.png',
    badge: '/image.png',
    tag: payload.tag ?? 'crm-notification',
    data: payload.data ?? {},
    requireInteraction: false,
    actions: payload.data?.conversationId
      ? [{ action: 'open', title: 'Open' }]
      : [],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const data = event.notification.data ?? {}
  let url = '/'

  if (data.type === 'assignment' && data.conversationId) {
    url = `/inbox`
  } else if (data.type === 'follow_up') {
    url = '/follow-ups'
  } else if (data.type === 'task') {
    url = '/tasks'
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.focus()
          client.postMessage({ type: 'navigate', url })
          return
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
