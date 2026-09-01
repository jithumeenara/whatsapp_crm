'use client'

import { Bell, BellOff, BellRing, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePushNotifications } from '@/hooks/use-push-notifications'
import { toast } from 'sonner'

const STATUS_STYLES: Record<string, { icon: typeof Bell; iconBg: string; iconColor: string }> = {
  unsupported: { icon: AlertCircle, iconBg: 'bg-amber-50', iconColor: 'text-amber-500' },
  denied: { icon: BellOff, iconBg: 'bg-rose-50', iconColor: 'text-rose-500' },
  default: { icon: Bell, iconBg: 'bg-slate-100', iconColor: 'text-slate-500' },
  subscribed: { icon: CheckCircle2, iconBg: 'bg-emerald-50', iconColor: 'text-emerald-500' },
}

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
    <div className="space-y-5">
      <div>
        <h2 className="text-[16px] font-semibold text-slate-900">Push Notifications</h2>
        <p className="text-[13px] text-slate-500 mt-0.5">
          Get browser push notifications for new conversations, assignments, follow-ups, and tasks —
          even when the CRM tab is in the background or closed.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
        {state === 'loading' && (
          <div className="flex items-center gap-3 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-[13px]">Checking notification status…</span>
          </div>
        )}

        {state !== 'loading' && (() => {
          const s = STATUS_STYLES[state] ?? STATUS_STYLES.default
          const Icon = s.icon
          return (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="flex items-start gap-3 flex-1">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${s.iconBg}`}>
                  <Icon className={`h-4.5 w-4.5 ${s.iconColor}`} />
                </span>
                <div>
                  {state === 'unsupported' && (
                    <>
                      <p className="text-[13.5px] font-semibold text-slate-800">Not supported</p>
                      <p className="text-[12.5px] text-slate-500 mt-0.5">Your browser doesn&apos;t support push notifications. Try Chrome, Edge, or Firefox.</p>
                    </>
                  )}
                  {state === 'denied' && (
                    <>
                      <p className="text-[13.5px] font-semibold text-slate-800">Notifications blocked</p>
                      <p className="text-[12.5px] text-slate-500 mt-0.5">Click the lock icon in your browser&apos;s address bar, allow notifications, then refresh the page.</p>
                    </>
                  )}
                  {state === 'default' && (
                    <>
                      <p className="text-[13.5px] font-semibold text-slate-800">Notifications off</p>
                      <p className="text-[12.5px] text-slate-500 mt-0.5">Get alerted instantly when a conversation is assigned to you, a follow-up is due, or a task needs attention.</p>
                    </>
                  )}
                  {state === 'subscribed' && (
                    <>
                      <p className="text-[13.5px] font-semibold text-slate-800">Notifications active</p>
                      <p className="text-[12.5px] text-slate-500 mt-0.5">You&apos;ll get push notifications for new assignments, overdue follow-ups, and urgent tasks on this browser.</p>
                    </>
                  )}
                </div>
              </div>
              {state === 'default' && (
                <Button onClick={handleSubscribe} className="h-9 px-4 text-[13px] shrink-0 bg-[#5B6CF9] hover:bg-[#4a5ce8] text-white">
                  <BellRing className="h-3.5 w-3.5" /> Enable Notifications
                </Button>
              )}
              {state === 'subscribed' && (
                <Button variant="outline" onClick={handleUnsubscribe} className="h-9 px-4 text-[13px] shrink-0 border-slate-200">
                  <BellOff className="h-3.5 w-3.5" /> Disable
                </Button>
              )}
            </div>
          )
        })()}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-2.5">
        <p className="text-[13px] font-semibold text-slate-800">You&apos;ll be notified when:</p>
        <ul className="space-y-2 text-[12.5px] text-slate-500">
          {[
            'A conversation is assigned to you by a manager or admin',
            'A chatbot auto-assigns a new incoming conversation to you',
            'A follow-up is due (upcoming feature)',
            'A high-priority task is assigned to you (upcoming feature)',
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#5B6CF9]" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[12.5px]">
        <p className="font-semibold text-amber-800 mb-1">Setup required (Admin)</p>
        <p className="text-amber-700">
          For push notifications to work, add VAPID keys to your{' '}
          <code className="bg-white/60 px-1 py-0.5 rounded text-[11.5px]">.env.local</code>.
          Go to <code className="bg-white/60 px-1 py-0.5 rounded text-[11.5px]">/api/push/vapid?generate=1</code> to generate keys,
          then add <code className="bg-white/60 px-1 py-0.5 rounded text-[11.5px]">VAPID_PUBLIC_KEY</code>,{' '}
          <code className="bg-white/60 px-1 py-0.5 rounded text-[11.5px]">VAPID_PRIVATE_KEY</code>, and{' '}
          <code className="bg-white/60 px-1 py-0.5 rounded text-[11.5px]">VAPID_SUBJECT</code> to your environment file.
        </p>
      </div>
    </div>
  )
}
