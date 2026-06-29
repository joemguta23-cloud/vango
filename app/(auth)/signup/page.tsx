'use client'
export const dynamic = 'force-dynamic'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'

export default function SignupPage() {
  const router = useRouter()
  const params = useSearchParams()
  const presetRole = params.get('role') as 'buyer' | 'driver' || 'buyer'
  const [role, setRole] = useState<'buyer' | 'driver'>(presetRole)
  const [form, setForm] = useState({ full_name: '', phone: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createSupabaseBrowserClient()
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }))
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError('')
    const { data, error: err } = await supabase.auth.signUp({ email: form.email, password: form.password, options: { data: { full_name: form.full_name, phone: form.phone, role } } })
    if (err) { setError(err.message); setLoading(false); return }
    if (role === 'driver') router.push('/driver/onboard')
    else router.push('/buyer/post')
  }
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-md"><div className="card">
        <h1 className="text-2xl font-black mb-6">Create account</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input className="input" placeholder="Full name" value={form.full_name} onChange={set('full_name')} required />
          <input className="input" type="tel" placeholder="Phone" value={form.phone} onChange={set('phone')} required />
          <input className="input" type="email" placeholder="Email" value={form.email} onChange={set('email')} required />
          <input className="input" type="password" placeholder="Password" value={form.password} onChange={set('password')} minLength={8} required />
          {error && <p className="text-red-500">{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full justify-center">{`Create ${role} account`}</button>
        </form>
        <p className="text-center text-sm mt-4"><Link href="/login" className="text-orange-500">Log in</Link></p>
      </div></div>
    </div>
  )
}
