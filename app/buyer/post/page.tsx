'use client'
export const dynamic = 'force-dynamic'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { calculatePrice, SERVICE_FEE, EXTRA_STOP_FEE, EXTRA_ITEM_FEE, DISTANCE_RATE_PER_KM, haversineKm, kmToZone, ITEM_CATALOG, catalogEntry, allowedSizes, effectiveSize } from '@/lib/pricing'
import { FEATURE_FLAGS } from '@/lib/featureFlags'
import AddressAutocomplete from '@/components/AddressAutocomplete'
import type { ItemSize, JobItem, DistanceZone } from '@/types'

// -- Item catalogue --------------------------------------------------------
// The catalogue in lib/pricing.ts is the single source of truth: every known
// item type carries a DEFAULT size and a MINIMUM size floor. The customer can
// adjust the size for any item (a huge desk can be Large), but never below
// the floor (a fridge is never Small) — see allowedSizes/effectiveSize.
const CATALOG_SECTIONS: { title: string; sub: string; sizes: (ItemSize | null)[] }[] = [
  { title: 'Heavy & bulky', sub: 'Two people + often a trolley — usually Large', sizes: ['large'] },
  { title: 'Extra large', sub: 'Specialist multi-person moves — usually X-Large', sizes: ['xlarge'] },
  { title: 'Light & easy to load', sub: 'Quick one-person loads — usually Medium', sizes: ['medium'] },
  { title: 'Small items', sub: 'Boxes, bags, small appliances — FREE driver fee', sizes: ['small'] },
  { title: 'Something else', sub: "Pick a size and describe it — the driver confirms at pickup", sizes: [null] },
]

const ITEM_ICON: Record<string, string> = Object.fromEntries(ITEM_CATALOG.map(i => [i.name, i.icon]))

// All size options; each item shows only the ones at/above its floor.
const SIZE_OPTIONS: { key: ItemSize; name: string; desc: string }[] = [
  { key: 'small', name: 'Small', desc: 'boxes, packs — free' },
  { key: 'medium', name: 'Medium', desc: 'light, one person' },
  { key: 'large', name: 'Large', desc: 'heavy, two people' },
  { key: 'xlarge', name: 'X-Large', desc: 'specialist move' },
]

const SIZE_LABEL: Record<ItemSize, string> = { small: 'Small', medium: 'Medium', large: 'Large', xlarge: 'X-Large' }

// Clean money display: never show floating-point junk like 21.990000000000002.
// Whole dollars show without cents; otherwise exactly 2 decimals.
const money = (n: number | string) => {
  const v = Math.round(Number(n) * 100) / 100
  return Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2)
}

// -- Blank item template ----------------------------------------------------
const blankItem = (): JobItem & { _photoFile?: File; _photoPreview?: string } => ({
  item_type: '', item_size: 'medium', description: '', photo_url: null,
})

type DraftItem = JobItem & { _photoFile?: File; _photoPreview?: string }

export default function PostJobPage() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()

  // -- State ------------------------------------------------------------
  const [step, setStep] = useState(1)
  const [items, setItems] = useState<DraftItem[]>([blankItem()])
  const [editingItem, setEditingItem] = useState(0) // which item is being configured
  const [triedContinue, setTriedContinue] = useState(false) // show validation errors after a failed Continue

  // Helper arrangements (customer-side)
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

  // Access notes (parking, stairs, narrow doors) -- saved with the helper
  // note so the driver sees them before accepting.
  const [accessNotes, setAccessNotes] = useState('')

  // Multi-pickup / multi-dropoff (toggle + flat add-on fee)
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
  const currentEntry = currentItem.item_type ? catalogEntry(currentItem.item_type) : undefined
  const currentAllowed = currentItem.item_type ? allowedSizes(currentItem.item_type) : SIZE_OPTIONS.map(s => s.key)
  const setCurrentItem = (patch: Partial<DraftItem>) =>
    setItems(prev => prev.map((it, i) => i === editingItem ? { ...it, ...patch } : it))

  // Picking an item type sets its DEFAULT size; the customer can then adjust
  // within the allowed range (floor..X-Large) below.
  //
  // Shopping-cart behaviour: once the item currently being edited already has
  // a type AND some other detail filled in (description/photo), tapping a
  // different item type ADDS it as a NEW cart item instead of overwriting the
  // one in progress. Previously tapping "Couch" right after "Fridge" just
  // replaced the fridge -- there was no way to build up a second or third
  // item from the grid itself, only via the separate "+ Add another item"
  // button. A bare, just-tapped type with nothing else filled in still gets
  // corrected in place, so a wrong first tap is easy to fix.
  const pickItemType = (name: string) => {
    const entry = catalogEntry(name)
    const inProgress = !!currentItem.item_type && (
      currentItem.description.trim() || currentItem._photoFile || currentItem.photo_url
    )
    if (inProgress) {
      setItems(prev => [...prev, { ...blankItem(), item_type: name, item_size: entry?.size ?? 'medium' }])
      setEditingItem(items.length)
      setTriedContinue(false)
      return
    }
    setCurrentItem({ item_type: name, item_size: entry?.size ?? 'medium' })
  }

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
  // and dropoff coordinates captured by AddressAutocomplete. Charged at a flat
  // per-km rate (no tiers shown to the customer anymore).
  const distanceKm = (pickupLat != null && pickupLng != null && dropoffLat != null && dropoffLng != null)
    ? haversineKm(pickupLat, pickupLng, dropoffLat, dropoffLng)
    : null
  const distanceZone: DistanceZone = distanceKm != null ? kmToZone(distanceKm) : 'under_15'

  // Pricing preview -- pass the item TYPE so the engine applies the per-item
  // size floor (a fridge can never price below Medium), and the real km for
  // the flat per-km charge.
  const priceItems = items.map(it => ({ size: it.item_size, label: `${it.item_type || 'Item'} (${SIZE_LABEL[it.item_size] ?? it.item_size})`, type: it.item_type }))
  const price = calculatePrice(priceItems, distanceKm ?? 0, {
    secondPickup: hasSecondPickup,
    secondDropoff: hasSecondDropoff,
  })
  const discountedServiceFee = appliedDiscount
    ? (appliedDiscount.waiveServiceFee ? 0 : Math.round(price.serviceFee * (1 - (appliedDiscount.percentOff || 0) / 100)))
    : price.serviceFee
  const displayTotal = price.driverFee + discountedServiceFee

  // Validation -- an item type, a description AND a photo are required for
  // every item. The photo is what the driver relies on to judge the load
  // before accepting, so it is mandatory (take one or upload one).
  const firstInvalidIdx = items.findIndex(it => !it.item_type || !it.description.trim() || !(it._photoFile || it.photo_url))
  const allItemsValid = firstInvalidIdx === -1
  const typeMissing = triedContinue && !currentItem.item_type
  const descMissing = triedContinue && !currentItem.description.trim()
  const photoMissing = triedContinue && !(currentItem._photoFile || currentItem.photo_url)
  const locationValid = pickup && dropoff
    && (!hasSecondPickup || !!secondPickup)
    && (!hasSecondDropoff || !!secondDropoff)
    && (schedule !== 'scheduled' || !!scheduledFor)

  const handleContinueFromItems = () => {
    if (!allItemsValid) {
      setEditingItem(firstInvalidIdx)
      setTriedContinue(true)
      return
    }
    setTriedContinue(false)
    setStep(2)
  }

  // Any heavy / specialist item on the job? Drives the helper nudge in step 2.
  const hasHeavyItem = items.some(it => {
    const e = it.item_type ? catalogEntry(it.item_type) : undefined
    return e ? e.effort !== 'easy' : (it.item_size === 'large' || it.item_size === 'xlarge')
  })

  // -- Submit ------------------------------------------------------------
  const handleSubmit = async () => {
    setLoading(true)
    setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); router.push('/login'); return }

    // Upload photos. Photos are MANDATORY, so an upload failure stops the
    // post with a clear error instead of silently posting a photo-less job
    // (which left drivers unable to see what they were picking up).
    const hydratedItems: JobItem[] = []
    for (const it of items) {
      let photo_url = it.photo_url ?? null
      if (it._photoFile) {
        const ext = it._photoFile.name.split('.').pop()
        const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
        const { data: up, error: upErr } = await supabase.storage.from('job-photos').upload(path, it._photoFile)
        if (upErr || !up) {
          setError(`Photo upload failed${upErr?.message ? ` (${upErr.message})` : ''}. Please try again — the photo is required so your driver can see the item.`)
          setLoading(false)
          return
        }
        const { data: { publicUrl } } = supabase.storage.from('job-photos').getPublicUrl(path)
        photo_url = publicUrl
      }
      // Store the size the pricing engine actually used (per-item floor
      // applied), never a client-picked size below the floor.
      const finalSize = effectiveSize(it.item_type, it.item_size)
      hydratedItems.push({ item_type: it.item_type, item_size: finalSize, description: it.description || `${it.item_type} delivery`, photo_url })
    }

    const first = hydratedItems[0]

    // Fold access notes into the helper note so the driver sees them.
    const combinedNote = [helperNote.trim(), accessNotes.trim() ? `Access: ${accessNotes.trim()}` : '']
      .filter(Boolean).join(' — ') || null

    // PAYMENT HARD-STOP: the job is created as 'unpaid' and is NOT visible to
    // drivers. It only goes live once the service fee is paid via Stripe
    // Checkout (webhook flips it to 'pending'), or immediately if a promo
    // code fully waives the fee (the $0 path in create-checkout-session).
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
      helper_note: combinedNote,
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
      status: 'unpaid',
      driver_fee: price.driverFee,
      service_fee: price.serviceFee,
      // Promo / discount code (feature-flagged; null unless DISCOUNT_CODES_ENABLED)
      discount_code_id: FEATURE_FLAGS.DISCOUNT_CODES_ENABLED ? (appliedDiscount?.id ?? null) : null,
    }).select().single()

    if (jobErr) { setError(jobErr.message); setLoading(false); return }

    await supabase.from('job_status_events').insert({
      job_id: job.id, status: 'unpaid', note: 'Job created -- awaiting service fee payment',
    })

    // Charge the Vanute service fee via Stripe Checkout (card / Apple Pay / Google Pay).
    // The driver's fee stays cash / PayID on delivery. If Checkout can't be created for
    // any reason the job simply stays 'unpaid' (invisible to drivers) and the tracking
    // page shows a "Pay service fee" button to finish activation.
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

            {/* Item type picker -- grouped by loading effort. Each type has a
                DEFAULT size and a FLOOR; the size selector below lets the
                customer adjust within the allowed range. Shopping-cart style:
                once the item in progress has a description/photo, tapping a
                different type here ADDS it as a new item -- see pickItemType. */}
            <div className={typeMissing ? 'ring-2 ring-red-400 rounded-xl p-1' : ''}>
              <label className="label">What are you moving? *</label>
              {items.length > 1 && (
                <p className="text-[11px] text-slate-400 mb-1.5">🛒 Tap another item below to add it to this job -- like adding to a cart.</p>
              )}
              <div className="space-y-4">
                {CATALOG_SECTIONS.map(section => {
                  const entries = ITEM_CATALOG.filter(e => section.sizes.includes(e.size))
                  if (entries.length === 0) return null
                  return (
                    <div key={section.title}>
                      <div className="flex items-baseline justify-between mb-1.5">
                        <span className="text-xs font-bold text-slate-600">{section.title}</span>
                        <span className="text-[11px] text-slate-400">{section.sub}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {entries.map(it => (
                          <button key={it.name} type="button"
                            onClick={() => pickItemType(it.name)}
                            className={`border-2 rounded-xl py-2.5 px-1.5 text-center transition-all ${
                              currentItem.item_type === it.name
                                ? 'border-orange-500 bg-orange-50'
                                : 'border-slate-200 hover:border-orange-300 bg-white'
                            }`}>
                            <div className="text-xl mb-0.5">{it.icon}</div>
                            <div className="text-[11px] font-semibold text-slate-700 leading-tight">{it.label}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
              {typeMissing && <p className="text-xs text-red-500 font-semibold mt-1.5">Please pick what you're moving.</p>}
            </div>

            {/* Size -- adjustable for EVERY item, within the item's guardrails:
                never below its floor (a fridge is never Small), always
                upgradable (a massive desk can be Large or X-Large). */}
            {currentItem.item_type && (
              <div>
                <label className="label">How big is it? *</label>
                {currentEntry?.loadNote && <p className="text-xs text-slate-500 mb-2">{currentEntry.loadNote}</p>}
                <div className="grid grid-cols-2 gap-2">
                  {SIZE_OPTIONS.filter(s => currentAllowed.includes(s.key)).map(s => (
                    <button key={s.key} type="button"
                      onClick={() => setCurrentItem({ item_size: s.key })}
                      className={`border-2 rounded-xl py-3 px-2 text-center transition-all ${
                        currentItem.item_size === s.key
                          ? 'border-orange-500 bg-orange-50'
                          : 'border-slate-200 hover:border-orange-300 bg-white'
                      }`}>
                      <div className="font-bold text-sm text-slate-800">
                        {s.name}
                        {currentEntry?.size === s.key && <span className="ml-1 text-[10px] font-semibold text-orange-500">(typical)</span>}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">{s.desc}</div>
                    </button>
                  ))}
                </div>
                {currentAllowed[0] !== 'small' && (
                  <p className="text-xs text-slate-400 mt-1.5">
                    ⚖️ Minimum for this item: <strong>{SIZE_LABEL[currentAllowed[0]]}</strong> — pick a bigger size if yours is unusually large or heavy.
                  </p>
                )}
              </div>
            )}

            {/* Description -- REQUIRED */}
            <div>
              <label className="label">Describe the item *</label>
              <textarea
                className={`input resize-none ${descMissing ? 'border-red-400 ring-2 ring-red-200' : ''}`}
                rows={2}
                placeholder={currentItem.item_type === 'Other'
                  ? 'Required: tell the driver exactly what this is, rough weight & size.'
                  : `e.g. "Samsung fridge 180cm, white, working. Narrow hallway at pickup."`}
                value={currentItem.description}
                onChange={e => setCurrentItem({ description: e.target.value })} />
              {descMissing
                ? <p className="text-xs text-red-500 font-semibold mt-1.5">A description is required so the driver knows what they're picking up.</p>
                : <p className="text-xs text-slate-400 mt-1.5">Required. If you picked "Other", describe exactly what it is.</p>}
            </div>

            {/* Honesty / re-rate disclaimer */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5 text-xs text-amber-800">
              ⚖️ <strong>Be accurate with the size.</strong> When the driver arrives and sees the item in person, they can adjust the size and price to match what's actually there — based on what they see at pickup, not your photo. Describing a bigger item as something smaller will simply be corrected on the spot.
            </div>

            {/* Photo -- REQUIRED (drivers judge the load from it before accepting) */}
            <div>
              <label className="label">Photo *</label>
              {!currentItem._photoPreview ? (
                <label className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center cursor-pointer transition-all bg-slate-50 ${photoMissing ? 'border-red-400 ring-2 ring-red-200' : 'border-slate-200 hover:border-orange-400 hover:bg-orange-50'}`}>
                  <span className="text-3xl mb-2">📸</span>
                  <span className="text-sm text-slate-500"><strong className="text-orange-500">Take a photo or upload one</strong> · required so the driver can see the item</span>
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
                <div><span className="font-bold">🎉 Extra-item saving:</span> because the driver is already making the trip, each extra item from the <strong>same pickup</strong> is a flat +${EXTRA_ITEM_FEE} — and small items are free.</div>
                <div className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 -mx-1">
                  🚐 <strong>Heads up:</strong> all items need to fit together in the back of a single ute at the same time. Please describe how they'll be packed (e.g. stacked, disassembled) in each item's description so the driver can confirm it'll fit before accepting.
                </div>
              </div>
            )}

            {/* Cart summary -- every item added so far, shopping-cart style,
                so it's obvious a 2nd/3rd item actually made it onto the job
                instead of silently replacing the last one. */}
            {items.length > 1 && (
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-3.5 py-2 bg-slate-50 text-xs font-bold text-slate-500 flex items-center justify-between">
                  <span>🛒 Your items ({items.length})</span>
                  <span className="font-normal text-slate-400">Tap to edit</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {items.map((it, i) => {
                    const itemComplete = !!it.item_type && !!it.description.trim() && !!(it._photoFile || it.photo_url)
                    return (
                      <div key={i} className={`flex items-center gap-2.5 px-3.5 py-2.5 ${editingItem === i ? 'bg-orange-50' : ''}`}>
                        <button type="button" onClick={() => setEditingItem(i)} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
                          <span className="text-lg flex-shrink-0">{ITEM_ICON[it.item_type] || '📦'}</span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-slate-800 truncate">{it.item_type || `Item ${i + 1} — pick a type`}</span>
                            <span className="block text-xs text-slate-400 truncate">
                              {it.item_type ? SIZE_LABEL[it.item_size] ?? it.item_size : ''}
                              {it.description ? ` · ${it.description}` : ''}
                            </span>
                          </span>
                        </button>
                        {!itemComplete && (
                          <span className="text-[10px] font-semibold text-amber-600 flex-shrink-0">Incomplete</span>
                        )}
                        <button type="button" onClick={() => removeItem(i)}
                          className="text-slate-300 hover:text-red-500 flex-shrink-0 w-6 h-6 flex items-center justify-center text-sm">×</button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button onClick={() => router.push('/')} className="btn-secondary flex-1 justify-center">← Back</button>
              <button onClick={handleContinueFromItems}
                className="btn-primary flex-[2] justify-center">
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
                Your Vanute driver comes solo -- they don't bring a partner. For heavy items, having someone at either end makes the job safer and faster. This is your responsibility to arrange (a friend, family member, the seller, etc.).
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

              {/* Warning if no help ticked for a heavy item */}
              {hasHeavyItem && !helperAtPickup && !helperAtDropoff && (
                <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-800">
                  ⚠️ <strong>Heads up:</strong> Your item needs two sets of hands (think fridge, couch, washer). Drivers may decline jobs where no help is available at either end. Ticking one or both boxes significantly improves your match speed.
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
            {/* Addresses -- Google Places suggestions capture lat/lng automatically */}
            <div>
              <label className="label">Pickup & Dropoff *</label>
              <div className="flex gap-3 items-start">
                <div className="flex flex-col items-center pt-3.5 gap-1">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <div className="w-0.5 h-6 bg-slate-200" />
                  <div className="w-3 h-3 rounded-full bg-orange-500" />
                </div>
                <div className="flex-1 space-y-2">
                  <AddressAutocomplete placeholder="Pickup address"
                    value={pickup}
                    onChange={(address, lat, lng) => { setPickup(address); setPickupLat(lat); setPickupLng(lng) }} />
                  <AddressAutocomplete placeholder="Dropoff address"
                    value={dropoff}
                    onChange={(address, lat, lng) => { setDropoff(address); setDropoffLat(lat); setDropoffLng(lng) }} />
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">Start typing, then tap your address in the list — it fills in instantly, including suburb and postcode.</p>
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
                <AddressAutocomplete placeholder="2nd pickup address"
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
                <AddressAutocomplete placeholder="2nd dropoff address"
                  value={secondDropoff}
                  onChange={(address, lat, lng) => { setSecondDropoff(address); setSecondDropoffLat(lat); setSecondDropoffLng(lng) }} />
              )}
            </div>

            {/* Distance -- calculated automatically from the pickup/dropoff
                coordinates captured by the address suggestions. Flat per-km charge. */}
            <div>
              <label className="label">Distance (auto-calculated)</label>
              {distanceKm != null ? (
                <div className="flex items-center gap-3 p-3 rounded-xl border-2 border-green-200 bg-green-50">
                  <span className="text-sm font-semibold text-green-800">
                    📍 {distanceKm.toFixed(1)} km · distance charge ${price.distanceFee}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3 rounded-xl border-2 border-slate-200 bg-slate-50">
                  <span className="text-sm text-slate-500">Pick both addresses from the suggestion list and the distance fills in automatically.</span>
                </div>
              )}
              {/* Long-distance guard: beyond the auto-quote radius (see MAX_QUOTED_KM
                  in lib/pricing.ts) we can't guarantee an instant driver match at a
                  fixed price, so posting is blocked in favour of a custom quote. */}
              {price.quoteRequired && (
                <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5 text-xs text-amber-800">
                  🚚 <strong>Long-distance job (over 150 km).</strong> This is beyond our standard instant-quote range, so we can't guarantee an auto driver match at a fixed price. Please <a href="mailto:admin@vanute.com.au?subject=Long-distance%20delivery%20quote" className="underline font-semibold">contact us for a custom quote</a> and we'll arrange a driver for you.
                </div>
              )}
            </div>

            {/* Access notes -- folded into the helper note on submit so the
                driver actually sees them (previously this field went nowhere). */}
            <div>
              <label className="label">Access notes (optional)</label>
              <input className="input" placeholder="e.g. Driveway available, ground floor, narrow front door"
                value={accessNotes} onChange={e => setAccessNotes(e.target.value)} />
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
                        {item.isExtra && <span className="ml-1 text-xs text-green-600 font-semibold">(extra item)</span>}
                      </span>
                      <span className="font-bold">{item.free ? 'Free' : `$${item.fee}`}</span>
                    </div>
                  ))}
                  {price.distanceFee > 0 && (
                    <div className="flex justify-between">
                      <span className="text-orange-700">Distance charge</span>
                      <span className="font-bold">+${price.distanceFee}</span>
                    </div>
                  )}
                  {price.extraStopsFee > 0 && (
                    <div className="flex justify-between">
                      <span className="text-orange-700">Extra stop(s)</span>
                      <span className="font-bold">+${price.extraStopsFee}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-orange-700">Vanute service fee</span>
                    {appliedDiscount ? (
                      <span className="font-bold">
                        <span className="line-through text-orange-300 mr-1.5">${money(price.serviceFee)}</span>
                        <span className="text-green-600">${money(discountedServiceFee)}</span>
                      </span>
                    ) : (
                      <span className="font-bold">${money(price.serviceFee)}</span>
                    )}
                  </div>
                  <div className="h-px bg-orange-200 my-2" />
                  <div className="flex justify-between font-black text-base">
                    <span>Total</span>
                    <span className="text-orange-600">${money(displayTotal)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-orange-600">
                    <span>Driver receives (cash / PayID on delivery)</span>
                    <span className="font-bold">${money(price.driverFee)}</span>
                  </div>
                </div>
                <p className="text-xs text-orange-600 mt-3">
                  Pay <strong>${money(price.driverFee)} by cash or PayID</strong> to the driver on delivery. The ${money(discountedServiceFee)} service fee is charged to your card when you post — <strong>your job only goes live to drivers once it's paid</strong>.
                </p>
              </div>
            )}

            {error && <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

            <div className="flex gap-3">
              <button onClick={() => setStep(2)} className="btn-secondary flex-1 justify-center">← Back</button>
              <button onClick={handleSubmit} disabled={!locationValid || loading || price.quoteRequired}
                className="btn-primary flex-[2] justify-center disabled:opacity-50">
                {loading ? 'Posting…' : price.quoteRequired ? 'Over 150 km — contact us for a quote' : `🚐 Find a Driver → ${money(displayTotal)}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
