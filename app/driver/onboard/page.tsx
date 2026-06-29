'use client'
export const dynamic = 'force-dynamic'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import { createSupabaseBrowserClient } from '@/lib/supabase'

export default function DriverOnboardPage() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()
  const [form, setForm] = useState({
    vehicle_type: 'van' as 'ute' | 'van' | 'truck',
    vehicle_make: '', vehicle_model: '', vehicle_plate: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { error: err } = await supabase.from('drivers').insert({
      user_id: user.id,
      ...form,
      is_online: false,
    })

    if (err) { setError(err.message); setLoading(false); return }
    router.push('/driver/dashboard')
  }

  const VEHICLES = [
    { key: 'ute' as const, label: 'Ute' },
    { key: 'van' as const, label: 'Van' },
    { key: 'truck' as const, label: 'Truck' },
  ]

  return (
    <div>
      <Nav />
      <div className="max-w-lg mx-auto px-4 pt-24 pb-12">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">&#x1F690;</div>
          <h1 className="text-2xl font-black mb-2">Set up your driver profile</h1>
          <p className="text-slate-500 text-sm">Tell us about your vehicle so buyers know what&apos;s coming</p>
        </div>

        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Vehicle type *</label>
              <div className="flex gap-2.5">
                {VEHICLES.map(({ key, label }) => (
                  <button key={key} type="button" onClick={() => setForm(f => ({ ...f, vehicle_type: key }))}
                    className={`flex-1 border-2 rounded-xl py-3 text-sm font-semibold transition-all ${
                      form.vehicle_type === key ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 bg-white text-slate-600 hover:border-orange-300'
                    }`}>{label}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Make (brand) *</label>
              <input className="input" placeholder="e.g. Ford, Toyota, Mitsubishi"
                value={form.vehicle_make} onChange={set('vehicle_make')} required />
            </div>
            <div>
              <label className="label">Model *</label>
              <input className="input" placeholder="e.g. Transit, HiAce, Express"
                value={form.vehicle_model} onChange={set('vehicle_model')} required />
            </div>
            <div>
              <label className="label">Number plate *</label>
              <input className="input" placeholder="e.g. ABC 123" style={{textTransform:'uppercase'}}
                value={form.vehicle_plate} onChange={set('vehicle_plate')} required />
            </div>

            {error && <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-3 text-base mt-2">
              {loading ? 'Saving...' : 'Start accepting jobs'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
