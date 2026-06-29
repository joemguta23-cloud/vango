'use client'
import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'

function SignupForm() {
  const router = useRouter()
  const params = useSearchParams()
  const defaultRole = (params.get('role') as 'buyer' | 'driver') || 'buyer'
  const [role, setRole] = useState<'buyer' | 'driver'>(defaultRole)
  const [form, setForm] = useState({ full_name: '', phone: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createSupabaseBrowserClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error: signUpError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: { full_name: form.full_name, phone: form.phone, role } },
    })
    if (signUpError) { setError(signUpError.message); setLoading(false); return }
    router.push(role === 'driver' ? '/driver/onboard' : '/buyer/post')
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <Link href="/" className="flex items-center gap-2 font-black text-xl text-slate-800 mb-8 justify-center">
          <span className="w-9 h-9 bg-orange-500 rounded-lg flex items-center justify-center text-lg">&#x1F690;</span>
          Van<span className="text-orange-500">Go</span>
        </Link>
        <div className="card">
          <h1 className="text-2xl font-black mb-1">Create your account</h1>
          <p className="text-slate-500 text-sm mb-6">Join VanGo - it&apos;s free</p>
          <div className="flex bg-slate-100 rounded-xl p-1 mb-6">
            {(['buyer','driver'] as const).map(r => (
              <button key={r} type="button" onClick={() => setRole(r)}
                className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${role === r ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {r === 'buyer' ? 'I need delivery' : "I'm a driver"}
              </button>
            ))}
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div><label className="label">Full name</label>
              <input className="input" type="text" placeholder="Your full name" value={form.full_name} onChange={set('full_name')} required /></div>
            <div><label className="label">Phone number</label>
              <input className="input" type="tel" placeholder="04XX XXX XXX" value={form.phone} onChange={set('phone')} required /></div>
            <div><label className="label">Email</label>
              <input className="input" type="email" placeholder="you@example.com" value={form.email} onChange={set('email')} required /></div>
            <div><label className="label">Password</label>
              <input className="input" type="password" placeholder="Min. 8 characters" value={form.password} onChange={set('password')} minLength={8} required /></div>
            {error && <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-3 text-base mt-2">
              {loading ? 'Creating account...' : `Create ${role} account`}
            </button>
          </form>
          <p className="text-center text-sm text-slate-500 mt-4">
            Already have an account?{' '}
            <Link href="/login" className="text-orange-500 font-semibold hover:underline">Log in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <SignupForm />
    </Suspense>
  )
}
