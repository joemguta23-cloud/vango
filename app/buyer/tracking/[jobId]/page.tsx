'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Nav from '@/components/Nav'
import MessageThread from '@/components/MessageThread'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { FEATURE_FLAGS, CANCELLATION_FEE_CENTS } from '@/lib/featureFlags'
import { haversineKm, distanceFeeForKm } from '@/lib/pricing'

const STATUS_LABELS = {
  unpaid: { label: 'Awaiting payment', icon: '💳', msg: 'Your job is saved but NOT visible to drivers yet. Pay the service fee below to make it live.' },
  pending: { label: 'Finding driver', icon: '🔍', msg: "We're matching you with the nearest available driver..." },
  accepted: { label: 'Driver on the way', icon: '🚐', msg: 'Your driver has accepted and is heading to the seller.' },
  picked_up: { label: 'Item collected', icon: '📦', msg: 'Your item has been picked up and is on its way to you.' },
  delivered: { label: 'Delivered!', icon: '✅', msg: '🎉 Your item has been delivered. Please pay the driver the agreed amount by cash or PayID.' },
  cancelled: { label: 'Cancelled', icon: '❌', msg: 'This job was cancelled.' },
  expired: { label: 'Removed', icon: '⏳', msg: 'This job was removed after 24 hours. You can repost it from My Jobs.' },
}
const STATUS_ORDER = ['pending', 'accepted', 'picked_up', 'delivered']

// Statuses during which the driver's live location should be shown/shared.
// Once a job leaves this set (delivered/cancelled), we stop showing a driver
// pin even if a stale lat/lng is still in the row, for privacy.
const LIVE_TRACKING_STATUSES = ['accepted', 'picked_up']

// Statuses from which a buyer can still cancel. Free while no driver has
// accepted (unpaid / pending); once a driver has accepted, the fee equals
// this trip's distance charge (km-based driver reimbursement, floored at $2).
// Cancelling is no longer possible once the item has been picked up.
const CANCELLABLE_STATUSES = ['unpaid', 'pending', 'accepted']

// Statuses during which the buyer can still EDIT the job (wrong suburb,
// change of location, different item...). While no driver has accepted the
// edit applies instantly with a live reprice; once a driver has accepted,
// the edit becomes a change REQUEST the driver must approve (Uber-style,
// see /buyer/edit/[jobId]). No edits once the item is picked up.
const EDITABLE_STATUSES = ['unpaid', 'pending', 'accepted']

// A driver GPS ping older than this looks "live" but almost certainly isn't
// -- the realtime socket or poll has silently stalled (backgrounded tab,
// locked phone, dead connection) rather than the driver genuinely holding
// still this long. Used to swap the "Live" badge for "Reconnecting…".
const STALE_LOCATION_MS = 45000

// Clean money display: never show floating-point junk like 21.990000000000002.
const money = (n) => {
  const v = Math.round(Number(n) * 100) / 100
  return Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2)
}

function timeAgo(iso) {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

function MapEmbed({ pickupLat, pickupLng, dropoffLat, dropoffLng, driverLat, driverLng, driverUpdatedAt }) {
  const hasDriver = driverLat != null && driverLng != null
  // If the driver's last GPS ping is stale, the connection has likely
  // dropped (backgrounded tab, dead socket) rather than the driver genuinely
  // not moving -- show "Reconnecting…" instead of a falsely-calm "Live" so
  // the buyer isn't misled into thinking the pin is current.
  const isStale = hasDriver && driverUpdatedAt && (Date.now() - new Date(driverUpdatedAt).getTime()) > STALE_LOCATION_MS
  const lats = [pickupLat, dropoffLat, ...(hasDriver ? [driverLat] : [])]
  const lngs = [pickupLng, dropoffLng, ...(hasDriver ? [driverLng] : [])]
  const minLng = Math.min(...lngs) - 0.05
  const maxLng = Math.max(...lngs) + 0.05
  const minLat = Math.min(...lats) - 0.05
  const maxLat = Math.max(...lats) + 0.05
  const markerParam = hasDriver ? `&marker=${driverLat},${driverLng}` : ''
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${minLng},${minLat},${maxLng},${maxLat}&layer=mapnik${markerParam}`
  return (
    <div className="card mb-4 p-0 overflow-hidden">
      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <span className="text-base">🗺️</span>
        <h2 className="font-bold text-sm text-slate-600">Route map</h2>
        {hasDriver && (
          <span className={`ml-auto flex items-center gap-1 text-xs font-semibold ${isStale ? 'text-amber-600' : 'text-green-600'}`}>
            <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${isStale ? 'bg-amber-500' : 'bg-green-500'}`} />
            {isStale ? 'Reconnecting…' : 'Live'}
          </span>
        )}
      </div>
      <iframe src={src} className="w-full" style={{ height: 220, border: 0 }} loading="lazy" title="Delivery route map" />
      <div className="px-4 py-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 border-t border-slate-100">
        <span>🟢 Pickup: {pickupLat.toFixed(4)}, {pickupLng.toFixed(4)}</span>
        <span>🔴 Dropoff: {dropoffLat.toFixed(4)}, {dropoffLng.toFixed(4)}</span>
        {hasDriver && (
          <span>🚐 Driver: {driverLat.toFixed(4)}, {driverLng.toFixed(4)}{driverUpdatedAt ? ` · updated ${timeAgo(driverUpdatedAt)}` : ''}</span>
        )}
      </div>
    </div>
  )
}

export default function TrackingPage() {
  const { jobId } = useParams()
  const supabase = createSupabaseBrowserClient()
  const [job, setJob] = useState(null)
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [paying, setPaying] = useState(false)
  const [showMessages, setShowMessages] = useState(false)

  // Fetch the job as separate, resilient queries instead of one fragile
  // nested embed. The base job row is something the buyer can always read,
  // so the page never shows a false "Job not found" just because the driver
  // or profile lookup hiccuped. Driver + their profile are best-effort on top.
  // Privacy: we only ever read the driver's NAME — never their phone number.
  const fetchJob = async () => {
    const { data: jobRow, error } = await supabase.from('jobs').select('*').eq('id', jobId).maybeSingle()
    if (error) {
      console.error('[tracking] job fetch error', error)
      setLoading(false)
      return // keep whatever we had; do NOT flip to "not found" on a transient error
    }
    if (!jobRow) {
      setNotFound(true)
      setLoading(false)
      return
    }
    let driver = null
    if (jobRow.driver_id) {
      const { data: d } = await supabase.from('drivers').select('id, user_id, vehicle_plate, rating, current_lat, current_lng, location_updated_at').eq('id', jobRow.driver_id).maybeSingle()
      if (d) {
        const { data: prof } = await supabase.from('profiles').select('id, full_name').eq('id', d.user_id).maybeSingle()
        driver = { ...d, profile: prof ?? null }
      }
    }
    setNotFound(false)
    setJob({ ...jobRow, driver })
    setLoading(false)
  }
  const fetchEvents = async () => {
    const { data } = await supabase.from('job_status_events').select('*').eq('job_id', jobId).order('created_at', { ascending: true })
    setEvents(data ?? [])
  }

  // Realtime: the job row + its status events. This auto-updates the screen
  // the instant the driver accepts / picks up / delivers — no manual refresh.
  useEffect(() => {
    fetchJob(); fetchEvents()
    const channel = supabase.channel(`job-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: `id=eq.${jobId}` }, fetchJob)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'job_status_events', filter: `job_id=eq.${jobId}` }, fetchEvents)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [jobId])

  // Realtime: the assigned driver's live GPS. Once a driver is assigned and
  // the job is out for delivery, push their moving pin to the map instantly
  // (like Uber) rather than waiting for the slow poll below.
  useEffect(() => {
    const driverId = job?.driver_id
    if (!driverId || !LIVE_TRACKING_STATUSES.includes(job?.status)) return
    const channel = supabase.channel(`driver-loc-${driverId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'drivers', filter: `id=eq.${driverId}` }, fetchJob)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [job?.driver_id, job?.status])

  // Poll fallback for driver location while out for delivery, in case a
  // websocket drops silently.
  useEffect(() => {
    if (!job || !LIVE_TRACKING_STATUSES.includes(job.status)) return
    const interval = setInterval(fetchJob, 10000)
    return () => clearInterval(interval)
  }, [job?.status, jobId])

  // Instant refresh when the tab/app regains focus after being backgrounded.
  // Browsers (and iOS/Android when the app is backgrounded) throttle or
  // fully pause timers and websockets in the background, so a buyer who
  // leaves this page open in another tab -- or just locks their phone for a
  // few minutes -- can come back to a driver pin that looks fine but hasn't
  // actually moved in a while. Firing an immediate fetch the moment the page
  // is visible again means they see the true current location without
  // needing to know to hit refresh themselves.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') { fetchJob(); fetchEvents() }
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    window.addEventListener('pageshow', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('pageshow', onVisible)
    }
  }, [jobId])

  // Call the driver. Numbers stay hidden from the page itself -- the server
  // route only hands out the other party's number to a job participant while
  // the job is actually active (accepted / picked_up).
  const callDriver = async () => {
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

  // PAYMENT HARD-STOP: an 'unpaid' job is invisible to drivers until the
  // service fee is paid. This creates a fresh Stripe Checkout session for it.
  const payServiceFee = async () => {
    setPaying(true)
    try {
      const res = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })
      const data = await res.json()
      if (res.ok && data.url) { window.location.href = data.url; return }
      alert(data.error || 'Could not start the payment — please try again.')
    } catch {
      alert('Could not start the payment — check your connection and try again.')
    }
    setPaying(false)
  }

  // After-acceptance cancellation fee preview: this trip's distance charge
  // (km-based driver reimbursement), floored at $2 — must mirror
  // app/api/jobs/cancel/route.ts.
  const cancelFee = (() => {
    if (!job) return CANCELLATION_FEE_CENTS / 100
    const coords = [job.pickup_lat, job.pickup_lng, job.dropoff_lat, job.dropoff_lng]
    if (!coords.every(v => Number.isFinite(Number(v)))) return CANCELLATION_FEE_CENTS / 100
    const km = haversineKm(Number(job.pickup_lat), Number(job.pickup_lng), Number(job.dropoff_lat), Number(job.dropoff_lng))
    return Math.max(CANCELLATION_FEE_CENTS / 100, distanceFeeForKm(km))
  })()

  const handleCancel = async () => {
    if (!job) return
    const afterAccept = job.status === 'accepted'
    const warning = afterAccept
      ? `Cancel this job? Since a driver has already accepted, a $${money(cancelFee)} cancellation fee (this trip's distance charge, reimbursing the driver for their time) will be added to your next job's checkout.`
      : 'Cancel this job? This is free since no driver has accepted yet.'
    if (!confirm(warning)) return
    setCancelling(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/jobs/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ jobId }),
      })
      if (res.ok) {
        await fetchJob()
        await fetchEvents()
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data.error || 'Could not cancel this job.')
      }
    } finally {
      setCancelling(false)
    }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="text-5xl mb-4 animate-bounce">🚐</div></div>
  if (notFound || !job) return (
    <div>
      <Nav />
      <div className="max-w-lg mx-auto px-4 pt-24 pb-12 text-center">
        <div className="text-5xl mb-3">🤔</div>
        <p className="font-bold text-slate-700 mb-1">We couldn't find that job</p>
        <p className="text-sm text-slate-500 mb-5">It may have been removed, or you're signed in as a different account.</p>
        <a href="/buyer/dashboard" className="btn-primary inline-block py-2.5 px-5">Go to my jobs</a>
      </div>
    </div>
  )

  const statusInfo = STATUS_LABELS[job.status] ?? STATUS_LABELS.pending
  const statusIndex = STATUS_ORDER.indexOf(job.status)
  const showDriverLocation = LIVE_TRACKING_STATUSES.includes(job.status) && job.driver?.current_lat != null && job.driver?.current_lng != null
  const canCancel = FEATURE_FLAGS.CANCELLATION_ENABLED && CANCELLABLE_STATUSES.includes(job.status)
  const canEdit = EDITABLE_STATUSES.includes(job.status)
  const changesAwaitingDriver = !!job.pending_changes && job.status === 'accepted'
  const alreadyRated = job.rating != null
  const hasProofPhotos = !!(job.pickup_photo_url || job.dropoff_photo_url)
  const priceAdjusted = job.original_driver_fee != null && Number(job.original_driver_fee) !== Number(job.driver_fee)

  return (
    <div>
      <Nav />
      <div className="max-w-lg mx-auto px-4 pt-24 pb-12">
        <div className="flex items-center justify-between mb-4">
          <a href="/buyer/dashboard" className="text-sm font-semibold text-slate-500 hover:text-slate-700">← My jobs</a>
          <a href="/buyer/post" className="text-sm font-semibold text-orange-500 hover:text-orange-600">+ Post another</a>
        </div>

        <div className={`rounded-2xl p-6 text-center mb-6 ${job.status === 'delivered' ? 'bg-green-50 border border-green-200' : job.status === 'cancelled' || job.status === 'expired' ? 'bg-red-50 border border-red-200' : job.status === 'unpaid' ? 'bg-purple-50 border border-purple-200' : 'bg-orange-50 border border-orange-200'}`}>
          <div className="text-5xl mb-3">{statusInfo.icon}</div>
          <h1 className="text-xl font-black text-slate-800 mb-1">{statusInfo.label}</h1>
          <p className="text-slate-600 text-sm">{statusInfo.msg}</p>
          {job.status === 'pending' && (
            <div className="flex justify-center gap-1.5 mt-4">
              {[0,1,2].map(i => <div key={i} className="w-2 h-2 rounded-full bg-orange-500 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
            </div>
          )}
        </div>

        {/* Changes sent to the driver — awaiting their approval (Uber-style) */}
        {changesAwaitingDriver && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 mb-4">
            <div className="font-bold mb-1">⏳ Changes sent to your driver — waiting for their OK</div>
            {Array.isArray(job.pending_changes?.summary) && job.pending_changes.summary.length > 0 && (
              <ul className="list-disc ml-4 space-y-0.5 text-xs">
                {job.pending_changes.summary.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            )}
            <p className="text-xs mt-2">Your driver has been notified urgently and keeps getting reminders until they respond. If the new details don't suit them they can opt out penalty-free — your job then automatically goes back out live to other drivers with your new details, at no fee to you.</p>
          </div>
        )}

        {/* PAYMENT HARD-STOP: pay button for unpaid jobs */}
        {job.status === 'unpaid' && (
          <button onClick={payServiceFee} disabled={paying}
            className="block w-full text-center bg-orange-500 text-white font-bold py-3.5 rounded-xl mb-6 hover:bg-orange-600 transition-colors disabled:opacity-60">
            {paying ? 'Opening secure payment…' : `💳 Pay service fee ($${money(job.service_fee)}) — make my job live`}
          </button>
        )}

        {job.status === 'delivered' && !alreadyRated && (
          <a href={`/buyer/rate/${jobId}`}
            className="block w-full text-center bg-orange-500 text-white font-bold py-3.5 rounded-xl mb-6 hover:bg-orange-600 transition-colors">
            ⭐ Rate your delivery
          </a>
        )}
        {job.status === 'delivered' && alreadyRated && (
          <div className="text-center text-sm text-slate-500 mb-6">Thanks for rating your delivery 🙏</div>
        )}

        {priceAdjusted && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 mb-4">
            ⚖️ <strong>Price adjusted at pickup:</strong> the driver re-rated the item after seeing it in person.
            Cash fee updated from <span className="line-through">${money(job.original_driver_fee)}</span> to <strong>${money(job.driver_fee)}</strong>. Details in the timeline below.
          </div>
        )}

        <div className="card mb-4">
          <h2 className="font-bold text-sm text-slate-500 mb-4">Delivery progress</h2>
          <div className="flex items-center">
            {STATUS_ORDER.filter(s => s !== 'cancelled').map((s, i) => (
              <div key={s} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center">
                  <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all ${i < statusIndex ? 'bg-green-500 border-green-500 text-white' : i === statusIndex ? 'bg-orange-500 border-orange-500 text-white' : 'border-slate-200 text-slate-400'}`}>
                    {i < statusIndex ? '✓' : i + 1}
                  </div>
                  <span className={`text-xs mt-1 font-semibold text-center whitespace-nowrap ${i === statusIndex ? 'text-orange-500' : i < statusIndex ? 'text-green-600' : 'text-slate-400'}`}>
                    {STATUS_LABELS[s]?.label?.split(' ')[0]}
                  </span>
                </div>
                {i < STATUS_ORDER.length - 2 && <div className={`h-0.5 flex-1 mx-1 mb-4 transition-colors ${i < statusIndex ? 'bg-green-500' : 'bg-slate-200'}`} />}
              </div>
            ))}
          </div>
        </div>

        {job.pickup_lat && job.dropoff_lat && (
          <MapEmbed
            pickupLat={job.pickup_lat} pickupLng={job.pickup_lng}
            dropoffLat={job.dropoff_lat} dropoffLng={job.dropoff_lng}
            driverLat={showDriverLocation ? job.driver.current_lat : null}
            driverLng={showDriverLocation ? job.driver.current_lng : null}
            driverUpdatedAt={showDriverLocation ? job.driver.location_updated_at : null}
          />
        )}

        {job.driver && (
          <div className="card mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-orange-400 to-orange-600 rounded-full flex items-center justify-center text-xl font-black text-white">
                {job.driver.profile?.full_name?.charAt(0) ?? 'D'}
              </div>
              <div className="flex-1">
                <div className="font-bold">{job.driver.profile?.full_name ?? 'Your driver'}</div>
                <div className="text-sm text-slate-500">⭐ {job.driver.rating}</div>
              </div>
              <div className="bg-slate-100 text-slate-700 rounded-lg px-3 py-1.5 text-xs font-bold">🚐 {job.driver.vehicle_plate}</div>
            </div>
            <div className="flex gap-2 mt-4">
              {LIVE_TRACKING_STATUSES.includes(job.status) && (
                <button onClick={callDriver} className="flex-1 bg-green-100 text-green-700 font-semibold py-2.5 rounded-xl text-sm hover:bg-green-200 transition-colors">📞 Call driver</button>
              )}
              <button onClick={() => setShowMessages(true)} className="flex-1 bg-blue-100 text-blue-700 font-semibold py-2.5 rounded-xl text-sm hover:bg-blue-200 transition-colors">💬 Message</button>
            </div>
            <p className="text-xs text-slate-400 mt-2 text-center">Numbers are only shared between you and your driver while the job is active.</p>
          </div>
        )}

        {/* Proof photos taken by the driver at pickup / delivery */}
        {hasProofPhotos && (
          <div className="card mb-4">
            <h2 className="font-bold text-sm text-slate-500 mb-3">Proof photos</h2>
            <div className="grid grid-cols-2 gap-3">
              {job.pickup_photo_url && (
                <div>
                  <div className="text-xs font-semibold text-slate-500 mb-1.5">📦 Loaded at pickup</div>
                  <a href={job.pickup_photo_url} target="_blank" rel="noopener">
                    <img src={job.pickup_photo_url} alt="Item loaded at pickup" className="w-full h-32 object-cover rounded-xl border border-slate-200" loading="lazy" />
                  </a>
                </div>
              )}
              {job.dropoff_photo_url && (
                <div>
                  <div className="text-xs font-semibold text-slate-500 mb-1.5">✅ Delivered</div>
                  <a href={job.dropoff_photo_url} target="_blank" rel="noopener">
                    <img src={job.dropoff_photo_url} alt="Item delivered" className="w-full h-32 object-cover rounded-xl border border-slate-200" loading="lazy" />
                  </a>
                </div>
              )}
            </div>
            {job.delivery_note && (
              <div className="mt-3 bg-blue-50 border border-blue-200 rounded-xl px-3.5 py-2.5 text-sm text-blue-900">
                🗒️ <strong>Driver's delivery note:</strong> {job.delivery_note}
              </div>
            )}
          </div>
        )}

        <div className="card mb-4">
          <h2 className="font-bold text-sm text-slate-500 mb-3">Job details</h2>
          <div className="space-y-2 text-sm">
            {[
              { label: 'Item', value: `${job.item_type} (${job.item_size})` },
              { label: 'Pickup', value: job.pickup_address },
              { label: 'Dropoff', value: job.dropoff_address },
              { label: 'Driver fee', value: `${money(job.driver_fee)} — cash or PayID on delivery` },
              { label: 'Service fee', value: `${money(job.service_fee)}${job.status === 'unpaid' ? ' — unpaid' : ''}` },
            ].map(r => (
              <div key={r.label} className="flex justify-between py-1.5 border-b border-slate-100 last:border-0">
                <span className="text-slate-500">{r.label}</span>
                <span className="font-semibold text-right max-w-[200px]">{r.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Edit the job — wrong suburb, new location, different item/size.
            Free-form before a driver accepts; a driver-approved change
            request afterwards (Uber-style). */}
        {canEdit && (
          <a href={`/buyer/edit/${jobId}`}
            className="block w-full text-center font-semibold text-sm py-2.5 mb-3 rounded-xl border border-orange-200 text-orange-600 hover:bg-orange-50 transition-colors">
            ✏️ Edit job details{job.status === 'accepted' ? ' (your driver approves the changes)' : ' (updates instantly)'}
          </a>
        )}

        {canCancel && (
          <button onClick={handleCancel} disabled={cancelling}
            className="w-full text-center text-red-600 font-semibold text-sm py-2.5 mb-4 rounded-xl border border-red-200 hover:bg-red-50 transition-colors">
            {cancelling ? 'Cancelling...' : job.status === 'accepted' ? `Cancel job ($${money(cancelFee)} fee — reimburses the driver)` : 'Cancel job (free)'}
          </button>
        )}

        {events.length > 0 && (
          <div className="card">
            <h2 className="font-bold text-sm text-slate-500 mb-3">Activity timeline</h2>
            <div className="space-y-3">
              {[...events].reverse().map(ev => (
                <div key={ev.id} className="flex gap-3 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-1.5 flex-shrink-0" />
                  <div>
                    <div className="font-semibold">{STATUS_LABELS[ev.status]?.label ?? ev.status}</div>
                    {ev.note && <div className="text-slate-500 text-xs">{ev.note}</div>}
                    <div className="text-xs text-slate-400 mt-0.5">{new Date(ev.created_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {showMessages && <MessageThread jobId={jobId} onClose={() => setShowMessages(false)} />}
    </div>
  )
}
