'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'

type Prefs = {
  push_enabled: boolean
  sms_enabled: boolean
  email_enabled: boolean
}

const DEFAULTS: Prefs = { push_enabled: true, sms_enabled: true, email_enabled: true }

const CHANNELS: { key: keyof Prefs; icon: string; label: string; hint: string }[] = [
  {
    key: 'push_enabled',
    icon: '📲',
    label: 'App notifications',
    hint: 'A banner on your phone the moment a job is posted - even if you are in another app or your screen is locked. This is the fastest way to win jobs.',
  },
  {
    key: 'sms_enabled',
    icon: '💬',
    label: 'Text message (SMS)',
    hint: 'A text to your mobile. Useful as a backup if you often have notifications muted.',
  },
  {
    key: 'email_enabled',
    icon: '✉️',
    label: 'Email',
    hint: 'An email to your account address. Slowest of the three - most drivers leave this on but rely on the banner.',
  },
]

export default function DriverNotificationsPage() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()

  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<keyof Prefs | null>(null)
  const [error, setError] = useState('')
  const [savedAt, setSavedAt] = useState(0)

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.replace('/login')
        return
      }
      const { data, error: err } = await supabase
        .from('drivers')
        .select('push_enabled, sms_enabled, email_enabled')
        .eq('user_id', user.id)
        .maybeSingle()

      if (!active) return
      if (err) setError('Could not load your settings. Pull down to retry.')
      if (data) {
        setPrefs({
          push_enabled: data.push_enabled !== false,
          sms_enabled: data.sms_enabled !== false,
          email_enabled: data.email_enabled !== false,
        })
      }
      setLoading(false)
    })()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = async (key: keyof Prefs) => {
    const next = { ...prefs, [key]: !prefs[key] }
    setPrefs(next) // optimistic
    setSaving(key)
    setError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.replace('/login')
      return
    }

    const { error: err } = await supabase
      .from('drivers')
      .update({ [key]: next[key] })
      .eq('user_id', user.id)

    setSaving(null)
    if (err) {
      setPrefs(prefs) // roll back
      setError('Could not save that change. Check your connection and try again.')
      return
    }
    setSavedAt(Date.now())
  }

  const allOff = !prefs.push_enabled && !prefs.sms_enabled && !prefs.email_enabled

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="w-full max-w-lg mx-auto">
        <Link href="/driver/dashboard" className="text-sm text-slate-500 hover:text-slate-700">
          &larr; Back to dashboard
        </Link>

        <h1 className="text-2xl font-black mt-4 mb-1">Job alerts</h1>
        <p className="text-slate-500 text-sm mb-6">
          Choose how you hear about new jobs. You can have all three, or any combination.
          These only apply while you are Online.
        </p>

        {loading ? (
          <div className="card text-center py-10 text-slate-400">Loading your settings…</div>
        ) : (
          <div className="card divide-y divide-slate-100">
            {CHANNELS.map(ch => (
              <div key={ch.key} className="py-4 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="font-semibold text-slate-800">
                      <span className="mr-2">{ch.icon}</span>
                      {ch.label}
                    </p>
                    <p className="text-slate-500 text-sm mt-1">{ch.hint}</p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={prefs[ch.key]}
                    aria-label={ch.label}
                    disabled={saving === ch.key}
                    onClick={() => toggle(ch.key)}
                    className={`relative w-14 h-8 rounded-full transition-colors shrink-0 disabled:opacity-50 ${
                      prefs[ch.key] ? 'bg-orange-500' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow transition-transform ${
                        prefs[ch.key] ? 'translate-x-6' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {allOff && !loading && (
          <p className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 mt-4">
            ⚠️ All alerts are off. You will stay Online but you will not be told when a job is
            posted - you would have to open the app and check manually.
          </p>
        )}

        {error && (
          <p className="text-sm bg-red-50 border border-red-200 text-red-600 rounded-lg px-3 py-2 mt-4">
            {error}
          </p>
        )}

        {savedAt > 0 && !error && (
          <p className="text-sm text-green-600 mt-4">Saved.</p>
        )}

        <p className="text-xs text-slate-400 mt-6">
          Going Offline stops all job alerts regardless of these settings.
        </p>
      </div>
    </div>
  )
}
