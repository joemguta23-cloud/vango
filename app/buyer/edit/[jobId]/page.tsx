'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { calculatePrice, haversineKm, ITEM_CATALOG, catalogEntry, allowedSizes, EXTRA_STOP_FEE } from '@/lib/pricing'
import AddressAutocomplete from '@/components/AddressAutocomplete'
import type { ItemSize, JobItem } from '@/types'

// ── Edit an existing job (Uber-style) ───────────────────────────────────────
// Wrong suburb? Change of location? Different item size? Buyers edit here.
//
//   unpaid / pending  -> edits apply INSTANTLY and the price re-calculates.
//   accepted          -> edits are sent to the assigned driver as a CHANGE
//                        REQUEST they must Accept (they may already be on
//                        the road). They can also Decline penalty-free, and
//                        the job goes straight back out live to other
//                        drivers with the new details.
//   picked_up +       -> no more edits.
//
// All pricing guardrails (per-item size floors, distance recalc) are
// re-enforced by the server in app/api/jobs/edit.

const CATALOG_SECTIONS: { title: string; sub: string; sizes: (ItemSize | null)[] }[] = [
  { title: 'Heavy & bulky', sub: 'Two people + often a trolley — usually Large', sizes: ['large'] },
  { title: 'Extra large', sub: 'Specialist multi-person moves — usually X-Large', sizes: ['xlarge'] },
  { title: 'Light & easy to load', sub: 'Quick one-person loads — usually Medium', sizes: ['medium'] },
  { title: 'Small items', sub: 'Boxes, bags, small appliances — FREE driver fee', sizes: ['small'] },
  { title: 'Something else', sub: 'Pick a size and describe it — the driver confirms at pickup', sizes: [null] },
]

const SIZE_OPTIONS: { key: ItemSize; name: string; desc: string }[] = [
  { key: 'small', name: 'Small', desc: 'boxes, packs — free' },
  { key: 'medium', name: 'Medium', desc: 'light, one person' },
  { key: 'large', name: 'Large', desc: 'heavy, two people' },
  { key: 'xlarge', name: 'X-Large', desc: 'specialist move' },
]
const SIZE_LABEL: Record<string, string> = { small: 'Small', medium: 'Medium', large: 'Large', xlarge: 'X-Large' }

const money = (n: number | string) => {
  const v = Math.round(Number(n) * 100) / 100
  return Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2)
}

type DraftItem = JobItem & { _photoFile?: File; _photoPreview?: string }
type Spot = { address: string; lat: number | null; lng: number | null }

const EDITABLE_STATUSES = ['unpaid', 'pending', 'accepted']

export default function EditJobPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()

  const [job, setJob] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [triedSave, setTriedSave] = useState(false)

  const [items, setItems] = useState<DraftItem[]>([])
  const [editingItem, setEditingItem] = useState(0)

  // Addresses: lat/lng only ever come from (a) the original job row or (b) a
  // Google suggestion the buyer actually taps — never guessed, so the
  // distance/price is always accurate for a changed location.
  const [pickup, setPickup] = useState<Spot>({ address: '', lat: null, lng: null })
  const [dropoff, setDropoff] = useState<Spot>({ address: '', lat: null, lng: null })
  const [hasSecondPickup, setHasSecondPickup] = useState(false)
  const [secondPickup, setSecondPickup] = useState<Spot>({ address: '', lat: null, lng: null })
  const [hasSecondDropoff, setHasSecondDropoff] = useState(false)
  const [secondDropoff, setSecondDropoff] = useState<Spot>({ address: '', lat: null, lng: null })

  const [schedule, setSchedule] = useState<'asap' | 'scheduled'>('asap')
  const [scheduledFor, setScheduledFor] = useState('')
  const [helperAtPickup, setHelperAtPickup] = useState(false)
  const [helperAtDropoff, setHelperAtDropoff] = useState(false)
  const [helperNote, setHelperNote] = useState('')

  useEffect(() => {
    const load = async () => {
      const { data: row } = await supabase.from('jobs').select('*').eq('id', jobId).maybeSingle()
      if (!row) { setLoading(false); return }
      setJob(row)
      // If a change request is already awaiting the driver, edit THAT version
      // (submitting again just replaces the pending request).
      const src = row.pending_changes?.fields && row.status === 'accepted' ? { ...row, ...row.pending_changes.fields } : row
      const srcItems: any[] = Array.isArray(src.items) && src.items.length
        ? src.items
        : [{ item_type: src.item_type, item_size: src.item_size, description: src.item_description, photo_url: src.photo_url }]
      setItems(srcItems.map((it: any) => ({
        item_type: it.item_type ?? '', item_size: it.item_size ?? 'medium',
        description: it.description ?? '', photo_url: it.photo_url ?? null,
      })))
      setPickup({ address: src.pickup_address ?? '', lat: src.pickup_lat ?? null, lng: src.pickup_lng ?? null })
      setDropoff({ address: src.dropoff_address ?? '', lat: src.dropoff_lat ?? null, lng: src.dropoff_lng ?? null })
      setHasSecondPickup(!!src.second_pickup_address)
      setSecondPickup({ address: src.second_pickup_address ?? '', lat: src.second_pickup_lat ?? null, lng: src.second_pickup_lng ?? null })
      setHasSecondDropoff(!!src.second_dropoff_address)
      setSecondDropoff({ address: src.second_dropoff_address ?? '', lat: src.second_dropoff_lat ?? null, lng: src.second_dropoff_lng ?? null })
      setSchedule(src.scheduled_for ? 'scheduled' : 'asap')
      setScheduledFor(src.scheduled_for ? String(src.scheduled_for).slice(0, 16) : '')
      setHelperAtPickup(!!src.helper_at_pickup)
      setHelperAtDropoff(!!src.helper_at_dropoff)
      setHelperNote(src.helper_note ?? '')
      setLoading(false)
    }
    load()
  }, [jobId])

  const currentItem = items[editingItem]
  const currentEntry = currentItem?.item_type ? catalogEntry(currentItem.item_type) : undefined
  const currentAllowed = currentItem?.item_type ? allowedSizes(currentItem.item_type) : SIZE_OPTIONS.map(s => s.key)
  const setCurrentItem = (patch: Partial<DraftItem>) =>
    setItems(prev => prev.map((it, i) => i === editingItem ? { ...it, ...patch } : it))

  const pickItemType = (name: string) => {
    const entry = catalogEntry(name)
    setCurrentItem({ item_type: name, item_size: entry?.size ?? 'medium' })
  }
  const addItem = () => { setItems(prev => [...prev, { item_type: '', item_size: 'medium', description: '', photo_url: null }]); setEditingItem(items.length) }
  const removeItem = (idx: number) => { setItems(prev => prev.filter((_, i) => i !== idx)); setEditingItem(0) }
  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCurrentItem({ _photoFile: file, _photoPreview: URL.createObjectURL(file) })
  }

  // Live price preview from the CURRENT draft
  const km = (pickup.lat != null && pickup.lng != null && dropoff.lat != null && dropoff.lng != null)
    ? haversineKm(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng)
    : null
  const price = calculatePrice(
    items.map(it => ({ size: it.item_size, label: `${it.item_type || 'Item'} (${SIZE_LABEL[it.item_size] ?? it.item_size})`, type: it.item_type })),
    km ?? 0,
    { secondPickup: hasSecondPickup && !!secondPickup.address, secondDropoff: hasSecondDropoff && !!secondDropoff.address }
  )
  const feeChanged = job && Number(job.driver_fee) !== price.driverFee

  const firstInvalidIdx = items.findIndex(it => !it.item_type || !it.description.trim() || !(it._photoFile || it.photo_url))
  const descMissing = triedSave && currentItem && !currentItem.description.trim()
  const photoMissing = triedSave && currentItem && !(currentItem._photoFile || currentItem.photo_url)

  const resolveSpot = (spot: Spot, origAddress: string | null, origLat: number | null, origLng: number | null, label: string) => {
    const addr = spot.address.trim()
    if (spot.lat != null && spot.lng != null) return { address: addr, lat: spot.lat, lng: spot.lng }
    if (addr && addr === (origAddress ?? '')) return { address: addr, lat: origLat, lng: origLng }
    throw new Error(`Please pick the ${label} address from the suggestion list so the distance stays accurate.`)
  }

  const handleSave = async () => {
    if (!job) return
    setError('')
    if (firstInvalidIdx !== -1) { setEditingItem(firstInvalidIdx); setTriedSave(true); return }
    if (schedule === 'scheduled' && !scheduledFor) { setError('Pick a date & time, or switch to ASAP.'); return }
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Upload any replaced photos
      const hydrated: JobItem[] = []
      for (const it of items) {
        let photo_url = it.photo_url ?? null
        if (it._photoFile) {
          const ext = it._photoFile.name.split('.').pop()
          const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
          const { data: up, error: upErr } = await supabase.storage.from('job-photos').upload(path, it._photoFile)
          if (upErr || !up) throw new Error(`Photo upload failed${upErr?.message ? ` (${upErr.message})` : ''} — please try again.`)
          photo_url = supabase.storage.from('job-photos').getPublicUrl(path).data.publicUrl
        }
        hydrated.push({ item_type: it.item_type, item_size: it.item_size, description: it.description.trim(), photo_url })
      }

      const p = resolveSpot(pickup, job.pickup_address, job.pickup_lat, job.pickup_lng, 'pickup')
      const d = resolveSpot(dropoff, job.dropoff_address, job.dropoff_lat, job.dropoff_lng, 'dropoff')
      const sp = hasSecondPickup && secondPickup.address.trim()
        ? resolveSpot(secondPickup, job.second_pickup_address, job.second_pickup_lat, job.second_pickup_lng, '2nd pickup') : null
      const sd = hasSecondDropoff && secondDropoff.address.trim()
        ? resolveSpot(secondDropoff, job.second_dropoff_address, job.second_dropoff_lat, job.second_dropoff_lng, '2nd dropoff') : null

      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/jobs/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({
          jobId,
          changes: {
            items: hydrated,
            pickup_address: p.address, pickup_lat: p.lat, pickup_lng: p.lng,
            dropoff_address: d.address, dropoff_lat: d.lat, dropoff_lng: d.lng,
            second_pickup_address: sp?.address ?? null, second_pickup_lat: sp?.lat ?? null, second_pickup_lng: sp?.lng ?? null,
            second_dropoff_address: sd?.address ?? null, second_dropoff_lat: sd?.lat ?? null, second_dropoff_lng: sd?.lng ?? null,
            scheduled_for: schedule === 'scheduled' ? scheduledFor : null,
            helper_at_pickup: helperAtPickup, helper_at_dropoff: helperAtDropoff, helper_note: helperNote,
          },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not save your changes — please try again.')
      if (data.pendingApproval) {
        alert('✅ Changes sent to your driver for approval. They\'ve been notified urgently and will keep being reminded until they respond. If they can\'t take the updated job, it goes straight back out to other drivers — no fee.')
      }
      router.push(`/buyer/tracking/${jobId}`)
      return
    } catch (e: any) {
      setError(e.message || 'Could not save your changes.')
    }
    setSaving(false)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="text-5xl animate-bounce">🚐</div></div>
  if (!job) return (
    <div><Nav />
      <div className="max-w-lg mx-auto px-4 pt-24 pb-12 text-center">
        <div className="text-5xl mb-3">🤔</div>
        <p className="font-bold text-slate-700 mb-1">We couldn't find that job</p>
        <a href="/buyer/dashboard" className="btn-primary inline-block py-2.5 px-5 mt-4">Go to my jobs</a>
      </div>
    </div>
  )
  if (!EDITABLE_STATUSES.includes(job.status)) return (
    <div><Nav />
      <div className="max-w-lg mx-auto px-4 pt-24 pb-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <p className="font-bold text-slate-700 mb-1">This job can no longer be edited</p>
        <p className="text-sm text-slate-500">{job.status === 'picked_up' ? 'The item has already been picked up and is on its way.' : 'Only active jobs can be edited.'}</p>
        <a href={`/buyer/tracking/${jobId}`} className="btn-primary inline-block py-2.5 px-5 mt-4">Back to tracking</a>
      </div>
    </div>
  )

  const accepted = job.status === 'accepted'

  return (
    <div>
      <Nav />
      <div className="max-w-xl mx-auto px-4 pt-24 pb-16">
        <div className="flex items-center justify-between mb-4">
          <a href={`/buyer/tracking/${jobId}`} className="text-sm font-semibold text-slate-500 hover:text-slate-700">← Back to tracking</a>
        </div>
        <h1 className="text-2xl font-black mb-1">Edit your job</h1>
        <p className="text-slate-500 text-sm mb-4">Fix a wrong suburb, change the location, item or time — the price updates automatically.</p>

        {accepted ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 mb-5">
            🚐 <strong>A driver is already on this job.</strong> Your changes will be sent to them as a request — nothing changes until they press Accept. They'll be notified urgently (and reminded until they respond). If the new details don't suit them they can decline penalty-free, and your job automatically goes back out live to other drivers with your new details — no fee to you.
            {job.pending_changes && <div className="mt-2 font-semibold">You already have changes awaiting their approval — saving again replaces that request.</div>}
          </div>
        ) : (
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800 mb-5">
            ⚡ <strong>No driver has accepted yet</strong>, so your changes apply instantly and your price re-calculates on the spot.
          </div>
        )}

        <div className="space-y-6">
          {/* ── Items ── */}
          <div className="card">
            <h2 className="font-bold text-sm text-slate-500 mb-3">Items</h2>
            {items.length > 1 && (
              <div className="flex gap-2 flex-wrap mb-4">
                {items.map((it, i) => (
                  <button key={i} onClick={() => setEditingItem(i)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold border transition-all ${editingItem === i ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-slate-600 border-slate-200 hover:border-orange-300'}`}>
                    {catalogEntry(it.item_type)?.icon || '📦'} Item {i + 1}
                    {i > 0 && <span onClick={e => { e.stopPropagation(); removeItem(i) }} className="ml-1 text-xs opacity-60 hover:opacity-100">×</span>}
                  </button>
                ))}
                <button onClick={addItem} className="px-3 py-1.5 rounded-full text-sm font-semibold border-2 border-dashed border-orange-300 text-orange-500 hover:bg-orange-50">+ Add item</button>
              </div>
            )}

            {currentItem && (
              <div className="space-y-4">
                <div>
                  <label className="label">What are you moving? *</label>
                  <div className="space-y-3">
                    {CATALOG_SECTIONS.map(section => {
                      const entries = ITEM_CATALOG.filter(e => section.sizes.includes(e.size))
                      if (!entries.length) return null
                      return (
                        <div key={section.title}>
                          <div className="flex items-baseline justify-between mb-1.5">
                            <span className="text-xs font-bold text-slate-600">{section.title}</span>
                            <span className="text-[11px] text-slate-400">{section.sub}</span>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {entries.map(it => (
                              <button key={it.name} type="button" onClick={() => pickItemType(it.name)}
                                className={`border-2 rounded-xl py-2.5 px-1.5 text-center transition-all ${currentItem.item_type === it.name ? 'border-orange-500 bg-orange-50' : 'border-slate-200 hover:border-orange-300 bg-white'}`}>
                                <div className="text-xl mb-0.5">{it.icon}</div>
                                <div className="text-[11px] font-semibold text-slate-700 leading-tight">{it.label}</div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {currentItem.item_type && (
                  <div>
                    <label className="label">How big is it? *</label>
                    {currentEntry?.loadNote && <p className="text-xs text-slate-500 mb-2">{currentEntry.loadNote}</p>}
                    <div className="grid grid-cols-2 gap-2">
                      {SIZE_OPTIONS.filter(s => currentAllowed.includes(s.key)).map(s => (
                        <button key={s.key} type="button" onClick={() => setCurrentItem({ item_size: s.key })}
                          className={`border-2 rounded-xl py-3 px-2 text-center transition-all ${currentItem.item_size === s.key ? 'border-orange-500 bg-orange-50' : 'border-slate-200 hover:border-orange-300 bg-white'}`}>
                          <div className="font-bold text-sm text-slate-800">{s.name}{currentEntry?.size === s.key && <span className="ml-1 text-[10px] font-semibold text-orange-500">(typical)</span>}</div>
                          <div className="text-xs text-slate-500 mt-0.5">{s.desc}</div>
                        </button>
                      ))}
                    </div>
                    {currentAllowed[0] !== 'small' && (
                      <p className="text-xs text-slate-400 mt-1.5">⚖️ Minimum for this item: <strong>{SIZE_LABEL[currentAllowed[0]]}</strong>.</p>
                    )}
                  </div>
                )}

                <div>
                  <label className="label">Describe the item *</label>
                  <textarea className={`input resize-none ${descMissing ? 'border-red-400 ring-2 ring-red-200' : ''}`} rows={2}
                    value={currentItem.description} onChange={e => setCurrentItem({ description: e.target.value })} />
                  {descMissing && <p className="text-xs text-red-500 font-semibold mt-1">A description is required.</p>}
                </div>

                <div>
                  <label className="label">Photo *</label>
                  {currentItem._photoPreview || currentItem.photo_url ? (
                    <div className="relative rounded-xl overflow-hidden h-36 bg-slate-100">
                      <img src={currentItem._photoPreview || currentItem.photo_url || ''} alt="Item" className="w-full h-full object-cover" />
                      <label className="absolute bottom-2 right-2 bg-black/60 text-white text-xs font-semibold px-3 py-1.5 rounded-full cursor-pointer">
                        📸 Replace photo
                        <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
                      </label>
                    </div>
                  ) : (
                    <label className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center cursor-pointer bg-slate-50 ${photoMissing ? 'border-red-400 ring-2 ring-red-200' : 'border-slate-200 hover:border-orange-400'}`}>
                      <span className="text-3xl mb-1">📸</span>
                      <span className="text-sm text-slate-500"><strong className="text-orange-500">Add a photo</strong> — required</span>
                      <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
                    </label>
                  )}
                </div>
              </div>
            )}
            {items.length === 1 && (
              <button onClick={addItem} className="w-full border-2 border-dashed border-orange-200 rounded-xl py-2.5 text-sm font-semibold text-orange-500 hover:bg-orange-50 mt-4">+ Add another item</button>
            )}
          </div>

          {/* ── Addresses ── */}
          <div className="card">
            <h2 className="font-bold text-sm text-slate-500 mb-3">Pickup & dropoff</h2>
            <div className="space-y-3">
              <div>
                <div className="text-xs font-semibold text-slate-500 mb-1">🟢 Current pickup: <span className="text-slate-700">{pickup.address || '—'}</span></div>
                <AddressAutocomplete placeholder="Type to change the pickup address" value={pickup.address}
                  onChange={(address, lat, lng) => setPickup({ address, lat, lng })} />
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500 mb-1">🔴 Current dropoff: <span className="text-slate-700">{dropoff.address || '—'}</span></div>
                <AddressAutocomplete placeholder="Type to change the dropoff address" value={dropoff.address}
                  onChange={(address, lat, lng) => setDropoff({ address, lat, lng })} />
              </div>
              <p className="text-xs text-slate-400">Pick the new address from the suggestion list — the distance and price update automatically.</p>

              <label className="flex items-center justify-between gap-3 p-3 rounded-xl border-2 border-slate-200 cursor-pointer has-[:checked]:border-green-500 has-[:checked]:bg-green-50">
                <div className="text-sm font-semibold text-slate-800">➕ 2nd pickup (+${EXTRA_STOP_FEE})</div>
                <input type="checkbox" checked={hasSecondPickup} onChange={e => setHasSecondPickup(e.target.checked)} className="w-5 h-5 accent-green-500" />
              </label>
              {hasSecondPickup && (
                <div>
                  {secondPickup.address && <div className="text-xs font-semibold text-slate-500 mb-1">Current: {secondPickup.address}</div>}
                  <AddressAutocomplete placeholder="2nd pickup address" value={secondPickup.address}
                    onChange={(address, lat, lng) => setSecondPickup({ address, lat, lng })} />
                </div>
              )}
              <label className="flex items-center justify-between gap-3 p-3 rounded-xl border-2 border-slate-200 cursor-pointer has-[:checked]:border-orange-500 has-[:checked]:bg-orange-50">
                <div className="text-sm font-semibold text-slate-800">➕ 2nd dropoff (+${EXTRA_STOP_FEE})</div>
                <input type="checkbox" checked={hasSecondDropoff} onChange={e => setHasSecondDropoff(e.target.checked)} className="w-5 h-5 accent-orange-500" />
              </label>
              {hasSecondDropoff && (
                <div>
                  {secondDropoff.address && <div className="text-xs font-semibold text-slate-500 mb-1">Current: {secondDropoff.address}</div>}
                  <AddressAutocomplete placeholder="2nd dropoff address" value={secondDropoff.address}
                    onChange={(address, lat, lng) => setSecondDropoff({ address, lat, lng })} />
                </div>
              )}
            </div>
          </div>

          {/* ── Schedule & helpers ── */}
          <div className="card space-y-4">
            <div>
              <label className="label">When do you need it?</label>
              <div className="flex gap-2">
                {[{ key: 'asap', title: '⚡ ASAP' }, { key: 'scheduled', title: '📅 Schedule' }].map(s => (
                  <button key={s.key} type="button" onClick={() => setSchedule(s.key as any)}
                    className={`flex-1 border-2 rounded-xl py-2.5 px-3 text-center font-bold text-sm transition-all ${schedule === s.key ? 'border-orange-500 bg-orange-50' : 'border-slate-200 bg-white hover:border-orange-300'}`}>
                    {s.title}
                  </button>
                ))}
              </div>
              {schedule === 'scheduled' && (
                <input type="datetime-local" className="input mt-3" value={scheduledFor} onChange={e => setScheduledFor(e.target.value)} />
              )}
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer p-3 rounded-xl border-2 border-slate-200 has-[:checked]:border-orange-500 has-[:checked]:bg-orange-50">
                <input type="checkbox" checked={helperAtPickup} onChange={e => setHelperAtPickup(e.target.checked)} className="w-5 h-5 accent-orange-500" />
                <span className="text-sm font-semibold text-slate-800">Someone at the pickup will help carry</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer p-3 rounded-xl border-2 border-slate-200 has-[:checked]:border-orange-500 has-[:checked]:bg-orange-50">
                <input type="checkbox" checked={helperAtDropoff} onChange={e => setHelperAtDropoff(e.target.checked)} className="w-5 h-5 accent-orange-500" />
                <span className="text-sm font-semibold text-slate-800">Someone at the dropoff will help receive it</span>
              </label>
            </div>
            <div>
              <label className="label">Note for the driver (helpers, access, parking…)</label>
              <input className="input" value={helperNote} onChange={e => setHelperNote(e.target.value)}
                placeholder='e.g. "My brother helps at pickup — narrow front door, park in driveway"' />
            </div>
          </div>

          {/* ── Price ── */}
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
            <div className="text-sm font-bold text-orange-800 mb-2">💰 Updated price</div>
            {km != null && <div className="text-xs text-orange-700 mb-2">📍 {km.toFixed(1)} km · distance charge ${price.distanceFee}</div>}
            {price.quoteRequired && (
              <div className="bg-amber-100 border border-amber-300 rounded-lg px-3 py-2 text-xs text-amber-800 mb-2">🚚 Over 150 km — that needs a custom quote, so it can't be saved here.</div>
            )}
            <div className="flex justify-between text-sm"><span className="text-orange-700">Driver fee (cash / PayID on delivery)</span>
              <span className="font-bold">
                {feeChanged ? (<><span className="line-through text-orange-300 mr-1.5">${money(job.driver_fee)}</span><span className="text-green-700">${money(price.driverFee)}</span></>) : <>${money(price.driverFee)}</>}
              </span>
            </div>
            <div className="flex justify-between text-sm mt-1"><span className="text-orange-700">Service fee</span><span className="font-bold">${money(job.service_fee)}{job.status === 'unpaid' ? ' (unpaid)' : ' (already paid — no extra charge)'}</span></div>
            {accepted && feeChanged && <p className="text-xs text-orange-600 mt-2">The new cash fee applies once your driver accepts the changes.</p>}
          </div>

          {error && <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3">
            <a href={`/buyer/tracking/${jobId}`} className="btn-secondary flex-1 justify-center text-center">Cancel</a>
            <button onClick={handleSave} disabled={saving || price.quoteRequired}
              className="btn-primary flex-[2] justify-center disabled:opacity-50">
              {saving ? 'Saving…' : accepted ? '📨 Send changes to my driver' : '💾 Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
