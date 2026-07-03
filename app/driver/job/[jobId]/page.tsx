'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import MessageThread from '@/components/MessageThread'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { haversineKm } from '@/lib/pricing'
import type { Job } from '@/types'

const NEXT_STATUS: Record<string, { status: string; label: string; note: string }> = {
  accepted: { status: 'picked_up', label: 'Mark as Picked Up', note: 'Item collected from seller' },
  picked_up: { status: 'delivered', label: 'Mark as Delivered', note: 'Item delivered to buyer' },
}

// Statuses during which this driver's live location should be broadcast to
// the buyer. Location sharing stops the moment the job leaves this set
// (delivered, or the effect cleans up on unmount) -- for privacy.
const LIVE_TRACKING_STATUSES = ['accepted', 'picked_up']

export default function DriverJobPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()
  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [locationSharing, setLocationSharing] = useState<'idle' | 'active' | 'denied' | 'unsupported'>('idle')
  const [showMessages, setShowMessages] = useState(false)

  useEffect(() => {
    supabase.from('jobs').select('*, buyer:profiles(*)').eq('id', jobId).single()
      .then(({ data }) => { setJob(data as Job); setLoading(false) })
  }, [jobId])

  // Share this driver's live GPS position while the job is actively out for
  // delivery, so the buyer can see the driver approaching on the map (like
  // Uber Eats). Stops automatically once the job is delivered or this page
  // is left, and never runs for any other job status.
  useEffect(() => {
    if (!job || !job.driver_id) return
    if (!LIVE_TRACKING_STATUSES.includes(job.status)) return
    if (!('geolocation' in navigator)) { setLocationSharing('unsupported'); return }

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
  }, [job?.status, job?.driver_id])

  const advanceStatus = async () => {
    if (!job) return
    const next = NEXT_STATUS[job.status]
    if (!next) return
    setUpdating(true)
    // Stamp the delivery-lifecycle timestamps so we can measure pickup ETA and
    // total job time for the data-driven pricing analytics (see PRICING policy).
    const patch: any = { status: next.status }
    if (next.status === 'picked_up') patch.picked_up_at = new Date().toISOString()
    if (next.status === 'delivered') patch.delivered_at = new Date().toISOString()
    await supabase.from('jobs').update(patch).eq('id', jobId)
    await supabase.from('job_status_events').insert({
      job_id: jobId, status: next.status, note: next.note,
    })
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

  const nextAction = NEXT_STATUS[job.status]
  const showLocationBanner = LIVE_TRACKING_STATUSES.includes(job.status)
  const hasExtraStops = !!(job.second_pickup_address || job.second_dropoff_address)
  const canCancel = job.status === 'accepted' || job.status === 'picked_up'

  return (
    <div>
      <Nav />
      <div className="max-w-lg mx-auto px-4 pt-24 pb-12 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-black">Active Job</h1>
          <span className="badge-orange capitalize">{job.status.replace('_',' ')}</span>
        </div>

        {showLocationBanner && (
          <div className={`rounded-xl px-4 py-2.5 text-xs font-semibold flex items-center gap-2 ${
            locationSharing === 'active' ? 'bg-green-50 border border-green-200 text-green-700'
            : locationSharing === 'denied' ? 'bg-amber-50 border border-amber-200 text-amber-700'
            : 'bg-slate-50 border border-slate-200 text-slate-500'
          }`}>
            {locationSharing === 'active' && (<><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Sharing your live location with the buyer</>)}
            {locationSharing === 'denied' && (<>⚠️ Location permission denied -- turn on location services so the buyer can see you're on the way</>)}
            {locationSharing === 'unsupported' && (<>Live location isn't supported on this device</>)}
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
          <div className="text-base font-bold mb-1">{job.item_type} <span className="text-slate-400 font-normal text-sm">({job.item_size})</span></div>
          <p className="text-sm text-slate-600">{job.item_description}</p>
          {job.photo_url && (
            <img src={job.photo_url} alt="Item" className="mt-3 rounded-xl w-full h-40 object-cover" />
          )}
        </div>

        <div className="card">
          <h2 className="font-bold text-sm text-slate-500 mb-3">Buyer</h2>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-bold">{job.buyer?.full_name}</div>
              <div className="text-sm text-slate-500">{job.buyer?.phone}</div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowMessages(true)} className="bg-blue-100 text-blue-700 font-semibold px-4 py-2 rounded-xl text-sm hover:bg-blue-200 transition-colors">Message</button>
              <a href={`tel:${job.buyer?.phone}`} className="bg-green-100 text-green-700 font-semibold px-4 py-2 rounded-xl text-sm hover:bg-green-200 transition-colors">Call</a>
            </div>
          </div>
        </div>

        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-sm">
          <div className="font-bold text-orange-800 mb-1">Payment on delivery</div>
          <div className="text-orange-700">Collect <strong>${job.driver_fee} cash</strong> from the buyer when you hand over the item.</div>
        </div>

        {nextAction && (
          <button onClick={advanceStatus} disabled={updating}
            className="btn-primary w-full justify-center py-3.5 text-base">
            {updating ? 'Updating...' : nextAction.label}
          </button>
        )}

        <button onClick={() => router.push('/driver/dashboard')} className="btn-secondary w-full justify-center">
          Back to dashboard
        </button>

        {canCancel && (
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
