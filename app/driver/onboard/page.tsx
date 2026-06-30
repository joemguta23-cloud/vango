'use client'
export const dynamic = 'force-dynamic'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import { createSupabaseBrowserClient } from '@/lib/supabase'

type Step = 'vehicle' | 'identity' | 'payments'

export default function DriverOnboardPage() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()
  const [step, setStep] = useState<Step>('vehicle')
  const [driverId, setDriverId] = useState('')
  const [form, setForm] = useState({
    vehicle_type: 'van' as 'ute' | 'van' | 'truck',
    vehicle_make: '', vehicle_model: '', vehicle_plate: '',
    abn: '', license_number: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleVehicleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data, error: err } = await supabase.from('drivers').insert({
      user_id: user.id,
      vehicle_type: form.vehicle_type,
      vehicle_make: form.vehicle_make,
      vehicle_model: form.vehicle_model,
      vehicle_plate: form.vehicle_plate,
      is_online: false,
    }).select('id').single()

    if (err) { setError(err.message); setLoading(false); return }
    setDriverId(data.id)
    setStep('identity')
    setLoading(false)
  }

  const handleIdentitySubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError('')
    await supabase.from('drivers').update({ abn: form.abn, license_number: form.license_number }).eq('id', driverId)
    setStep('payments')
    setLoading(false)
  }

  const handleStripeConnect = async () => {
    setLoading(true); setError('')
    const { data: { user } } = await supabase.auth.getUser()
    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user!.id).single()

    const accR = await fetch('/api/stripe/connect/create-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId, email: user!.email, fullName: profile?.full_name }),
    })
    const { accountId, error: accErr } = await accR.json()
    if (accErr) { setError(accErr); setLoading(false); return }

    const linkR = await fetch('/api/stripe/connect/account-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, driverId }),
    })
    const { url, error: linkErr } = await linkR.json()
    if (linkErr) { setError(linkErr); setLoading(false); return }
    window.location.href = url
  }

  const steps = [
    { id: 'vehicle', label: 'Vehicle' },
    { id: 'identity', label: 'Identity' },
    { id: 'payments', label: 'Payments' },
  ]

  return (
    <div>
      <Nav />
      <div className="max-w-lg mx-auto px-4 pt-24 pb-12">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">ð</div>
          <h1 className="text-2xl font-black mb-2">Set up your driver profile</h1>
          <p className="text-slate-500 text-sm">3 quick steps to start earning</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {steps.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                step === s.id ? 'bg-orange-500 text-white' :
                steps.findIndex(x => x.id === step) > i ? 'bg-green-500 text-white' :
                'bg-slate-200 text-slate-500'
              }`}>{steps.findIndex(x => x.id === step) > i ? 'â' : i + 1}</div>
              <span className={`text-sm ${step === s.id ? 'font-semibold text-orange-600' : 'text-slate-400'}`}>{s.label}</span>
              {i < steps.length - 1 && <div className="w-8 h-0.5 bg-slate-200 mx-1" />}
            </div>
          ))}
        </div>

        <div className="card">
          {step === 'vehicle' && (
            <form onSubmit={handleVehicleSubmit} className="space-y-4">
              <h2 className="font-bold text-lg">Your vehicle</h2>
              <div>
                <label className="label">Vehicle type *</label>
                <div className="flex gap-2.5">
                  {([['ute','ð» Ute'],['van','ð Van'],['truck','ð Truck']] as const).map(([k,l]) => (
                    <button key={k} type="button" onClick={() => setForm(f => ({ ...f, vehicle_type: k }))}
                      className={`flex-1 border-2 rounded-xl py-3 text-sm font-semibold transition-all ${
                        form.vehicle_type === k ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 bg-white text-slate-600 hover:border-orange-300'
                      }`}>{l}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label">Make *</label>
                <input className="input" placeholder="e.g. Ford, Toyota" value={form.vehicle_make} onChange={set('vehicle_make')} required />
              </div>
              <div>
                <label className="label">Model *</label>
                <input className="input" placeholder="e.g. Transit, HiAce" value={form.vehicle_model} onChange={set('vehicle_model')} required />
              </div>
              <div>
                <label className="label">Number plate *</label>
                <input className="input" placeholder="e.g. ABC 123" style={{textTransform:'uppercase'}} value={form.vehicle_plate} onChange={set('vehicle_plate')} required />
              </div>
              {error && <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
              <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-3 text-base mt-2">
                {loading ? 'Savingâ¦' : 'Next: Identity â'}
              </button>
            </form>
          )}

          {step === 'identity' && (
            <form onSubmit={handleIdentitySubmit} className="space-y-4">
              <h2 className="font-bold text-lg">Identity & ABN</h2>
              <p className="text-sm text-slate-500">Required to work as an independent contractor in Australia.</p>
              <div>
                <label className="label">ABN *</label>
                <input className="input" placeholder="11 digit ABN" value={form.abn} onChange={set('abn')} required
                  pattern="\d[\s\d]{9,12}" title="Enter your 11-digit ABN" />
                <p className="text-xs text-slate-400 mt-1">Don't have an ABN? <a href="https://www.abr.gov.au/business-super-funds-charities/applying-for-an-abn" target="_blank" rel="noopener" className="text-orange-500 underline">Apply free â</a></p>
              </div>
              <div>
                <label className="label">Driver's licence number *</label>
                <input className="input" placeholder="e.g. 123456789" value={form.license_number} onChange={set('license_number')} required />
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-700">
                â¹ï¸ Your details will be reviewed by our team before you start receiving jobs. Usually takes under 24 hours.
              </div>
              {error && <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
              <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-3 text-base">
                {loading ? 'Savingâ¦' : 'Next: Set up payments â'}
              </button>
            </form>
          )}

          {step === 'payments' && (
            <div className="space-y-4">
              <h2 className="font-bold text-lg">Get paid</h2>
              <p className="text-slate-500 text-sm">Connect your bank account via Stripe so you get paid automatically on every delivery.</p>
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-green-700 font-semibold">â Instant payouts</div>
                <div className="flex items-center gap-2 text-green-700 font-semibold">â Bank-grade security</div>
                <div className="flex items-center gap-2 text-green-700 font-semibold">â Direct to your bank account</div>
              </div>
              {error && <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
              <button onClick={handleStripeConnect} disabled={loading} className="btn-primary w-full justify-center py-3 text-base">
                {loading ? 'Redirecting to Stripeâ¦' : 'ð³ Connect bank account â'}
              </button>
              <button onClick={() => router.push('/driver/dashboard')} className="w-full text-center text-sm text-slate-400 hover:text-slate-600 pt-1">
                Skip for now (you won't receive payouts)
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
