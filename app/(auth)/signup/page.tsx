'use client'
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { REGIONS, DEFAULT_REGION } from '@/lib/regions'
import SocialAuthButtons from '@/components/SocialAuthButtons'

function SignupForm() {
  const router = useRouter()
  const params = useSearchParams()
  const defaultRole = (params.get('role')) || 'buyer'
  const [role, setRole] = useState(defaultRole)
  const [form, setForm] = useState({ full_name: '', phone: '', email: '', password: '', state: DEFAULT_REGION })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createSupabaseBrowserClient()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true); setError('')
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: form.email, password: form.password,
      options: { data: { full_name: form.full_name, phone: form.phone, role, state: form.state } },
    })
    if (signUpError) { setError(signUpError.message); setLoading(false); return }
    await new Promise(r => setTimeout(r, 800))
    router.push(role === 'driver' ? '/driver/onboard' : '/buyer/post')
  }

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div className="card">
      <h1 className="text-2xl font-black mb-1">Create your account</h1>
      <p className="text-slate-500 text-sm mb-6">Join Vanute — it's free</p>
      <div className="flex bg-slate-100 rounded-xl p-1 mb-6">
        {['buyer','driver'].map(r => (
          <button key={r} type="button" onClick={() => setRole(r)}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${role === r ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {r === 'buyer' ? '📦 I need delivery' : "🚐 I'm a driver"}
          </button>
        ))}
      </div>

      <SocialAuthButtons role={role} />

      <div className="flex items-center gap-3 my-5">
        <div className="h-px bg-slate-200 flex-1" />
        <span className="text-xs text-slate-400">or sign up with email</span>
        <div className="h-px bg-slate-200 flex-1" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div><label className="label">Full name</label><input className="input" type="text" placeholder="Your full name" value={form.full_name} onChange={set('full_name')} required /></div>
        <div><label className="label">Phone number</label><input className="input" type="tel" placeholder="04XX XXX XXX" value={form.phone} onChange={set('phone')} required /></div>
        <div><label className="label">Email</label><input className="input" type="email" placeholder="you@example.com" value={form.email} onChange={set('email')} required /></div>
        <div><label className="label">Password</label><input className="input" type="password" placeholder="Min. 8 characters" value={form.password} onChange={set('password')} minLength={8} required /></div>
        <div>
          <label className="label">State</label>
          <select className="input" value={form.state} onChange={set('state')}>
            {REGIONS.map(reg => (
              <option key={reg.code} value={reg.code} disabled={!reg.enabled}>
                {reg.name}{reg.enabled ? '' : ' — coming soon'}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-400 mt-1">Vanute currently operates in Victoria. More states are coming soon.</p>
        </div>
        {error && <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-3 text-base mt-2">
          {loading ? 'Creating account…' : `Create ${role} account →`}
        </button>
      </form>
      <p className="text-center text-sm text-slate-500 mt-4">
        Already have an account?{' '}
        <a href="/login" className="text-orange-500 font-semibold hover:underline">Log in</a>
      </p>
    </div>
  )
}

export default function SignupPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <a href="/" className="flex justify-center mb-8">
          <img src="/vanute-logo.png" alt="Vanute" className="h-14 w-auto" />
        </a>
        <Suspense fallback={<div className="card text-center py-8 text-slate-400">Loading…</div>}>
          <SignupForm />
        </Suspense>
        <p className="text-center text-xs text-slate-400 mt-4 px-4">
          By signing up you agree to Vanute's Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  )
}
