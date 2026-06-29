'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { useState, useEffect } from 'react'
import type { Profile } from '@/types'

export default function Nav() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()
  const [profile, setProfile] = useState<Profile | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      const { data: p } = await supabase
        .from('profiles').select('*').eq('id', data.user.id).single()
      setProfile(p)
    })
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <nav className="fixed top-0 inset-x-0 z-50 bg-white/95 backdrop-blur border-b border-slate-200 h-16 flex items-center px-6 justify-between">
      <Link href="/" className="flex items-center gap-2 font-black text-xl text-slate-800">
        <span className="w-9 h-9 bg-orange-500 rounded-lg flex items-center justify-center text-lg">🚐</span>
        Van<span className="text-orange-500">Go</span>
      </Link>

      <div className="flex items-center gap-3">
        {profile ? (
          <>
            {profile.role === 'buyer' && (
              <Link href="/buyer/post" className="btn-primary py-2 px-4 text-sm">📦 Post a Job</Link>
            )}
            {profile.role === 'driver' && (
              <Link href="/driver/dashboard" className="btn-primary py-2 px-4 text-sm">🚐 My Jobs</Link>
            )}
            {profile.role === 'admin' && (
              <Link href="/admin" className="btn-secondary py-2 px-4 text-sm">⚙️ Admin</Link>
            )}
            <button onClick={signOut} className="btn-secondary py-2 px-4 text-sm">Sign out</button>
          </>
        ) : (
          <>
            <Link href="/login" className="btn-secondary py-2 px-4 text-sm">Log in</Link>
            <Link href="/signup" className="btn-primary py-2 px-4 text-sm">Get started</Link>
          </>
        )}
      </div>
    </nav>
  )
}
