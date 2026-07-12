'use client'
export const dynamic = 'force-dynamic'
import { useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'

export default function ForgotPasswordPage() {
  const supabase = createSupabaseBrowserClient()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError('')
    const redirectTo = `${window.location.origin}/reset-password`
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
    setLoading(false)
    if (err) { setError(err.message); return }
    setSent(true)
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <a href="/" className="flex justify-center mb-8">
          <img src="/vanute-logo.png" alt="Vanute" className="h-14 w-auto" />
        </a>
        <div className="card">
          <h1 className="text-2xl font-black mb-2">Reset your password</h1>

          {sent ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                If an account exists for <strong>{email.trim()}</strong>, we&apos;ve sent a link to reset your
                password. Check your inbox (and your spam folder) and click the link to choose a new password.
              </p>
              <Link href="/login" className="btn-primary w-full justify-center">Back to log in</Link>
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-500 mb-6">
                Enter the email you signed up with and we&apos;ll send you a link to set a new password.
              </p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <input
                  className="input"
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
                {error && <p className="text-red-500 text-sm">{error}</p>}
                <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
                  {loading ? 'Sending...' : 'Send reset link'}
                </button>
              </form>
              <p className="text-center text-sm mt-4">
                <Link href="/login" className="text-orange-500">Back to log in</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
