'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { useState, useEffect } from 'react'

export default function Nav() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()
  const [profile, setProfile] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      const { data: p } = await supabase.from('profiles').select('*').eq('id', data.user.id).single()
      setProfile(p)
    })
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
    setMenuOpen(false)
    router.push('/')
  }

  return (
    <nav className="fixed top-0 inset-x-0 z-50 bg-white/95 backdrop-blur border-b border-slate-200 h-16">
      <div className="max-w-6xl mx-auto h-full flex items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-black text-xl text-slate-800 shrink-0">
          <span className="w-9 h-9 bg-orange-500 rounded-lg flex items-center justify-center text-lg">🚐</span>
          <span>Van<span className="text-orange-500">Go</span></span>
        </Link>

        {/* Desktop */}
        <div className="hidden sm:flex items-center gap-3">
          {profile ? (
            <>
              {profile.role === 'buyer' && (
                <>
                  <Link href="/buyer/dashboard" className="btn-secondary py-2 px-4 text-sm">📋 My Jobs</Link>
                  <Link href="/buyer/post" className="btn-primary py-2 px-4 text-sm">📦 Post a Job</Link>
                </>
              )}
              {profile.role === 'driver' && <Link href="/driver/dashboard" className="btn-primary py-2 px-4 text-sm">🚐 My Jobs</Link>}
              {profile.role === 'admin' && <Link href="/admin" className="btn-secondary py-2 px-4 text-sm">⚙️ Admin</Link>}
              <Link href="/settings" className="btn-secondary py-2 px-4 text-sm">⚙️ Settings</Link>
              <button onClick={signOut} className="btn-secondary py-2 px-4 text-sm">Sign out</button>
            </>
          ) : (
            <>
              <Link href="/login" className="btn-secondary py-2 px-4 text-sm">Log in</Link>
              <Link href="/signup" className="btn-primary py-2 px-4 text-sm">Get started</Link>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <button className="sm:hidden flex flex-col gap-1.5 p-2 rounded-lg hover:bg-slate-100 transition-colors" onClick={() => setMenuOpen(o => !o)} aria-label="Menu">
          <span className={`block w-5 h-0.5 bg-slate-700 transition-all duration-200 ${menuOpen ? 'rotate-45 translate-y-2' : ''}`} />
          <span className={`block w-5 h-0.5 bg-slate-700 transition-all duration-200 ${menuOpen ? 'opacity-0' : ''}`} />
          <span className={`block w-5 h-0.5 bg-slate-700 transition-all duration-200 ${menuOpen ? '-rotate-45 -translate-y-2' : ''}`} />
        </button>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="sm:hidden absolute top-16 inset-x-0 bg-white border-b border-slate-200 shadow-lg px-4 py-4 flex flex-col gap-3">
          {profile ? (
            <>
              {profile.role === 'buyer' && (
                <>
                  <Link href="/buyer/dashboard" onClick={() => setMenuOpen(false)} className="btn-secondary justify-center">📋 My Jobs</Link>
                  <Link href="/buyer/post" onClick={() => setMenuOpen(false)} className="btn-primary justify-center">📦 Post a Job</Link>
                </>
              )}
              {profile.role === 'driver' && <Link href="/driver/dashboard" onClick={() => setMenuOpen(false)} className="btn-primary justify-center">🚐 My Jobs</Link>}
              {profile.role === 'admin' && <Link href="/admin" onClick={() => setMenuOpen(false)} className="btn-secondary justify-center">⚙️ Admin</Link>}
              <Link href="/settings" onClick={() => setMenuOpen(false)} className="btn-secondary justify-center">⚙️ Settings</Link>
              <button onClick={signOut} className="btn-secondary justify-center">Sign out</button>
            </>
          ) : (
            <>
              <Link href="/login" onClick={() => setMenuOpen(false)} className="btn-secondary justify-center">Log in</Link>
              <Link href="/signup" onClick={() => setMenuOpen(false)} className="btn-primary justify-center">Get started</Link>
            </>
          )}
        </div>
      )}
    </nav>
  )
}
