'use client'
export const dynamic = 'force-dynamic'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { calculatePrice, DISTANCE_ZONE_LABELS, SERVICE_FEE, EXTRA_STOP_FEE, haversineKm, kmToZone } from '@/lib/pricing'
import { FEATURE_FLAGS } from '@/lib/featureFlags'
import AddressAutocomplete from '@/components/AddressAutocomplete'
import type { ItemSize, JobItem, DistanceZone } from '@/types'

// -- Item catalogue --------------------------------------------------------
const ITEM_TYPES = [
  { icon:'🧊', name:'Fridge' }, { icon:'🌀', name:'Washer/Dryer' },
  { icon:'🛏️', name:'Mattress' }, { icon:'🛋️', name:'Couch' },
  { icon:'🖥️', name:'TV/Desk' }, { icon:'🚪', name:'Wardrobe' },
  { icon:'🍽️', name:'Dining Table' }, { icon:'🏋️', name:'Gym Equipment' },
  { icon:'🧰', name:'Tools' }, { icon:'🌿', name:'Garden' },
  { icon:'🧱', name:'Materials' }, { icon:'📦', name:'Other' },
]

const ITEM_ICON: Record<string, string> = Object.fromEntries(ITEM_TYPES.map(i => [i.name, i.icon]))

const SIZES: { key: ItemSize; name: string; desc: string }[] = [
  { key: 'medium', name: 'Medium', desc: 'e.g. TV, desk chair' },
  { key: 'large', name: 'Large', desc: 'e.g. fridge, couch' },
  { key: 'xlarge', name: 'X-Large', desc: 'e.g. piano, spa bath' },
]

// -- Blank item template ----------------------------------------------------
const blankItem = (): JobItem & { _photoFile?: File; _photoPreview?: string } => ({
  item_type: '', item_size: 'large', description: '', photo_url: null,
})

type DraftItem = JobItem & { _photoFile?: File; _photoPreview?: string }

export default function PostJobPage() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()

  // -- State ------------------------------------------------------------
  const [step, setStep] = useState(1)
  const [items, setItems] = useState<DraftItem[]>([blankItem()])
  const [editingItem, setEditingItem] = useState(0) // which item is being configured

  // Helper arrangements (buyer-side)
  const [helperAtPickup, setHelperAtPickup] = useState(false)
  const [helperAtDropoff, setHelperAtDropoff] = useState(false)
  const [helperNote, setHelperNote] = useState('')

  // Location + schedule -- lat/lng are captured automatically via Google
  // Places autocomplete (see components/AddressAutocomplete.tsx). Distance
  // is then calculated automatically below, no manual picker needed.
  const [pickup, setPickup] = useState('')
  const [pickupLat, setPickupLat] = useState<number | null>(null)
  const [pickupLng, setPickupLng] = useState<number | null>(null)
  const [dropoff, setDropoff] = useState('')
  const [dropoffLat, setDropoffLat] = useState<number | null>(null)
  const [dropoffLng, setDropoffLng] = useState<number | null>(null)
  const [schedule, setSchedule] = useState<'asap' | 'scheduled'>('asap')
  const [scheduledFor, setScheduledFor] = useState('')

  // Multi-pickup / multi-dropoff (toggle + heavily discounted flat add-on fee)
  const [hasSecondPickup, setHasSecondPickup] = useState(false)
  const [secondPickup, setSecondPickup] = useState('')
  const [secondPickupLat, setSecondPickupLat] = useState<number | null>(null)
  const [secondPickupLng, setSecondPickupLng] = useState<number | null>(null)
  const [hasSecondDropoff, setHasSecondDropoff] = useState(false)
  const [secondDropoff, setSecondDropoff] = useState('')
  const [secondDropoffLat, setSecondDropoffLat] = useState<number | null>(null)
  const [secondDropoffLng, setSecondDropoffLng] = useState<number | null>(null)

  // Promo / discount code (feature-flagged, see lib/featureFlags.ts)
  const [promoCode, setPromoCode] = useState('')
  const [promoStatus, setPromoStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle')
  const [promoError, setPromoError] = useState('')
  const [appliedDiscount, setAppliedDiscount] = useState<{ id: string; percentOff: number | null; waiveServiceFee: boolean } | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // -- Helpers ------------------------------------------------------------
  const currentItem = items[editingItem]
  const setCurrentItem = (patch: Partial<DraftItem>) =>
    setItems(prev => prev.map((it, i) => i === editingItem ? { ...it, ...patch } : it))

  const addItem = () => {
    setItems(prev => [...prev, blankItem()])
    setEditingItem(items.length)
  }

  const removeItem = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx))
    setEditingItem(Math.max(0, editingItem - 1))
  }

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCurrentItem({ _photoFile: file, _photoPreview: URL.createObjectURL(file) })
  }

  const applyPromoCode = async () => {
    if (!promoCode.trim()) return
    setPromoStatus('checking')
    setPromoError('')
    try {
      const res = await fetch('/api/discount-codes/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: promoCode.trim() }),
      })
      const data = await res.json()
      if (data.valid) {
        setAppliedDiscount({ id: data.id, percentOff: data.percentOff, waiveServiceFee: data.waiveServiceFee })
        setPromoStatus('valid')
      } else {
        setAppliedDiscount(null)
        setPromoStatus('invalid')
        setPromoError(data.error || 'Invalid promo code')
      }
    } catch (e) {
      setPromoStatus('invalid')
      setPromoError('Could not check this code -- try again')
    }
  }

  // Auto distance calculation -- straight-line (Haversine) km between pickup
  // and dropoff coordinates captured by AddressAutocomplete, mapped to the
  // existing 4-bucket pricing zone. No manual picker needed anymore.
  const distanceKm = (pickupLat != null && pickupLng != null && dropoffLat != null && dropoffLng != null)
    ? haversineKm(pickupLat, pickupLng, dropoffLat, dropoffLng)
    : null
  const distanceZone: DistanceZone = distanceKm != null ? kmToZone(distanceKm) : 'under_15'

  // Pricing preview
  const priceItems = items.map(it => ({ size: it.item_size, label: `${it.item_type || 'Item'} (${it.item_size})` }))
  const price = calculatePrice(priceItems, distanceZone, {
    secondPickup: hasSecondPickup,
    secondDropoff: hasSecondDropoff,
  })
  const discountedServiceFee = appliedDiscount
    ? (appliedDiscount.waiveServiceFee ? 0 : Math.round(price.serviceFee * (1 - (appliedDiscount.percentOff || 0) / 100)))
    : price.serviceFee
  const displayTotal = price.driverFee + discountedServiceFee

  // Validation -- description is optional, only item type is required
  const item1Valid = !!currentItem.item_type
  const allItemsFilled = items.every(it => it.item_type)
  const locationValid = pickup && dropoff
    && (!hasSecondPickup || !!secondPickup)
    && (!hasSecondDropoff || !!secondDropoff)

  // -- Submit ------------------------------------------------------------
  const handleSubmit = async () => {
    setLoading(true)
    setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    // Upload photos
    const hydratedItems: JobItem[] = await Promise.all(items.map(async (it) => {
      let photo_url = null
      if (it._photoFile) {
        const ext = it._photoFile.name.split('.').pop()
        const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
        const { data: up } = await supabase.storage.from('job-photos').upload(path, it._photoFile)
        if (up) {
          const { data: { publicUrl } } = supabase.storage.from('job-photos').getPublicUrl(path)
          photo_url = publicUrl
        }
      }
      return { item_type: it.item_type, item_size: it.item_size, description: it.description || `${it.item_type} delivery`, photo_url }
    }))

    const first = hydratedItems[0]

    const { data: job, error: jobErr } = await supabase.from('jobs').insert({
      buyer_id: user.id,
      items: hydratedItems,
      // Legacy fields from first item
      item_type: first.item_type,
      item_size: first.item_size,
      item_description: first.description,
      photo_url: first.photo_url,
      // Helper info
      helper_at_pickup: helperAtPickup,
      helper_at_dropoff: helperAtDropoff,
      helper_note: helperNote || null,
      // Location -- lat/lng captured automatically via Google Places
      // autocomplete. Falls back to a Melbourne-area default only if the
      // buyer typed an address without selecting an autocomplete suggestion.
      pickup_address: pickup,
      pickup_lat: pickupLat ?? -37.9890,
      pickup_lng: pickupLng ?? 145.2175,
      dropoff_address: dropoff,
      dropoff_lat: dropoffLat ?? -37.8136,
      dropoff_lng: dropoffLng ?? 144.9631,
      // Multi-pickup / multi-dropoff
      second_pickup_address: hasSecondPickup ? secondPickup : null,
      second_pickup_lat: hasSecondPickup ? (secondPickupLat ?? -37.9890) : null,
      second_pickup_lng: hasSecondPickup ? (secondPickupLng ?? 145.2175) : null,
      second_dropoff_address: hasSecondDropoff ? secondDropoff : null,
      second_dropoff_lat: hasSecondDropoff ? (secondDropoffLat ?? -37.8136) : null,
      second_dropoff_lng: hasSecondDropoff ? (secondDropoffLng ?? 144.9631) : null,
      extra_stops_fee: price.extraStopsFee,
      distance_zone: distanceZone,
      scheduled_for: schedule === 'scheduled' ? scheduledFor : null,
      status: 'pending',
      driver_fee: price.driverFee,
      service_fee: price.serviceFee,
      // Promo / discount code (feature-flagged; null unless DISCOUNT_CODES_ENABLED)
      discount_code_id: FEATURE_FLAGS.DISCOUNT_CODES_ENABLED ? (appliedDiscount?.id ?? null) : null,
    }).select().single()

    if (jobErr) { setError(jobErr.message); setLoading(false); return }

    await supabase.from('job_status_events').insert({
      job_id: job.id, status: 'pending', note: 'Job posted -- finding driver',
    })

    // Charge the $12 VanGo service fee via Stripe Checkout (card / Apple Pay / Google Pay).
    // The driver's fee stays cash-on-delivery. If Checkout can't be created for any reason,
    // don't strand the buyer -- the job is already posted, so fall through to tracking.
    try {
      const res = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id }),
      })
      const data = await res.json()
      if (res.ok && data.url) {
        window.location.href = data.url
        return
      }
    } catch (e) {
      // fall through to tracking page below
    }

    router.push(`/buyer/tracking/${job.id}`)
  }

  // -- Render ------------------------------------------------------------
  return (
    <div>
      <Nav />
      <div className="max-w-xl mx-auto px-4 pt-24 pb-16">
        <h1 className="text-2xl font-black mb-1">Post a delivery job</h1>
        <p className="text-slate-500 text-sm mb-6">
          {step === 1 && 'What items do you need delivered?'}
          {step === 2 && 'Helper arrangements & schedule'}
          {step === 3 && 'Pickup & dropoff addresses'}
        </p>

        {/* Progress */}
        <div className="flex gap-2 mb-8">
          {[1,2,3].map(s => (
            <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${
              s < step ? 'bg-green-500' : s === step ? 'bg-orange-500' : 'bg-slate-200'
            }`} />
          ))}
        </div>

        {/* -- STEP 1: Items -- */}
        {step === 1 && (
          <div className="space-y-5">
            {/* Item tabs when multiple */}
            {items.length > 1 && (
              <div className="flex gap-2 flex-wrap">
                {items.map((it, i) => (
                  <button key={i} onClick={() => setEditingItem(i)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold border transition-all ${
                      editingItem === i
                        ? 'bg-orange-500 text-white border-orange-500'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-orange-300'
                    }`}>
                    {ITEM_ICON[it.item_type] || '📦'} Item {i + 1}
                    {items.length > 1 && i > 0 && (
                      <span onClick={e => { e.stopPropagation(); removeItem(i) }}
                        className="ml-1 text-xs opacity-60 hover:opacity-100">×</span>
                    )}
                  </button>
                ))}
                <button onClick={addItem}
                  className="px-3 py-1.5 rounded-full text-sm font-semibold border-2 border-dashed border-orange-300 text-orange-500 hover:bg-orange-50 transition-all">
                  + Add another item
                </button>
              </div>
            )}

            {/* Item type picker */}
            <div>
              <label className="label">What are you moving? *</label>
              <div className="grid grid-cols-3 gap-2">
                {ITEM_TYPES.map(it => (
                  <button key={it.name} type="button"
                    onClick={() => setCurrentItem({ item_type: it.name })}
                    className={`border-2 rounded-xl py-3 px-2 text-center transition-all ${
                      currentItem.item_type === it.name
                        ? 'border-orange-500 bg-orange-50'
                        : 'border-slate-200 hover:border-orange-300 bg-white'
                    }`}>
                    <div className="text-2xl mb-1">{it.icon}</div>
                    <div className="text-xs font-semibold text-slate-700">{it.name}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Size */}
            <div>
              <label className="label">How big is it? *</label>
              <div className="flex gap-2">
                {SIZES.map(s => (
                  <button key={s.key} type="button"
                    onClick={() => setCurrentItem({ item_size: s.key })}
                    className={`flex-1 border-2 rounded-xl py-3 px-2 text-center transition-all ${
                      currentItem.item_size === s.key
                        ? 'border-orange-500 bg-orange-50'
                        : 'border-slate-200 hover:border-orange-300 bg-white'
                    }`}>
                    <div className="font-bold text-sm text-slate-800">{s.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{s.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="label">Describe the item (optional)</label>
              <textarea className="input resize-none" rows={2}
                placeholder={`e.g. "Samsung fridge 180cm, white, working. Narrow hallway at pickup."`}
                value={currentItem.description}
                onChange={e => setCurrentItem({ description: e.target.value })} />
            </div>

            {/* Photo */}
            <div>
              <label className="label">Photo (optional but recommended)</label>
              {!currentItem._photoPreview ? (
                <label className="border-2 border-dashed border-slate-200 hover:border-orange-400 hover:bg-orange-50 rounded-xl p-8 flex flex-col items-center cursor-pointer transition-all bg-slate-50">
                  <span className="text-3xl mb-2">📸</span>
                  <span className="text-sm text-slate-500"><strong className="text-orange-500">Tap to upload</strong> · helps driver prepare</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
                </label>
              ) : (
                <div className="relative rounded-xl overflow-hidden h-36 bg-slate-100">
                  <img src={currentItem._photoPreview} alt="Preview" className="w-full h-full object-cover" />
                  <button onClick={() => setCurrentItem({ _photoFile: undefined, _photoPreview: undefined })}
                    className="absolute top-2 right-2 w-7 h-7 bg-black/50 text-white rounded-full flex items-center justify-center text-sm">×</button>
                </div>
              )}
            </div>

            {/* Add item prompt (first item only, below form) */}
            {items.length === 1 && (
              <button onClick={addItem}
                className="w-full border-2 border-dashed border-orange-200 rounded-xl py-3 text-sm font-semibold text-orange-500 hover:bg-orange-50 hover:border-orange-400 transition-all">
                + Add another item to this job (saves money!)
              </button>
            )}

            {/* Multi-item savings + ute-fit reminder */}
            {items.length > 1 && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-800 space-y-1.5">
                <div><span className="font-bold">🎉 Multi-item discount active:</span> your 2nd item is 50% cheaper and your 3rd+ items are 70% cheaper, because the driver is already making the trip.</div>
                <div className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 -mx-1">
                  🚐 <strong>Heads up:</strong> all items need to fit together in the back of a single ute at the same time. Please describe how they'll be packed (e.g. stacked, disassembled) in the notes below so the driver can confirm it'll fit before accepting.
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button onClick={() => router.push('/')} className="btn-secondary flex-1 justify-center">← Back</button>
              <button onClick={() => setStep(2)} disabled={!allItemsFilled}
                className="btn-primary flex-[2] justify-center disabled:opacity-50">
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* -- STEP 2: Helpers & schedule -- */}
        {step === 2 && (
          <div className="space-y-6">

            {/* Helper arrangements */}
            <div>
              <label className="label">Can you arrange help for the heavy lifting?</label>
              <p className="text-xs text-slate-500 mb-3">
                Your VanGo driver comes solo -- they don't bring a partner. For heavy items, having someone at either end makes the job safer and faster. This is your responsibility to arrange (a friend, family member, the seller, etc.).
              </p>

              <div className="space-y-3">
                {/* Pickup helper */}
                <label className="flex items-start gap-3 cursor-pointer p-3.5 rounded-xl border-2 border-slate-200 hover:border-orange-300 transition-colors has-[:checked]:border-orange-500 has-[:checked]:bg-orange-50">
                  <input
                    type="checkbox"
                    checked={helperAtPickup}
                    onChange={e => setHelperAtPickup(e.target.checked)}
                    className="w-5 h-5 accent-orange-500 mt-0.5 flex-shrink-0"
                  />
                  <div>
                    <div className="font-semibold text-slate-800 text-sm">✅ Someone will be at the <span className="text-green-600">pickup address</span> to help carry</div>
                    <div className="text-xs text-slate-500 mt-0.5">e.g. the seller, a friend who's already there</div>
                  </div>
                </label>

                {/* Dropoff helper */}
                <label className="flex items-start gap-3 cursor-pointer p-3.5 rounded-xl border-2 border-slate-200 hover:border-orange-300 transition-colors has-[:checked]:border-orange-500 has-[:checked]:bg-orange-50">
                  <input
                    type="checkbox"
                    checked={helperAtDropoff}
                    onChange={e => setHelperAtDropoff(e.target.checked)}
                    className="w-5 h-5 accent-orange-500 mt-0.5 flex-shrink-0"
                  />
                  <div>
                    <div className="font-semibold text-slate-800 text-sm">✅ Someone will be at the <span className="text-orange-600">dropoff address</span> to help receive it</div>
                    <div className="text-xs text-slate-500 mt-0.5">e.g. yourself, a housemate, a family member</div>
                  </div>
                </label>
              </div>

              {/* Warning if no help ticked for a large item */}
              {items.some(it => it.item_size !== 'medium') && !helperAtPickup && !helperAtDropoff && (
                <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-800">
                  ⚠️ <strong>Heads up:</strong> You've selected a large/heavy item. Drivers may decline jobs where no help is available at either end. Ticking one or both boxes significantly improves your match speed.
                </div>
              )}

              {/* Optional helper note */}
              {(helperAtPickup || helperAtDropoff) && (
                <div className="mt-3">
                  <label className="label">Helper note (optional)</label>
                  <input className="input" placeholder='e.g. "My brother will be at pickup, my wife at dropoff"'
                    value={helperNote} onChange={e => setHelperNote(e.target.value)} />
                </div>
              )}
            </div>

            {/* Schedule */}
            <div>
              <label className="label">When do you need it?</label>
              <div className="flex gap-2">
                {[{key:'asap',title:'⚡ ASAP',sub:'Match within minutes'},{key:'scheduled',title:'📅 Schedule',sub:'Pick date & time'}].map(s => (
                  <button key={s.key} type="button" onClick={() => setSchedule(s.key as any)}
                    className={`flex-1 border-2 rounded-xl py-3 px-3 text-left transition-all ${
                      schedule === s.key ? 'border-orange-500 bg-orange-50' : 'border-slate-200 bg-white hover:border-orange-300'
                    }`}>
                    <div className="font-bold text-sm">{s.title}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{s.sub}</div>
                  </button>
                ))}
              </div>
              {schedule === 'scheduled' && (
                <input type="datetime-local" className="input mt-3"
                  value={scheduledFor} onChange={e => setScheduledFor(e.target.value)} />
              )}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="btn-secondary flex-1 justify-center">← Back</button>
              <button onClick={() => setStep(3)} className="btn-primary flex-[2] justify-center">Continue →</button>
            </div>
          </div>
        )}

        {/* -- STEP 3: Addresses + price -- */}
        {step === 3 && (
          <div className="space-y-5">
            {/* Addresses -- Google Places autocomplete captures lat/lng automatically */}
            <div>
              <label className="label">Pickup & Dropoff *</label>
              <div className="flex gap-3 items-start">
                <div className="flex flex-col items-center pt-3.5 gap-1">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <div className="w-0.5 h-6 bg-slate-200" />
                  <div className="w-3 h-3 rounded-full bg-orange-500" />
                </div>
                <div className="flex-1 space-y-2">
                  <AddressAutocomplete placeholder="Pickup: seller's full address + suburb + postcode"
                    value={pickup}
                    onChange={(address, lat, lng) => { setPickup(address); setPickupLat(lat); setPickupLng(lng) }} />
                  <AddressAutocomplete placeholder="Dropoff: your delivery address + suburb + postcode"
                    value={dropoff}
                    onChange={(address, lat, lng) => { setDropoff(address); setDropoffLat(lat); setDropoffLng(lng) }} />
                </div>
              </div>
            </div>

            {/* Multi-pickup / multi-dropoff toggles */}
            <div className="space-y-3">
              <label className="flex items-center justify-between gap-3 p-3.5 rounded-xl border-2 border-slate-200 cursor-pointer has-[:checked]:border-green-500 has-[:checked]:bg-green-50">
                <div>
                  <div className="font-semibold text-slate-800 text-sm">➕ Add a 2nd pickup address</div>
                  <div className="text-xs text-slate-500 mt-0.5">Grabbing something from a second seller on the way? Just +${EXTRA_STOP_FEE} -- way cheaper than a separate job.</div>
                </div>
                <input type="checkbox" checked={hasSecondPickup}
                  onChange={e => setHasSecondPickup(e.target.checked)}
                  className="w-5 h-5 accent-green-500 flex-shrink-0" />
              </label>
              {hasSecondPickup && (
                <AddressAutocomplete placeholder="2nd pickup: full address + suburb + postcode"
                  value={secondPickup}
                  onChange={(address, lat, lng) => { setSecondPickup(address); setSecondPickupLat(lat); setSecondPickupLng(lng) }} />
              )}

              <label className="flex items-center justify-between gap-3 p-3.5 rounded-xl border-2 border-slate-200 cursor-pointer has-[:checked]:border-orange-500 has-[:checked]:bg-orange-50">
                <div>
                  <div className="font-semibold text-slate-800 text-sm">➕ Add a 2nd dropoff address</div>
                  <div className="text-xs text-slate-500 mt-0.5">Dropping items at two places? Just +${EXTRA_STOP_FEE} -- way cheaper than a separate job.</div>
                </div>
                <input type="checkbox" checked={hasSecondDropoff}
                  onChange={e => setHasSecondDropoff(e.target.checked)}
                  className="w-5 h-5 accent-orange-500 flex-shrink-0" />
              </label>
              {hasSecondDropoff && (
                <AddressAutocomplete placeholder="2nd dropoff: full address + suburb + postcode"
                  value={secondDropoff}
                  onChange={(address, lat, lng) => { setSecondDropoff(address); setSecondDropoffLat(lat); setSecondDropoffLng(lng) }} />
              )}
            </div>

            {/* Distance -- calculated automatically from the pickup/dropoff
                coordinates captured by autocomplete above. */}
            <div>
              <label className="label">Distance (auto-calculated)</label>
              {distanceKm != null ? (
                <div className="flex items-center gap-3 p-3 rounded-xl border-2 border-green-200 bg-green-50">
                  <span className="text-sm font-semibold text-green-800">
                    📍 {distanceKm.toFixed(1)} km -- {DISTANCE_ZONE_LABELS[distanceZone]} pricing tier
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3 rounded-xl border-2 border-slate-200 bg-slate-50">
                  <span className="text-sm text-slate-500">Select both addresses from the autocomplete suggestions to calculate distance.</span>
                </div>
              )}
            </div>

            {/* Access notes */}
            <div>
              <label className="label">Access notes (optional)</label>
              <input className="input" placeholder="e.g. Driveway available, ground floor, narrow front door" />
            </div>

            {/* Promo code (feature-flagged, see lib/featureFlags.ts) */}
            {FEATURE_FLAGS.DISCOUNT_CODES_ENABLED && (
              <div>
                <label className="label">Promo code (optional)</label>
                <div className="flex gap-2">
                  <input className="input flex-1" placeholder="e.g. WELCOME10"
                    value={promoCode}
                    onChange={e => { setPromoCode(e.target.value); setPromoStatus('idle'); setAppliedDiscount(null) }} />
                  <button type="button" onClick={applyPromoCode} disabled={promoStatus === 'checking' || !promoCode.trim()}
                    className="btn-secondary px-4 disabled:opacity-50">
                    {promoStatus === 'checking' ? '...' : 'Apply'}
                  </button>
                </div>
                {promoStatus === 'valid' && appliedDiscount && (
                  <p className="text-xs text-green-600 font-semibold mt-1.5">
                    ✅ Code applied: {appliedDiscount.waiveServiceFee ? 'service fee waived' : `${appliedDiscount.percentOff}% off service fee`}
                  </p>
                )}
                {promoStatus === 'invalid' && (
                  <p className="text-xs text-red-500 font-semibold mt-1.5">{promoError}</p>
                )}
              </div>
            )}

            {/* Price breakdown */}
            {locationValid && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                <div className="text-sm font-bold text-orange-800 mb-3">💰 Price breakdown</div>
                <div className="space-y-1.5 text-sm">
                  {price.items.map((item, i) => (
                    <div key={i} className="flex justify-between items-center">
                      <span className="text-orange-700">
                        {item.label}
                        {item.discounted && <span className="ml-1 text-xs text-green-600 font-semibold">({item.discountPercent}% multi-item discount)</span>}
                      </span>
                      <span className="font-bold">${item.fee}</span>
                    </div>
                  ))}
                  {price.distanceSurcharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-orange-700">Distance charge</span>
                      <span className="font-bold">+${price.distanceSurcharge}</span>
                    </div>
                  )}
                  {price.extraStopsFee > 0 && (
                    <div className="flex justify-between">
                      <span className="text-orange-700">Extra stop(s)</span>
                      <span className="font-bold">+${price.extraStopsFee}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-orange-700">VanGo service fee</span>
                    {appliedDiscount ? (
                      <span className="font-bold">
                        <span className="line-through text-orange-300 mr-1.5">${price.serviceFee}</span>
                        <span className="text-green-600">${discountedServiceFee}</span>
                      </span>
                    ) : (
                      <span className="font-bold">${price.serviceFee}</span>
                    )}
                  </div>
                  <div className="h-px bg-orange-200 my-2" />
                  <div className="flex justify-between font-black text-base">
                    <span>Total</span>
                    <span className="text-orange-600">${displayTotal}</span>
                  </div>
                  <div className="flex justify-between text-xs text-orange-600">
                    <span>Driver receives (cash on delivery)</span>
                    <span className="font-bold">${price.driverFee}</span>
                  </div>
                </div>
                <p className="text-xs text-orange-600 mt-3">
                  Pay <strong>${price.driverFee} cash</strong> to driver on delivery. The ${discountedServiceFee} service fee is charged to your card when you post.
                </p>
              </div>
            )}

            {error && <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

            <div className="flex gap-3">
              <button onClick={() => setStep(2)} className="btn-secondary flex-1 justify-center">← Back</button>
              <button onClick={handleSubmit} disabled={!locationValid || loading}
                className="btn-primary flex-[2] justify-center disabled:opacity-50">
                {loading ? 'Posting…' : `🚐 Find a Driver → $${displayTotal}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
