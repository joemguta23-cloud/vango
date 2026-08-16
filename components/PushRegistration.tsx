'use client'
import { useEffect } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { registerUserPush } from '@/lib/push'

// Mounted once in the root layout so EVERY signed-in user -- buyer or driver
// -- registers for native push, not just drivers going Online. This is what
// lets a chat message (or any other buyer-facing alert) reach someone as a
// real push notification even when the app is backgrounded or the phone is
// locked, closing the gap where buyers previously had no push-token
// registration path at all. No-op on the web and for signed-out visitors.
export default function PushRegistration() {
  useEffect(() => {
    const supabase = createSupabaseBrowserClient()

    supabase.auth.getUser().then(({ data }) => {
      if (data.user) registerUserPush(data.user.id)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) registerUserPush(session.user.id)
    })

    return () => { sub.subscription.unsubscribe() }
  }, [])

  return null
}
