'use client'
export const dynamic = 'force-dynamic'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'

export default function ResetPasswordPage() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()
  const [ready, setReady] = useState(false)
  const [validLink, setValidLink] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    let mounted = true

    // React to the PASSWORD_RECOVERY / SIGNED_IN event that fires when the
    // Supabase client parses the recovery tokens from the link URL.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      if (session) { setValidLink(true); setReady(true) }
    })

    const init = async () => {
      // PKCE-style links carry a ?code= that must be exchanged for a session.
      const code = new URL(window.location.href).searchParams.get('code')
      if (code) { try { await supabase.auth.exchangeCodeForSession(code) } catch { /* handled below */ } }
      const { data } = await supabase.auth.getSession()
      if (!mounted) return
      setValidLink(!!data.session)
      setReady(true)
    }
    init()

    return () => { mounted = false; sub.subscription.unsubscribe() }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('')
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setLoading(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (err) { setError(err.message); return }
    setDone(true)
    setTimeout(() => router.push('/login'), 2500)
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <a href="/" className="flex justify-center mb-8">
          <img src="/vanute-logo.png" alt="Vanute" className="h-14 w-auto" />
        </a>
        <div className="card">
          <h1 className="text-2xl font-black mb-6">Choose a new password</h1>

          {!ready ? (
            <p className="text-sm text-slate-500">Checking your reset link&hellip;</p>
          ) : done ? (
            <div className="space-y-4">
              <p className="text-sm text-green-600">
                Your password has been updated. Redirecting you to log in&hellip;
              </p>
              <Link href="/login" className="btn-primary w-full justify-center">Go to log in</Link>
            </div>
          ) : !validLink ? (
            <div className="space-y-4">
              <p className="text-sm text-red-500">
                This reset link is invalid or has expired. Please request a new one.
              </p>
              <Link href="/forgot-password" className="btn-primary w-full justify-center">Request a new link</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                className="input"
                type="password"
                placeholder="New password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
              <input
                className="input"
                type="password"
                placeholder="Confirm new password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
              />
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
                {loading ? 'Updating…' : 'Update password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
