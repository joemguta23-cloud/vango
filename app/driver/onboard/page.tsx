'use client'
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
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }))
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { error: err } = await supabase.from('drivers').insert({ user_id: user.id, ...form, is_online: false })
    if (err) { setError(err.message); setLoading(false); return }
    router.push('/driver/dashboard')
  }
  return (
    <div><Nav />
      <div className="max-w-lg mx-auto px-4 pt-24 pb-12">
        <h1 className="text-2xl font-black mb-6">Set up your driver profile</h1>
        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="label">Vehicle type</label>
            <div className="flex gap-2">
              {([['ute','Ute'],['van','Van'],['truck','Truck']] as const).map(([k,l]) => (
                <button key={k} type="button" onClick={() => setForm(f => ({ ...f, vehicle_type: k }))}
                  className={`flex-1 border-2 rounded-xl py-3 text-sm font-semibold ${form.vehicle_type===k?'bg-orange-50 border-orange-500":'bg-white border-slate-200'}`}>{l}</button>
              ))}
            </div>
            <input className="input" placeholder="Make (e.g. Ford)" value={form.vehicle_make} onChange={set('vehicle_make')} required />
            <input className="input" placeholder="Model (e.g. Transit)" value={form.vehicle_model} onChange={set('vehicle_model')} required />
            <input className="input" placeholder="Number plate" value={form.vehicle_plate} onChange={set('vehicle_plate')} required />
            {error && <p className="text-red-500">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full justify-center">{loading?'Saving...':'Start accepting jobs →'}</button>
          </form>
        </div>
      </div>
    </div>
  )
}
