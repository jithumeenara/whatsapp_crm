'use client'

import { Bell, BellOff, BellRing, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePushNotifications } from '@/hooks/use-push-notifications'
import { toast } from 'sonner'

export function NotificationsPanel() {
  const { state, subscribe, unsubscribe } = usePushNotifications()

  const handleSubscribe = async () => {
    await subscribe()
    if (state !== 'denied') toast.success('Push notifications enabled!')
  }

  const handleUnsubscribe = async () => {
    await unsubscribe()
    toast.success('Push notifications disabled')
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Push Notifications</h2>
        <p className="text-sm text-slate-500 mt-1">
          Receive browser push notifications when you get new conversations, assignments, follow-ups, and tasks —
          even when the CRM tab is in the background or closed.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        {state === 'loading' && (
          <div className="flex items-center gap-3 text-slate-500">
            <Loader2 className="size-5 animate-spin" />
            <span className="text-sm">Checking notification status…</span>
          </div>
        )}

        {state === 'unsupported' && (
          <div className="flex items-start gap-3">
            <AlertCircle className="size-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-slate-800">Not supported</p>
              <p className="text-sm text-slate-500 mt-0.5">
                Your browser does not support push notifications. Try using Chrome, Edge, or Firefox.
              </p>
            </div>
          </div>
        )}

        {state === 'denied' && (
          <div className="flex items-start gap-3">
            <BellOff className="size-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-slate-800">Notifications blocked</p>
              <p className="text-sm text-slate-500 mt-0.5">
                You have blocked notifications for this site. To enable them, click the lock icon in your browser&apos;s
                address bar and allow notifications, then refresh the page.
              </p>
            </div>
          </div>
        )}

        {state === 'default' && (
          <div className="flex items-start gap-4">
            <div className="flex items-start gap-3 flex-1">
              <Bell className="size-5 text-slate-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-slate-800">Notifications off</p>
                <p className="text-sm text-slate-500 mt-0.5">
                  Enable push notifications to be alerted instantly when a conversation is assigned to you,
                  a follow-up is due, or a task needs attention.
                </p>
              </div>
            </div>
            <Button onClick={handleSubscribe} className="shrink-0 gap-2">
              <BellRing className="size-4" /> Enable Notifications
            </Button>
          </div>
        )}

        {state === 'subscribed' && (
          <div className="flex items-start gap-4">
            <div className="flex items-start gap-3 flex-1">
              <CheckCircle2 className="size-5 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-slate-800">Notifications active</p>
                <p className="text-sm text-slate-500 mt-0.5">
                  You will receive push notifications for new conversation assignments, overdue follow-ups,
                  and urgent tasks — on this browser and device.
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={handleUnsubscribe} className="shrink-0 gap-2">
              <BellOff className="size-4" /> Disable
            </Button>
          </div>
        )}
      </div>

      {/* What triggers notifications */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 space-y-3">
        <p className="text-sm font-medium text-slate-800">You will be notified when:</p>
        <ul className="space-y-2 text-sm text-slate-500">
          {[
            'A conversation is assigned to you by a manager or admin',
            'A chatbot auto-assigns a new incoming conversation to you',
            'A follow-up is due (upcoming feature)',
            'A high-priority task is assigned to you (upcoming feature)',
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="mt-1.5 size-1.5 rounded-full bg-primary shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* VAPID setup note for owner */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium text-amber-700 dark:text-amber-400 mb-1">Setup required (Admin)</p>
        <p className="text-slate-500">
          For push notifications to work, you need to add VAPID keys to your{' '}
          <code className="bg-slate-100 px-1 rounded text-xs">.env.local</code>.
          Go to <code className="bg-slate-100 px-1 rounded text-xs">/api/push/vapid?generate=1</code> to generate keys,
          then add <code className="bg-slate-100 px-1 rounded text-xs">VAPID_PUBLIC_KEY</code>,{' '}
          <code className="bg-slate-100 px-1 rounded text-xs">VAPID_PRIVATE_KEY</code>, and{' '}
          <code className="bg-slate-100 px-1 rounded text-xs">VAPID_SUBJECT</code> to your environment file.
        </p>
      </div>
    </div>
  )
}
