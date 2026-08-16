'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import MessageThread from '@/components/MessageThread'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { haversineKm } from '@/lib/pricing'
import type { Job, ItemSize } from '@/types'

const NEXT_STATUS: Record<string, { status: string; label: string; note: string }> = {
accepted: { status: 'picked_up', label: 'Mark as Picked Up', note: 'Item collected from seller — pickup photo taken' },
picked_up: { status: 'delivered', label: 'Mark as Delivered', note: 'Item delivered to customer — delivery photo taken' },
}

// Proof-photo requirements per step (legal proof + customer notification):
// the driver CANNOT progress the job without taking the photo.
const PROOF_LABEL: Record<string, { title: string; hint: string; column: 'pickup_photo_url' | 'dropoff_photo_url' }> = {
accepted: { title: '📸 Photo of the loaded item', hint: 'Take a photo of the item secured on your vehicle before marking as picked up. This protects you and notifies the customer.', column: 'pickup_photo_url' },
picked_up: { title: '📸 Photo at the dropoff', hint: 'Take a photo of the item at the delivery point before marking as delivered. This is your proof of delivery.', column: 'dropoff_photo_url' },
}

// Statuses during which this driver's live location should be broadcast to
// the customer. Location sharing stops the moment the job leaves this set
// (delivered, or the effect cleans up on unmount) -- for privacy.
const LIVE_TRACKING_STATUSES = ['accepted', 'picked_up']

const SIZE_LABEL: Record<string, string> = { small: 'Small', medium: 'Medium', large: 'Large', xlarge: 'X-Large' }
const SIZE_ORDER = ['small', 'medium', 'large', 'xlarge']

// Clean money display: never show floating-point junk like 21.990000000000002.
const money = (n: number | string) => {
const v = Math.round(Number(n) * 100) / 100
return Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2)
}

export default function DriverJobPage() {
const { jobId } = useParams<{ jobId: string }>()
const router = useRouter()
const supabase = createSupabaseBrowserClient()
const [job, setJob] = useState<Job | null>(null)
const [loading, setLoading] = useState(true)
const [updating, setUpdating] = useState(false)
const [locationSharing, setLocationSharing] = useState<'idle' | 'active' | 'denied' | 'unsupported'>('idle')
// Bumping this re-runs the geolocation effect below -- lets the driver
// retry after actually turning location on in their device Settings,
// without having to leave and re-open the job.
const [locationRetry, setLocationRetry] = useState(0)
const [showMessages, setShowMessages] = useState(false)

// Proof photo (required to advance the job)
const [proofFile, setProofFile] = useState<File | null>(null)
const [proofPreview, setProofPreview] = useState<string | null>(null)

// Delivery note (optional) -- extra context posted with the final delivery
// photo, e.g. "left at the front of the house" or "no one home, left in
// the driveway". Shown to the customer on their tracking page.
const [deliveryNote, setDeliveryNote] = useState('')

// Driver price re-rate at pickup (item bigger than described)
const [showAdjust, setShowAdjust] = useState(false)
const [adjusting, setAdjusting] = useState(false)
const [adjustError, setAdjustError] = useState('')

// Customer change-request (Uber-style): the buyer edited the job after
// this driver accepted. Nothing changes until the driver responds here.
const [responding, setResponding] = useState(false)

const fetchJob = () =>
supabase.from('jobs').select('*, buyer:profiles(full_name)').eq('id', jobId).single()
.then(({ data }) => { setJob(data as Job); setLoading(false) })

useEffect(() => { fetchJob() }, [jobId])

// Realtime: refresh this page the moment the job row changes — most
// importantly when the customer submits a change request while the driver
// has this screen open (the red banner appears instantly), or when the
// request is superseded/cleared.
useEffect(() => {
const channel = supabase.channel(`driver-job-${jobId}`)
.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `id=eq.${jobId}` }, fetchJob)
.subscribe()
return () => { supabase.removeChannel(channel) }
}, [jobId])

// Share this driver's live GPS position while the job is actively out for
// delivery, so the customer can see the driver approaching on the map (like
// Uber Eats). Stops automatically once the job is delivered or this page
// is left, and never runs for any other job status.
//
// Vanute policy: live location sharing is mandatory during an active job,
// not just a nice-to-have -- if it's denied or unavailable, advanceStatus()
// below refuses to let the driver progress the job (see `locationBlocked`),
// because a customer mid-delivery needs to be able to see the driver.
useEffect(() => {
if (!job || !job.driver_id) return
if (!LIVE_TRACKING_STATUSES.includes(job.status)) return
if (!('geolocation' in navigator)) { setLocationSharing('unsupported'); return }

setLocationSharing('idle')
let lastSent = 0
const watchId = navigator.geolocation.watchPosition(
(pos) => {
setLocationSharing('active')
const now = Date.now()
if (now - lastSent < 8000) return // throttle writes to roughly every 8s
lastSent = now
supabase.from('drivers').update({
current_lat: pos.coords.latitude,
current_lng: pos.coords.longitude,
location_updated_at: new Date().toISOString(),
}).eq('id', job.driver_id).then()
},
() => { setLocationSharing('denied') },
{ enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
)

return () => navigator.geolocation.clearWatch(watchId)
}, [job?.status, job?.driver_id, locationRetry])

const handleProofChange = (e: React.ChangeEvent<HTMLInputElement>) => {
const file = e.target.files?.[0]
if (!file) return
setProofFile(file)
setProofPreview(URL.createObjectURL(file))
}

const advanceStatus = async () => {
if (!job) return
// HARD GATE: while the customer's change request is unanswered, the job
// cannot progress — the driver must Accept or Decline the changes first
// (they may otherwise pick up the wrong item or drive to the old address).
if ((job as any).pending_changes?.fields && job.status === 'accepted') {
alert('The customer changed this job — please Accept or Decline the changes first (red banner above).')
return
}
// HARD GATE: live location sharing is mandatory during an active job --
// a customer relying on live tracking must never be left with a driver
// who silently stopped sharing their position.
if (LIVE_TRACKING_STATUSES.includes(job.status) && (locationSharing === 'denied' || locationSharing === 'unsupported')) {
alert("Vanute needs your location shared to continue this delivery, so the customer can see you're on the way. Please enable location for Vanute and try again (see the red banner above).")
return
}
const next = NEXT_STATUS[job.status]
const proof = PROOF_LABEL[job.status]
if (!next) return
// Photo-gated: no proof photo, no progress.
if (proof && !proofFile) return
setUpdating(true)

// Upload the proof photo to the public job-photos bucket first.
let proofUrl: string | null = null
if (proof && proofFile) {
const ext = proofFile.name.split('.').pop() || 'jpg'
const path = `proof/${jobId}/${proof.column === 'pickup_photo_url' ? 'pickup' : 'dropoff'}-${Date.now()}.${ext}`
const { data: up, error: upErr } = await supabase.storage.from('job-photos').upload(path, proofFile)
if (upErr || !up) {
// Surface the real reason (e.g. a missing storage policy) instead of a
// generic message -- this gate must never block a delivery silently.
alert(`Could not upload the photo${upErr?.message ? `: ${upErr.message}` : ' — check your connection and try again'}.`)
setUpdating(false)
return
}
const { data: { publicUrl } } = supabase.storage.from('job-photos').getPublicUrl(path)
proofUrl = publicUrl
}

// Stamp the delivery-lifecycle timestamps so we can measure pickup ETA and
// total job time for the data-driven pricing analytics (see PRICING policy).
const patch: any = { status: next.status }
if (next.status === 'picked_up') { patch.picked_up_at = new Date().toISOString(); patch.pickup_photo_url = proofUrl }
if (next.status === 'delivered') {
patch.delivered_at = new Date().toISOString()
patch.dropoff_photo_url = proofUrl
// Save the driver's delivery note with the final photo so the customer
// sees exactly where/how their item was left.
patch.delivery_note = deliveryNote.trim() || null
}
const { error: updErr } = await supabase.from('jobs').update(patch).eq('id', jobId)
if (updErr) {
alert('Could not update the job — please try again.')
setUpdating(false)
return
}
await supabase.from('job_status_events').insert({
job_id: jobId,
status: next.status,
note: next.status === 'delivered' && deliveryNote.trim()
? `${next.note} — Driver note: ${deliveryNote.trim()}`
: next.note,
})
setProofFile(null)
setProofPreview(null)
if (next.status === 'delivered') {
// Privacy: stop showing this driver's location to anyone once the job is done.
if (job.driver_id) {
await supabase.from('drivers').update({
current_lat: null, current_lng: null, location_updated_at: null,
}).eq('id', job.driver_id)
}
router.push('/driver/dashboard')
} else {
setJob(j => j ? { ...j, status: next.status as any } : j)
}
setUpdating(false)
}

// Respond to the customer's change request. Accept applies the new details
// to the job; Decline releases the driver penalty-free and puts the job
// (with the customer's new details) straight back into the live pool.
const respondChange = async (action: 'accept' | 'decline') => {
if (!job) return
const pcFields = (job as any).pending_changes?.fields
const confirmMsg = action === 'accept'
? `Accept the customer's changes? The job updates to the new details${pcFields?.driver_fee != null ? ` and the cash fee becomes $${money(pcFields.driver_fee)}` : ''}.`
: "Decline the changes and release this job? No penalty for you — it goes back into the pool for other drivers and you're free to take other jobs."
if (!window.confirm(confirmMsg)) return
setResponding(true)
try {
const { data: { session } } = await supabase.auth.getSession()
const res = await fetch('/api/jobs/respond-change', {
method: 'POST',
headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
body: JSON.stringify({ jobId, action }),
})
const data = await res.json()
if (!res.ok) {
alert(data.error || 'Could not submit your response — please try again.')
setResponding(false)
return
}
if (action === 'decline') {
alert("You've been released from this job — no penalty. It's back in the pool for other drivers.")
router.push('/driver/dashboard')
return
}
await fetchJob()
alert('Changes accepted — the job below now shows the updated details.')
} catch {
alert('Could not submit your response — check your connection.')
}
setResponding(false)
}

// Call the customer. Numbers stay hidden from the page itself -- the server
// route only hands out the other party's number to a job participant while
// the job is actually active (accepted / picked_up).
const callCustomer = async () => {
try {
const { data: { session } } = await supabase.auth.getSession()
const res = await fetch(`/api/jobs/contact?jobId=${jobId}`, {
headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
})
const data = await res.json()
if (!res.ok || !data.phone) { alert(data.error || 'Could not get the number — use the chat instead.'); return }
window.location.href = `tel:${data.phone}`
} catch {
alert('Could not get the number — use the chat instead.')
}
}

// Driver re-rate at pickup: the item in person is bigger/heavier than
// described. Goes through a server route (never a direct client update of
// driver_fee) so the change is validated, logged and shown to the customer.
const adjustSize = async (newSize: ItemSize) => {
if (!job) return
setAdjusting(true)
setAdjustError('')
try {
const { data: { session } } = await supabase.auth.getSession()
const res = await fetch('/api/jobs/adjust-price', {
method: 'POST',
headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
body: JSON.stringify({ jobId, newSize }),
})
const data = await res.json()
if (!res.ok) { setAdjustError(data.error || 'Could not adjust the price.'); setAdjusting(false); return }
await fetchJob()
setShowAdjust(false)
alert(`Size updated to ${SIZE_LABEL[newSize]}. New cash fee: $${data.driverFee}. The customer has been notified on their tracking page.`)
} catch {
setAdjustError('Could not adjust the price — check your connection.')
}
setAdjusting(false)
}

// Drivers can cancel an accepted job. If they're already very close to the
// pickup, we warn them first (they're almost there). On cancel the job goes
// back into the pool as 'pending' for another driver to accept.
const cancelJob = async () => {
if (!job) return
const pLat = Number((job as any).pickup_lat)
const pLng = Number((job as any).pickup_lng)
const havePickupCoords = Number.isFinite(pLat) && Number.isFinite(pLng)

const ok = await new Promise<boolean>((resolve) => {
const plainMsg = 'Cancel this job? It will be offered to other drivers.'
if (!havePickupCoords || !('geolocation' in navigator)) return resolve(window.confirm(plainMsg))
navigator.geolocation.getCurrentPosition(
(pos) => {
const km = haversineKm(pos.coords.latitude, pos.coords.longitude, pLat, pLng)
resolve(window.confirm(km < 3
? `You're only ${km.toFixed(1)} km from the pickup -- you're almost there. Are you sure you want to cancel?`
: plainMsg))
},
() => resolve(window.confirm(plainMsg)),
{ enableHighAccuracy: true, timeout: 8000 }
)
})
if (!ok) return

setUpdating(true)
await supabase.from('jobs').update({
driver_id: null,
status: 'pending',
cancelled_at: new Date().toISOString(),
cancellation_stage: 'driver',
} as any).eq('id', jobId)
await supabase.from('job_status_events').insert({
job_id: jobId, status: 'pending', note: 'Driver cancelled -- returned to pool',
})
if (job.driver_id) {
await supabase.from('drivers').update({
current_lat: null, current_lng: null, location_updated_at: null,
}).eq('id', job.driver_id)
}
router.push('/driver/dashboard')
}

if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="text-5xl animate-bounce">Loading...</div></div>
if (!job) return <div className="min-h-screen flex items-center justify-center">Job not found.</div>

const pc: any = (job as any).pending_changes
const changesPending = !!pc?.fields && job.status === 'accepted'
const newFee = pc?.fields?.driver_fee
const nextAction = NEXT_STATUS[job.status]
const proofNeeded = PROOF_LABEL[job.status]
const showLocationBanner = LIVE_TRACKING_STATUSES.includes(job.status)
const locationBlocked = showLocationBanner && (locationSharing === 'denied' || locationSharing === 'unsupported')
const hasExtraStops = !!(job.second_pickup_address || job.second_dropoff_address)
const canCancel = job.status === 'accepted' || job.status === 'picked_up'
const canAdjust = (job.status === 'accepted' || job.status === 'picked_up') && !changesPending
const biggerSizes = SIZE_ORDER.slice(SIZE_ORDER.indexOf(job.item_size) + 1) as ItemSize[]
const itemPhotos = (Array.isArray((job as any).items) ? (job as any).items.map((it: any) => it?.photo_url) : [job.photo_url]).filter(Boolean)

return (
<div>
<Nav />
<div className="max-w-lg mx-auto px-4 pt-24 pb-12 space-y-4">
<div className="flex items-center justify-between">
<h1 className="text-xl font-black">Active Job</h1>
<span className="badge-orange capitalize">{job.status.replace('_',' ')}</span>
</div>

{/* 🚨 CUSTOMER CHANGE REQUEST — must be answered before anything else */}
{changesPending && (
<div className="bg-red-50 border-2 border-red-300 rounded-2xl p-4">
<div className="font-black text-red-700 mb-1">🚨 The customer CHANGED this job</div>
<p className="text-xs text-red-600 mb-2">
Don't keep driving on the old details. Review the changes below, then <strong>Accept</strong> to continue with the new details — or <strong>Decline</strong> to be released penalty-free (the job goes back to the pool for other drivers).
</p>
{Array.isArray(pc?.summary) && pc.summary.length > 0 && (
<ul className="list-disc ml-4 space-y-1 text-sm text-slate-700 mb-2">
{pc.summary.map((s: string, i: number) => <li key={i}>{s}</li>)}
</ul>
)}
{pc?.fields?.scheduled_for && (
<p className="text-xs text-slate-600 mb-1">🕒 New pickup time: {new Date(pc.fields.scheduled_for).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
)}
{newFee != null && (
<p className="text-sm font-bold text-slate-800 mb-3">New cash / PayID fee: ${money(newFee)}{Number(newFee) !== Number(job.driver_fee) ? ` (was $${money(job.driver_fee)})` : ''}</p>
)}
<div className="flex gap-2">
<button onClick={() => respondChange('accept')} disabled={responding}
className="flex-1 bg-green-600 text-white font-bold py-3 rounded-xl text-sm hover:bg-green-700 transition-colors disabled:opacity-50">
{responding ? '...' : '✅ Accept changes'}
</button>
<button onClick={() => respondChange('decline')} disabled={responding}
className="flex-1 bg-white border-2 border-red-300 text-red-600 font-bold py-3 rounded-xl text-sm hover:bg-red-50 transition-colors disabled:opacity-50">
{responding ? '...' : '↩️ Decline — release job'}
</button>
</div>
<p className="text-[11px] text-slate-500 mt-2">Declining is penalty-free for you — the customer changed the deal after you accepted.</p>
</div>
)}

{/* 🚨 LOCATION PERMISSION REQUIRED — mirrors the change-request banner's
severity since a customer relying on live tracking can't be left without
it. Denied is retry-able (the driver may have just fixed it in Settings);
unsupported has no retry path on this device. */}
{locationBlocked && (
<div className="bg-red-50 border-2 border-red-300 rounded-2xl p-4">
<div className="font-black text-red-700 mb-1">🚨 Location sharing is off</div>
<p className="text-xs text-red-600 mb-3">
Vanute needs your live location while this delivery is active so the customer can see you're on the way. {locationSharing === 'denied'
? 'Turn on location permission for Vanute in your phone\'s Settings, then tap Try again below.'
: "Live location isn't available on this device, so this delivery can't continue to be tracked -- please contact Vanute support if you're stuck."}
</p>
{locationSharing === 'denied' && (
<button onClick={() => setLocationRetry(r => r + 1)}
className="w-full bg-red-600 text-white font-bold py-2.5 rounded-xl text-sm hover:bg-red-700 transition-colors">
🔄 Try again
</button>
)}
</div>
)}

{showLocationBanner && !locationBlocked && (
<div className={`rounded-xl px-4 py-2.5 text-xs font-semibold flex items-center gap-2 ${
locationSharing === 'active' ? 'bg-green-50 border border-green-200 text-green-700'
: 'bg-slate-50 border border-slate-200 text-slate-500'
}`}>
{locationSharing === 'active' && (<><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Sharing your live location with the customer</>)}
{locationSharing === 'idle' && (<>📍 Starting live location sharing...</>)}
</div>
)}

{hasExtraStops && (
<div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-xs font-semibold text-blue-700">
🧭 This job has extra stops -- check the route below before accepting the next step
</div>
)}

<div className="card">
<h2 className="font-bold text-sm text-slate-500 mb-4">Route</h2>
<div className="flex gap-3 items-start mb-3">
<div className="flex flex-col items-center pt-1">
<div className="w-3 h-3 rounded-full bg-green-500" />
<div className="w-0.5 h-8 bg-slate-200 my-1" />
<div className="w-3 h-3 rounded-full bg-orange-500" />
</div>
<div className="space-y-4 flex-1">
<div>
<div className="text-xs font-semibold text-slate-500 mb-0.5">PICKUP</div>
<div className="font-semibold text-sm">{job.pickup_address}</div>
</div>
{job.second_pickup_address && (
<div>
<div className="text-xs font-semibold text-slate-500 mb-0.5">2ND PICKUP</div>
<div className="font-semibold text-sm">{job.second_pickup_address}</div>
</div>
)}
<div>
<div className="text-xs font-semibold text-slate-500 mb-0.5">DROPOFF</div>
<div className="font-semibold text-sm">{job.dropoff_address}</div>
</div>
{job.second_dropoff_address && (
<div>
<div className="text-xs font-semibold text-slate-500 mb-0.5">2ND DROPOFF</div>
<div className="font-semibold text-sm">{job.second_dropoff_address}</div>
</div>
)}
</div>
</div>
</div>

<div className="card">
<h2 className="font-bold text-sm text-slate-500 mb-3">Item</h2>
<div className="text-base font-bold mb-1">{job.item_type} <span className="text-slate-400 font-normal text-sm">({SIZE_LABEL[job.item_size] ?? job.item_size})</span></div>
<p className="text-sm text-slate-600">{job.item_description}</p>
{job.helper_note && <p className="text-xs text-slate-500 mt-2">📝 {job.helper_note}</p>}
{itemPhotos.length > 0 && (
<div className="flex gap-2 mt-3 overflow-x-auto">
{itemPhotos.map((url: string, idx: number) => (
<img key={idx} src={url} alt="Item" className="h-40 w-52 object-cover rounded-xl flex-shrink-0 border border-slate-200" loading="lazy" />
))}
</div>
)}
</div>

<div className="card">
<h2 className="font-bold text-sm text-slate-500 mb-3">Customer</h2>
<div className="flex items-center justify-between gap-2">
<div className="font-bold">{job.buyer?.full_name}</div>
<div className="flex gap-2">
{(job.status === 'accepted' || job.status === 'picked_up') && (
<button onClick={callCustomer} className="bg-green-100 text-green-700 font-semibold px-4 py-2 rounded-xl text-sm hover:bg-green-200 transition-colors">📞 Call</button>
)}
<button onClick={() => setShowMessages(true)} className="bg-blue-100 text-blue-700 font-semibold px-4 py-2 rounded-xl text-sm hover:bg-blue-200 transition-colors">💬 Message</button>
</div>
</div>
<p className="text-xs text-slate-400 mt-2">Numbers are only shared between you and the customer while the job is active.</p>
</div>

<div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-sm">
<div className="font-bold text-orange-800 mb-1">Payment on delivery</div>
<div className="text-orange-700">Collect <strong>${money(job.driver_fee)}</strong> by <strong>cash or PayID</strong> from the customer when you hand over the item.</div>
</div>

{/* Driver re-rate: item bigger than described */}
{canAdjust && biggerSizes.length > 0 && (
<div className="card border-amber-200">
{!showAdjust ? (
<button onClick={() => setShowAdjust(true)}
className="w-full text-sm font-semibold text-amber-700 py-1 text-left">
⚖️ Item bigger than described? Adjust the size →
</button>
) : (
<div>
<div className="font-bold text-sm text-slate-700 mb-1">Re-rate this item</div>
<p className="text-xs text-slate-500 mb-3">Only use this when the real item is clearly bigger/heavier than what was posted. The customer is notified and the change is logged.</p>
<div className="flex gap-2">
{biggerSizes.map(s => (
<button key={s} onClick={() => adjustSize(s)} disabled={adjusting}
className="flex-1 border-2 border-slate-200 hover:border-amber-400 rounded-xl py-2.5 text-sm font-bold text-slate-700 transition-all disabled:opacity-50">
{SIZE_LABEL[s]}
</button>
))}
</div>
{adjustError && <p className="text-xs text-red-500 font-semibold mt-2">{adjustError}</p>}
<button onClick={() => { setShowAdjust(false); setAdjustError('') }} className="text-xs text-slate-400 mt-2">Cancel</button>
</div>
)}
</div>
)}

{/* Proof photo (REQUIRED to advance the job) */}
{nextAction && proofNeeded && !changesPending && (
<div className="card border-blue-200">
<div className="font-bold text-sm text-slate-700 mb-1">{proofNeeded.title} <span className="text-red-500">*</span></div>
<p className="text-xs text-slate-500 mb-3">{proofNeeded.hint}</p>
{!proofPreview ? (
<label className="border-2 border-dashed border-blue-200 hover:border-blue-400 hover:bg-blue-50 rounded-xl p-6 flex flex-col items-center cursor-pointer transition-all bg-slate-50">
<span className="text-3xl mb-1">📷</span>
<span className="text-sm font-semibold text-blue-600">Take photo</span>
<input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleProofChange} />
</label>
) : (
<div className="relative rounded-xl overflow-hidden h-40 bg-slate-100">
<img src={proofPreview} alt="Proof" className="w-full h-full object-cover" />
<button onClick={() => { setProofFile(null); setProofPreview(null) }}
className="absolute top-2 right-2 w-7 h-7 bg-black/50 text-white rounded-full flex items-center justify-center text-sm">×</button>
</div>
)}

{/* Delivery note -- shown ONLY on the final (delivery) step, right
under the delivery photo. Lets the driver add context like
"left at the front of the house" or "no one home — left in the
driveway". Saved with the job and shown to the customer. */}
{job.status === 'picked_up' && (
<div className="mt-3">
<div className="font-bold text-sm text-slate-700 mb-1">🗒️ Delivery note <span className="font-normal text-slate-400">(optional, recommended)</span></div>
<textarea
className="input resize-none w-full"
rows={2}
placeholder='e.g. "Handed to the customer" or "No one home — left in the driveway by the garage"'
value={deliveryNote}
onChange={e => setDeliveryNote(e.target.value)}
/>
<p className="text-xs text-slate-400 mt-1">This note is saved with your delivery photo and shown to the customer.</p>
</div>
)}
</div>
)}

{nextAction && (
<button onClick={advanceStatus} disabled={updating || changesPending || locationBlocked || (proofNeeded && !proofFile)}
className="btn-primary w-full justify-center py-3.5 text-base disabled:opacity-50">
{updating ? 'Updating...' : changesPending ? '⚠️ Respond to the job changes first' : locationBlocked ? '⚠️ Enable location to continue' : (proofNeeded && !proofFile) ? '📸 Take the photo first' : nextAction.label}
</button>
)}

<button onClick={() => router.push('/driver/dashboard')} className="btn-secondary w-full justify-center">
Back to dashboard
</button>

{canCancel && !changesPending && (
<button onClick={cancelJob} disabled={updating}
className="w-full text-sm text-red-500 font-semibold py-2 hover:text-red-600 transition-colors">
Cancel job
</button>
)}
</div>
{showMessages && <MessageThread jobId={jobId} onClose={() => setShowMessages(false)} />}
</div>
)
}
