'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import type { Job } from '@/types'

const NEXT_STATUS: Record<string, { status: string; label: string; note: string }> = {
  accepted:  { status: 'picked_up', label: 'Mark as Picked Up', note: 'Item collected from seller' },
  picked_up: { status: 'delivered', label: 'Mark as Delivered', note: 'Item delivered to buyer' },
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
    await supabase.from('job_status_events').insert({
      job_id: jobId, status: next.status, note: next.note,
    })
    if (next.status === 'delivered') {
      router.push('/driver/dashboard')
    } else {
      setJob(j => j ? { ...j, status: next.status as any } : j)
    }
    setUpdating(false)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="text-5xl animate-bounce">Loading...</div></div>
  if (!job) return <div className="min-h-screen flex items-center justify-center">Job not found.</div>

  const nextAction = NEXT_STATUS[job.status]

  return (
    <div>
      <Nav />
      <div className="max-w-lg mx-auto px-4 pt-24 pb-12 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-black">Active Job</h1>
          <span className="badge-orange capitalize">{job.status.replace('_',' ')}</span>
        </div>

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
              <div>
                <div className="text-xs font-semibold text-slate-500 mb-0.5">DROPOFF</div>
                <div className="font-semibold text-sm">{job.dropoff_address}</div>
              </div>
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
          <div className="flex items-center justify-between">
            <div>
              <div className="font-bold">{job.buyer?.full_name}</div>
              <div className="text-sm text-slate-500">{job.buyer?.phone}</div>
            </div>
            <a href={`tel:${job.buyer?.phone}`}
              className="bg-green-100 text-green-700 font-semibold px-4 py-2 rounded-xl text-sm hover:bg-green-200 transition-colors">
              Call
            </a>
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
      </div>
    </div>
  )
}
