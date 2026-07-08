'use client'
export const dynamic = 'force-dynamic'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'

// Where the OAuth providers redirect back to. The Supabase browser client
// automatically picks up the session from the URL (detectSessionInUrl), then
// we route the user by role. New OAuth users are created as 'buyer' by the
// handle_new_user trigger; a driver who signed up via the driver toggle is
// upgraded through the server route below.
function Callback() {
  const router = useRouter()
  const params = useSearchParams()
  const supabase = createSupabaseBrowserClient()
  const [message] = useState('Signing you in…')

  useEffect(() => {
    const run = async () => {
      // Wait for the session to be parsed from the URL, retrying briefly.
      let session: any = null
      for (let i = 0; i < 24 && !session; i++) {
        const { data } = await supabase.auth.getSession()
        session = data.session
        if (!session) await new Promise(r => setTimeout(r, 250))
      }
      if (!session?.user) { router.replace('/login?error=oauth'); return }
      const user = session.user

      // The handle_new_user trigger creates the profile automatically; retry a
      // few times in case it hasn't committed the instant we arrive.
      let profile: any = null
      for (let i = 0; i < 8 && !profile; i++) {
        const { data } = await supabase.from('profiles').select('id, full_name, role').eq('id', user.id).maybeSingle()
        profile = data
        if (!profile) await new Promise(r => setTimeout(r, 250))
      }

      // If they chose "I'm a driver" at signup but the profile defaulted to
      // buyer, flip the role via the server (clients can't set role directly).
      const wantRole = params.get('role')
      if (wantRole === 'driver' && profile && profile.role !== 'driver' && profile.role !== 'admin') {
        try {
          await fetch('/api/auth/set-role', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: session.access_token, role: 'driver' }),
          })
          profile.role = 'driver'
        } catch { /* fall through to buyer routing */ }
      }

      const role = profile?.role ?? 'buyer'
      if (role === 'admin') { router.replace('/admin'); return }
      if (role === 'driver') {
        const { data: drv } = await supabase.from('drivers').select('id').eq('user_id', user.id).maybeSingle()
        router.replace(drv ? '/driver/dashboard' : '/driver/onboard')
        return
      }
      router.replace('/buyer/dashboard')
    }
    run()
  }, [])

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="text-center">
        <div className="text-5xl mb-3 animate-bounce">🚐</div>
        <p className="text-slate-500 text-sm">{message}</p>
      </div>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-400">Signing you in…</div>}>
      <Callback />
    </Suspense>
  )
}
