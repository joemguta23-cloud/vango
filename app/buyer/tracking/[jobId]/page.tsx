'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Nav from '@/components/Nav'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const STATUS_LABELS = {
  pending: { label: 'Finding driver', icon: '🔍', msg: "We're matching you with the nearest available driver..." },
  accepted: { label: 'Driver on the way', icon: '🚐', msg: 'Your driver has accepted and is heading to the seller.' },
  picked_up: { label: 'Item collected', icon: '📦', msg: 'Your item has been picked up and is on its way to you.' },
  delivered: { label: 'Delivered!', icon: '✅', msg: '🎉 Your item has been delivered. Please pay the driver the agreed cash amount.' },
  cancelled: { label: 'Cancelled', icon: '❌', msg: 'This job was cancelled.' },
}
const STATUS_ORDER = ['pending', 'accepted', 'picked_up', 'delivered']

function MapEmbed({ pickupLat, pickupLng, dropoffLat, dropoffLng }) {
  const minLng = Math.min(pickupLng, dropoffLng) - 0.05
  const maxLng = Math.max(pickupLng, dropoffLng) + 0.05
  const minLat = Math.min(pickupLat, dropoffLat) - 0.05
  const maxLat = Math.max(pickupLat, dropoffLat) + 0.05
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${minLng},${minLat},${maxLng},${maxLat}&layer=mapnik`
  return (
    <div className="card mb-4 p-0 overflow-hidden">
      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <span className="text-base">🗺️</span>
        <h2 className="font-bold text-sm text-slate-600">Route map</h2>
      </div>
      <iframe src={src} className="w-full" style={{ height: 220, border: 0 }} loading="lazy" title="Delivery route map" />
      <div className="px-4 py-2 flex gap-3 text-xs text-slate-500 border-t border-slate-100">
        <span>🟢 Pickup: {pickupLat.toFixed(4)}, {pickupLng.toFixed(4)}</span>
        <span>🔴 Dropoff: {dropoffLat.toFixed(4)}, {dropoffLng.toFixed(4)}</span>
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

  const fetchJob = async () => {
    const { data } = await supabase.from('jobs').select('*, driver:drivers(*, profile:profiles(*))').eq('id', jobId).single()
    setJob(data)
    setLoading(false)
  }
  const fetchEvents = async () => {
    const { data } = await supabase.from('job_status_events').select('*').eq('job_id', jobId).order('created_at', { ascending: true })
    setEvents(data ?? [])
  }

  useEffect(() => {
    fetchJob(); fetchEvents()
    const channel = supabase.channel(`job-${jobId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `id=eq.${jobId}` }, fetchJob)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'job_status_events', filter: `job_id=eq.${jobId}` }, fetchEvents)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [jobId])

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="text-5xl mb-4 animate-bounce">🚐</div></div>
  if (!job) return <div className="min-h-screen flex items-center justify-center"><p>Job not found.</p></div>

  const statusInfo = STATUS_LABELS[job.status] ?? STATUS_LABELS.pending
  const statusIndex = STATUS_ORDER.indexOf(job.status)

  return (
    <div>
      <Nav />
      <div className="max-w-lg mx-auto px-4 pt-24 pb-12">
        <div className={`rounded-2xl p-6 text-center mb-6 ${job.status === 'delivered' ? 'bg-green-50 border border-green-200' : job.status === 'cancelled' ? 'bg-red-50 border border-red-200' : 'bg-orange-50 border border-orange-200'}`}>
          <div className="text-5xl mb-3">{statusInfo.icon}</div>
          <h1 className="text-xl font-black text-slate-800 mb-1">{statusInfo.label}</h1>
          <p className="text-slate-600 text-sm">{statusInfo.msg}</p>
          {job.status === 'pending' && (
            <div className="flex justify-center gap-1.5 mt-4">
              {[0,1,2].map(i => <div key={i} className="w-2 h-2 rounded-full bg-orange-500 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
            </div>
          )}
        </div>

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
          <MapEmbed pickupLat={job.pickup_lat} pickupLng={job.pickup_lng} dropoffLat={job.dropoff_lat} dropoffLng={job.dropoff_lng} />
        )}

        {job.driver && (
          <div className="card mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-orange-400 to-orange-600 rounded-full flex items-center justify-center text-xl font-black text-white">
                {job.driver.profile?.full_name?.charAt(0) ?? 'D'}
              </div>
              <div className="flex-1">
                <div className="font-bold">{job.driver.profile?.full_name}</div>
                <div className="text-sm text-slate-500">⭐ {job.driver.rating} · {job.driver.total_jobs} deliveries</div>
              </div>
              <div className="bg-slate-100 text-slate-700 rounded-lg px-3 py-1.5 text-xs font-bold">🚐 {job.driver.vehicle_plate}</div>
            </div>
            <div className="flex gap-2 mt-4">
              <a href={`tel:${job.driver.profile?.phone}`} className="flex-1 bg-green-100 text-green-700 font-semibold py-2.5 rounded-xl text-sm text-center hover:bg-green-200 transition-colors">📞 Call driver</a>
              <button className="flex-1 bg-blue-100 text-blue-700 font-semibold py-2.5 rounded-xl text-sm hover:bg-blue-200 transition-colors">💬 Message</button>
            </div>
          </div>
        )}

        <div className="card mb-4">
          <h2 className="font-bold text-sm text-slate-500 mb-3">Job details</h2>
          <div className="space-y-2 text-sm">
            {[
              { label: 'Item', value: `${job.item_type} (${job.item_size})` },
              { label: 'Pickup', value: job.pickup_address },
              { label: 'Dropoff', value: job.dropoff_address },
              { label: 'Driver fee', value: `$${job.driver_fee} cash on delivery` },
              { label: 'Service fee', value: `$${job.service_fee}` },
            ].map(r => (
              <div key={r.label} className="flex justify-between py-1.5 border-b border-slate-100 last:border-0">
                <span className="text-slate-500">{r.label}</span>
                <span className="font-semibold text-right max-w-[200px]">{r.value}</span>
              </div>
            ))}
          </div>
        </div>

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
    </div>
  )
}
