'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import type { Job } from '@/types'

const NEXT_STATUS: Record<string, { status: string; label: string; note: string }> = {
  accepted:  { status: 'picked_up', label: '📦 Mark as Picked Up', note: 'Item collected from seller' },
  picked_up: { status: 'delivered', label: '✅ Mark as Delivered', note: 'Item delivered to buyer' },
}

export default function DriverJobPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()
  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    supabase.from('jobs').select('*, buyer:profiles(*)').eq('id', jobId).single()
      .then(({ data }) => { setJob(data as Job); setLoading(false) })
  }, [jobId])

  const advanceStatus = async () => {
    if (!job) return
    const next = NEXT_STATUS[job.status]
    if (!next) return
    setUpdating(true)
    await supabase.from('jobs').update({ status: next.status }).eq('id', jobId)
    await supabase.from('job_status_events').insert({ job_id: jobId.status: next.status, note: next.note })
    if (next.status === 'delivered') router.push('/driver/dashboard')
    else setJob(j => j ? { ...j, status: next.status as any } : j)
    setUpdating(false)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="text-5xl animate-bounce">🚐</div></div>
  if (!job) return <div>Job not found.</div>
  const nextAction = NEXT_STATUS[job.status]
  return (
    <div><Nav />
      <div className="max-w-lg mx-auto px-4 pt-24 pb-12 space-y-4">
        <h1 className="text-xl font-black">Active Job</h1>
        <div className="card">
          <h2 className="font-bold mb-3">Route</h2>
          <p className="text-sm">Pickup: {job.pickup_address}</p>
          <p className="text-sm">Dropoff: {job.dropoff_address}</p>
        </div>
        <div className="card">
          <h2 className="font-bold mb-3">Item</h2>
          <p className="font-bold">{job.item_type}</p>
          <p className="text-sm text-slate-500">{job.item_description}</p>
        </div>
        <div className="card">
          <h2 className="font-bold mb-3">Buyer</h2>
          <p>{job.buyer?.full_name}</p>
          <a href={`tel:${job.buyer?.phone}`} className="btn-primary py-2 px-4 text-sm mt-2 inline-block">📞 Call</a>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-sm">
          Collect <strong>${job.driver_fee} cash</strong> from buyer on delivery.
        </div>
        {nextAction && (
          <button onClick={advanceStatus} disabled={updating} className="btn-primary w-full justify-center py-3.5 text-base">
            {updating ? 'Updating...' : nextAction.label}
          </button>
        )}
        <button onClick={() => router.push('/driver/dashboard')} className="btn-secondary w-full justify-center">← Back</button>
      </div>
    </div>
  )
}
