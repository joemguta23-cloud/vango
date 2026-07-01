'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import { createSupabaseBrowserClient } from '@/lib/supabase'

// Buyers and drivers can edit their own name/phone (and drivers their
// vehicle details) here. Saves go straight through the Supabase client --
// no API route needed, since RLS already lets a user update their own
// `profiles` row (auth.uid() = id) and their own `drivers` row
// (user_id = auth.uid()).
const VEHICLE_TYPES = ['ute', 'van', 'truck']

export default function SettingsPage() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()
  const [userId, setUserId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const [role, setRole] = useState(null)
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')

  // Driver-only fields
  const [vehicleType, setVehicleType] = useState('ute')
  const [vehicleMake, setVehicleMake] = useState('')
  const [vehicleModel, setVehicleModel] = useState('')
  const [vehiclePlate, setVehiclePlate] = useState('')

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUserId(user.id)

      const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      if (profile) {
        setRole(profile.role)
        setFullName(profile.full_name || '')
        setPhone(profile.phone || '')
      }

      if (profile?.role === 'driver') {
        const { data: driver } = await supabase.from('drivers').select('*').eq('user_id', user.id).single()
        if (driver) {
          setVehicleType(driver.vehicle_type || 'ute')
          setVehicleMake(driver.vehicle_make || '')
          setVehicleModel(driver.vehicle_model || '')
          setVehiclePlate(driver.vehicle_plate || '')
        }
      }
      setLoading(false)
    }
    load()
  }, [])

  const handleSave = async () => {
    if (!userId) return
    setSaving(true)
    setSaved(false)
    setError('')

    const { error: profileErr } = await supabase.from('profiles').update({
      full_name: fullName.trim(),
      phone: phone.trim(),
    }).eq('id', userId)

    if (profileErr) {
      setError(profileErr.message)
      setSaving(false)
      return
    }

    if (role === 'driver') {
      const { error: driverErr } = await supabase.from('drivers').update({
        vehicle_type: vehicleType,
        vehicle_make: vehicleMake.trim(),
        vehicle_model: vehicleModel.trim(),
        vehicle_plate: vehiclePlate.trim(),
      }).eq('user_id', userId)

      if (driverErr) {
        setError(driverErr.message)
        setSaving(false)
        return
      }
    }

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="text-5xl animate-bounce">⚙️</div></div>

  return (
    <div>
      <Nav />
      <div className="max-w-lg mx-auto px-4 pt-24 pb-16">
        <h1 className="text-2xl font-black mb-1">⚙️ Account settings</h1>
        <p className="text-slate-500 text-sm mb-6">
          {role === 'driver' ? 'Update your name, phone and vehicle details.' : 'Update your name and phone number.'}
        </p>

        <div className="card space-y-4">
          <div>
            <label className="label">Full name</label>
            <input className="input" placeholder="e.g. Jordan Smith"
              value={fullName} onChange={e => setFullName(e.target.value)} />
          </div>

          <div>
            <label className="label">Phone</label>
            <input className="input" placeholder="e.g. 0412 345 678"
              value={phone} onChange={e => setPhone(e.target.value)} />
          </div>

          {role === 'driver' && (
            <>
              <div className="h-px bg-slate-100 my-2" />
              <h2 className="font-bold text-sm text-slate-500">Vehicle details</h2>

              <div>
                <label className="label">Vehicle type</label>
                <div className="flex gap-2">
                  {VEHICLE_TYPES.map(t => (
                    <button key={t} type="button" onClick={() => setVehicleType(t)}
                      className={`flex-1 border-2 rounded-xl py-2.5 px-2 text-center text-sm font-semibold capitalize transition-all ${
                        vehicleType === t ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 hover:border-orange-300 bg-white text-slate-600'
                      }`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="label">Make</label>
                <input className="input" placeholder="e.g. Toyota"
                  value={vehicleMake} onChange={e => setVehicleMake(e.target.value)} />
              </div>

              <div>
                <label className="label">Model</label>
                <input className="input" placeholder="e.g. HiLux"
                  value={vehicleModel} onChange={e => setVehicleModel(e.target.value)} />
              </div>

              <div>
                <label className="label">Number plate</label>
                <input className="input" placeholder="e.g. 1ABC234"
                  value={vehiclePlate} onChange={e => setVehiclePlate(e.target.value)} />
              </div>
            </>
          )}

          {error && <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          {saved && <p className="text-green-600 text-sm bg-green-50 border border-green-200 rounded-lg px-3 py-2">✅ Saved!</p>}

          <button onClick={handleSave} disabled={saving}
            className="btn-primary w-full justify-center disabled:opacity-50">
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
