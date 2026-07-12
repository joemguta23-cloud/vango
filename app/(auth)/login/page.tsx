'use client'
export const dynamic = 'force-dynamic'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import SocialAuthButtons from '@/components/SocialAuthButtons'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()
  const [form, setForm] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError('')
    const { data, error: err } = await supabase.auth.signInWithPassword(form)
    if (err) { setError(err.message); setLoading(false); return }
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', data.user.id).single()
    if (profile?.role === 'driver') router.push('/driver/dashboard')
    else if (profile?.role === 'admin') router.push('/admin')
    else router.push('/buyer/dashboard')
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <a href="/" className="flex justify-center mb-8">
          <img src="/vanute-logo.png" alt="Vanute" className="h-14 w-auto" />
        </a>
        <div className="card">
          <h1 className="text-2xl font-black mb-6">Log in</h1>

          <SocialAuthButtons />

          <div className="flex items-center gap-3 my-5">
            <div className="h-px bg-slate-200 flex-1" />
            <span className="text-xs text-slate-400">or with email</span>
            <div className="h-px bg-slate-200 flex-1" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <input className="input" type="email" placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
            <input className="input" type="password" placeholder="Password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full justify-center">{loading ? 'Logging in...' : 'Log in'}</button>
          </form>

          <p className="text-center text-sm mt-3">
            <Link href="/forgot-password" className="text-slate-500 hover:text-orange-500 hover:underline">Forgot your password?</Link>
          </p>
          <p className="text-center text-sm mt-2"><Link href="/signup" className="text-orange-500">Create account</Link></p>
        </div>
      </div>
    </div>
  )
}
