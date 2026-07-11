'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { useState, useEffect } from 'react'

// Vanute brand logo (inlined so it ships with the component and needs no
// binary asset in the repo). Quantised PNG, ~2.9KB.
const LOGO_SRC = 'data:image/png;base64,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'

export default function Nav() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()
  const [profile, setProfile] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      // Only the fields the nav needs (never the phone column, which is
      // protected at the database level).
      const { data: p } = await supabase.from('profiles').select('id, full_name, role').eq('id', data.user.id).single()
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
        <Link href="/" className="flex items-center shrink-0" aria-label="Vanute home">
          <img src={LOGO_SRC} alt="Vanute" className="h-11 w-auto" />
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
