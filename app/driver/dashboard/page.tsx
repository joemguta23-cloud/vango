'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { startDriverPresence, stopDriverPresence, openDriverLocationSettings } from '@/lib/nativePresence'
import type { Job, Driver } from '@/types'

const ITEM_ICONS: Record<string, string> = {
'Fridge':'Fridge','Washer/Dryer':'Washer','Mattress':'Mattress','Couch':'Couch',
'TV/Desk':'TV','Wardrobe':'Wardrobe','Dining Table':'Table','Gym Equipment':'Gym',
'Tools':'Tools','Garden':'Garden','Materials':'Materials','Other':'Item',
}

// Coarse column list for PENDING (not-yet-accepted) jobs -- used as a FALLBACK
// only, until migration_007's `available_jobs` view exists. Deliberately NO exact
// GPS coordinates (pickup_lat/lng, dropoff_lat/lng), NO buyer_id, and none of the
// second-stop address/coord fields. Precise coordinates + full identity are only
// exposed to the ONE driver who accepts (the job-detail page refetches by id, and
// RLS returns full data to the assigned driver).
const PENDING_JOB_COLUMNS =
'id, status, driver_id, item_type, item_size, items, photo_url, item_description, helper_note, driver_fee, scheduled_for, created_at, pickup_address, dropoff_address'

// Cap how many open jobs a single client can enumerate at once (anti-scraping).
const PENDING_JOB_LIMIT = 50

// Collect every item photo on a job (multi-item jobs carry a photo per item),
// falling back to the legacy single photo_url. Drivers need to SEE what they're
// picking up before they accept, so we show these thumbnails on the card.
function jobPhotos(job: any): string[] {
const fromItems = Array.isArray(job.items) ? job.items.map((it: any) => it?.photo_url) : []
const all = [...fromItems, job.photo_url].filter(Boolean)
return Array.from(new Set(all))
}

// Suburb-level locality for the OPEN-jobs feed. The `available_jobs` view already
// returns suburb-only in pickup_address/dropoff_address; on the fallback path the
// raw address is still present, so this trims it to the suburb as a second guard.
// Either way the open feed never shows the exact street of an un-accepted job.
function locality(address?: string | null): string {
if (!address) return 'Melbourne area'
const parts = address.split(',').map(s => s.trim()).filter(Boolean)
// "12 Smith St, Yarraville VIC 3013" -> the segment after the street is the suburb.
const seg = parts.length > 1 ? parts[1] : parts[0]
const suburb = seg.replace(/\b(VIC|NSW|QLD|SA|WA|TAS|NT|ACT)\b/gi, '').replace(/\d{4}/g, '').trim()
return suburb || seg
}

// How often to re-fetch jobs as a fallback in case the realtime websocket
// silently drops (mobile backgrounding, network switch, etc). Realtime is
// still the primary/fast path -- this just guarantees drivers never go more
// than POLL_MS without seeing new jobs, even if the socket died silently.
const POLL_MS = 12000

// Vanute policy: a driver cannot go Online without sharing live location.
// On the native app that means the background-geolocation watcher must
// actually start (see lib/nativePresence.ts). On the plain website there's
// no true background tracking available from a browser tab, so we still
// require at least one successful foreground permission grant before
// allowing the toggle -- a driver can never go Online, on any platform,
// without actively sharing their location.
function requestForegroundLocationOnce(): Promise<boolean> {
return new Promise((resolve) => {
if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { resolve(false); return }
navigator.geolocation.getCurrentPosition(
() => resolve(true),
() => resolve(false),
{ enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
)
})
}

// No await in toggleOnline may hang forever -- if any step stalls the button
// would sit on "Checking location..." with no way out (the exact bug this
// guards against). Supabase's JS client in particular has NO default request
// timeout, so a stalled network call would otherwise never settle. Takes a
// PromiseLike so Supabase's thenable query builders can be passed straight in.
function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
return Promise.race([
promise,
new Promise<T>((_, reject) =>
setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms)
),
])
}

const LOCATION_DENIED_MESSAGE =
"Vanute needs your location, including while the app is in the background, so customers can see where you are during a delivery. Please allow location access (in your phone's Settings app if you already declined it) and try going online again."

export default function DriverDashboardPage() {
const router = useRouter()
const supabase = createSupabaseBrowserClient()
const [driver, setDriver] = useState<Driver | null>(null)
const [jobs, setJobs] = useState<Job[]>([])
const [myJobs, setMyJobs] = useState<Job[]>([])
const [loading, setLoading] = useState(true)
const [toggling, setToggling] = useState(false)
// Human-readable label for the step toggleOnline is currently on, so the
// button itself shows exactly where it is (and where it stalled, if it does).
const [step, setStep] = useState<string>('')
const [refreshing, setRefreshing] = useState(false)
// `native` tracks whether the denial happened inside the native app (in
// which case we can offer a direct jump to the OS settings screen) or on
// the plain website (where there's no such deep link to offer).
const [locationError, setLocationError] = useState<{ message: string; native: boolean } | null>(null)

useEffect(() => {
loadData()
// Warm the Capacitor core chunk up front. startDriverPresence() has to
// `await import('@capacitor/core')` on the driver's first tap of the
// Online toggle, and fetching that webpack chunk over the network inside
// the Capacitor WebView is a real slice of the go-online latency. This is
// fire-and-forget on purpose: it never blocks render or loadData().
void import('@capacitor/core').catch(() => {})
const channel = supabase
.channel('pending-jobs')
.on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => loadData())
.subscribe()
const poll = setInterval(() => loadData(), POLL_MS)
return () => { supabase.removeChannel(channel); clearInterval(poll) }
}, [])

const loadData = async () => {
const { data: { user } } = await supabase.auth.getUser()
if (!user) { router.push('/login'); return }
// Privacy: only the profile fields the dashboard actually shows (never phone).
const { data: d } = await supabase.from('drivers').select('*, profile:profiles(id, full_name, role)').eq('user_id', user.id).single()
if (!d) { router.push('/driver/onboard'); return }
setDriver(d)
// Open jobs: read the coarse, suburb-only `available_jobs` view (no exact GPS,
// no buyer identity, capped at 50 in the view). Until migration_007 creates
// that view, fall back to a coarse direct query so the feed works either way.
let pending: any[] | null = null
const feed = await supabase.from('available_jobs').select('*')
if (!feed.error && feed.data) {
pending = feed.data
} else {
const fb = await supabase.from('jobs')
.select(PENDING_JOB_COLUMNS)
.eq('status', 'pending')
.order('created_at', { ascending: false })
.limit(PENDING_JOB_LIMIT)
pending = fb.data ?? null
}
setJobs((pending ?? []) as unknown as Job[])
const { data: mine } = await supabase.from('jobs').select('*').eq('driver_id', d.id).in('status', ['accepted', 'picked_up']).order('created_at', { ascending: false })
setMyJobs(mine ?? [])
setLoading(false)
}

const refreshNow = async () => {
setRefreshing(true)
await loadData()
setRefreshing(false)
}

// A driver can now go Online before the OS permission prompt has been
// answered -- lib/nativePresence.ts settles as soon as the location
// watcher is REGISTERED, which is what makes the toggle fast. If the
// driver then denies location, this fires: put them straight back
// Offline so nobody is ever shown as online without live location.
// Deliberately defensive -- it runs from inside a native plugin
// callback, so nothing here may throw or leave an unhandled rejection.
const handleLateLocationDenial = (driverId: string) => {
  try {
    setDriver(d => (d && d.id === driverId ? { ...d, is_online: false } : d))
    setLocationError({ message: LOCATION_DENIED_MESSAGE, native: true })
    supabase.from('drivers').update({ is_online: false }).eq('id', driverId).then(
      () => {},
      () => {}
    )
  } catch {
    /* never let a late-denial callback break anything */
  }
}

const toggleOnline = async () => {
if (!driver) return
setToggling(true)
setLocationError(null)
// Everything from here on is wrapped in try/catch/finally so `toggling`
// is GUARANTEED to reset to false no matter what happens -- including an
// unexpected exception from anywhere in this chain. Without this, a
// thrown/rejected call upstream (e.g. a native plugin call that isn't
// actually linked into the app binary) would leave the "Checking
// location..." button stuck forever, since setToggling(false) would
// never be reached. lib/nativePresence.ts's startDriverPresence is
// designed to never reject, but this is deliberate belt-and-suspenders:
// never trust that layer alone is enough.
try {
const goingOnline = !driver.is_online

if (goingOnline) {
// Confirm live location sharing actually works BEFORE writing
// is_online: true anywhere -- a driver must never appear online to
// customers without their location actually being shared. See
// lib/nativePresence.ts for what "ok" means on native vs. web.
setStep('Checking location…')
const presence = await withTimeout(startDriverPresence(driver.id, () => handleLateLocationDenial(driver.id)), 20000, 'location check')
let locationOk = presence.ok
if (presence.ok && !presence.native) {
setStep('Checking location permission…')
locationOk = await withTimeout(requestForegroundLocationOnce(), 15000, 'location permission')
}
if (!locationOk) {
setLocationError({ message: LOCATION_DENIED_MESSAGE, native: presence.native })
return
}
} else {
setStep('Going offline…')
await withTimeout(stopDriverPresence(), 10000, 'stopping location')
}

setStep('Saving status…')

const { error } = await withTimeout(

supabase.from('drivers').update({ is_online: goingOnline }).eq('id', driver.id),

15000,

'saving status'

)
if (error) {
setLocationError({ message: 'Something went wrong updating your status. Please try again.', native: false })
return
}
setDriver(d => d ? { ...d, is_online: goingOnline } : d)
loadData()
} catch (err: any) {
// Surface the ACTUAL failure (including "Timed out: <step>" from
// withTimeout above) so a stuck toggle can be reported precisely
// instead of hiding behind a generic message.
setLocationError({
message: `Could not go online: ${err?.message || String(err) || 'unknown error'}. Please try again — if this keeps happening, screenshot this message.`,
native: false,
})
} finally {
setToggling(false)
setStep('')
}
}

const acceptJob = async (job: Job) => {
if (!driver) return
const itemCount = Array.isArray((job as any).items) ? (job as any).items.length : 1
if (itemCount > 1) {
const itemList = (job as any).items.map((it: any) => it.item_type).join(', ')
const confirmed = window.confirm(
`This job has ${itemCount} items (${itemList}) that all need to fit in your vehicle at the same time. Please check the item descriptions/photos and confirm everything will fit before accepting.\n\nContinue and accept this job?`
)
if (!confirmed) return
}
const { data, error } = await supabase.from('jobs').update({ driver_id: driver.id, status: 'accepted' }).eq('id', job.id).eq('status', 'pending').select()
if (error || !data || data.length === 0) { alert('Sorry, that job was just taken.'); loadData(); return }
await supabase.from('job_status_events').insert({ job_id: job.id, status: 'accepted', note: 'Driver accepted the job' })
router.push(`/driver/job/${job.id}`)
}

if (loading) return (
<div className="min-h-screen flex items-center justify-center">
<div className="text-center"><div className="text-5xl mb-4">Loading...</div></div>
</div>
)

return (
<div>
<div className="bg-gradient-to-br from-slate-900 to-slate-800 pt-16">
<div className="max-w-2xl mx-auto px-4 py-8">
<p className="text-slate-400 text-sm">Good {new Date().getHours() < 12 ? 'morning' : 'afternoon'},</p>
<h1 className="text-2xl font-black text-white mb-4">{driver?.profile?.full_name}</h1>
<div className="flex items-center gap-3 mb-2 flex-wrap">
<button onClick={toggleOnline} disabled={toggling}
className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border font-semibold text-sm transition-all ${
driver?.is_online
? 'bg-green-500/15 border-green-500/30 text-green-400'
: 'bg-white/10 border-white/15 text-slate-300'
}`}>
<span className={`w-2 h-2 rounded-full ${driver?.is_online ? 'bg-green-400' : 'bg-slate-500'}`} />
{toggling ? (step || 'Checking location…') : driver?.is_online ? 'Online - accepting jobs' : 'Offline - tap to go online'}
</button>
<a
href="/driver/notifications"
className="flex items-center gap-2 px-4 py-2.5 rounded-xl border font-semibold text-sm bg-white/10 border-white/15 text-slate-300 hover:bg-white/15 transition-colors"
>
🔔 Job alerts
</a>
<span className="text-xs bg-white/10 border border-white/15 text-slate-300 px-3 py-1.5 rounded-lg font-semibold">
{driver?.vehicle_make} {driver?.vehicle_model} - {driver?.vehicle_plate}
</span>
</div>
{locationError && (
<div className="mb-4 bg-amber-500/15 border border-amber-500/30 text-amber-300 rounded-xl px-3 py-2.5">
<p className="text-xs font-semibold">⚠️ {locationError.message}</p>
{locationError.native && (
<button onClick={() => openDriverLocationSettings()}
className="mt-2 text-xs font-bold bg-amber-400/20 hover:bg-amber-400/30 text-amber-200 px-3 py-1.5 rounded-lg transition-colors">
Open location settings →
</button>
)}
</div>
)}
<div className="grid grid-cols-3 gap-3 mt-4">
{[
{ num: driver?.rating, label: 'Rating' },
{ num: driver?.total_jobs ?? 0, label: 'Total jobs' },
{ num: myJobs.length, label: 'Active now' },
].map(s => (
<div key={s.label} className="bg-white/8 border border-white/10 rounded-xl py-3 text-center">
<div className="text-xl font-black text-white">{s.num}</div>
<div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
</div>
))}
</div>
</div>
</div>

<Nav />

<div className="max-w-2xl mx-auto px-4 py-6">
{myJobs.length > 0 && (
<div className="mb-8">
<h2 className="font-bold text-base mb-3">Active jobs</h2>
{myJobs.map(job => {
const photos = jobPhotos(job)
return (
<div key={job.id} className="card mb-3 border-orange-200 bg-orange-50 cursor-pointer hover:shadow-md transition-shadow"
onClick={() => router.push(`/driver/job/${job.id}`)}>
<div className="flex items-center gap-3">
{photos[0]
? <img src={photos[0]} alt="Item" className="w-14 h-14 rounded-lg object-cover flex-shrink-0 border border-orange-200" />
: <div className="w-14 h-14 rounded-lg bg-orange-100 flex items-center justify-center text-xl flex-shrink-0">📦</div>}
<div className="flex items-center justify-between flex-1 min-w-0">
<div className="min-w-0">
<div className="font-bold">{job.item_type}</div>
<div className="text-xs text-slate-500 truncate">{job.pickup_address} to {job.dropoff_address}</div>
</div>
<span className="badge-orange flex-shrink-0 ml-2">{job.status === 'accepted' ? 'Heading to pickup' : 'Item collected'}</span>
</div>
</div>
</div>
)
})}
</div>
)}

<div className="flex items-center justify-between mb-3">
<h2 className="font-bold text-base">Available jobs</h2>
<div className="flex items-center gap-3">
<span className="text-sm text-slate-500">{jobs.length} available</span>
<button onClick={refreshNow} disabled={refreshing}
className="text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
{refreshing ? 'Refreshing...' : '🔄 Refresh'}
</button>
</div>
</div>

{!driver?.is_online && (
<div className="card text-center py-10 text-slate-400">
<div className="font-bold text-slate-600">You are offline</div>
<div className="text-sm mt-1">Go online above to see available jobs</div>
</div>
)}

{driver?.is_online && jobs.length === 0 && (
<div className="card text-center py-10 text-slate-400">
<div className="font-bold text-slate-600">No jobs yet</div>
<div className="text-sm mt-1">New jobs will appear here in real time</div>
</div>
)}

{driver?.is_online && jobs.map(job => {
const itemCount = Array.isArray((job as any).items) ? (job as any).items.length : 1
const photos = jobPhotos(job)
return (
<div key={job.id} className="card mb-3 hover:border-orange-300 hover:shadow-md transition-all cursor-pointer">
<div className="flex items-start justify-between mb-3">
<div>
<div className="font-bold flex items-center gap-2">
{job.item_type}
{itemCount > 1 && (
<span className="badge-orange">📦 {itemCount} items</span>
)}
</div>
<div className="text-xs text-slate-500 capitalize">{job.item_size}</div>
</div>
<div className="text-right">
<div className="text-xl font-black">${job.driver_fee}</div>
<div className="text-xs text-slate-400">cash / PayID</div>
</div>
</div>

{/* Item photo(s) -- so the driver can see exactly what they're picking up */}
{photos.length > 0 ? (
<div className="flex gap-2 mb-3 overflow-x-auto">
{photos.map((url, idx) => (
<img key={idx} src={url} alt="Item to deliver" className="h-32 w-40 object-cover rounded-lg flex-shrink-0 border border-slate-200" loading="lazy" />
))}
</div>
) : (
<div className="mb-3 text-xs text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-lg px-3 py-2">
📷 No photo provided — check the description before accepting.
</div>
)}

{itemCount > 1 && (
<div className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
⚠️ Multiple items -- check they'll all fit in your vehicle before accepting.
</div>
)}
{job.item_description && (
<div className="mb-3 text-sm text-slate-600">{job.item_description}</div>
)}
{job.helper_note && (
<div className="mb-3 text-xs text-slate-500">📝 {job.helper_note}</div>
)}
{/* Suburb-level only until accepted (exact address revealed on accept). */}
<div className="flex items-center gap-2 text-sm text-slate-600 mb-3">
<span>{locality(job.pickup_address)}</span>
<span className="text-slate-300">to</span>
<span>{locality(job.dropoff_address)}</span>
</div>
<div className="flex items-center justify-between">
<span className="text-xs text-slate-400">{job.scheduled_for ? new Date(job.scheduled_for).toLocaleDateString('en-AU') : 'ASAP'}</span>
<button onClick={() => acceptJob(job)} className="btn-primary py-2 px-5 text-sm">
Accept Job
</button>
</div>
</div>
)
})}
</div>
</div>
)
}
