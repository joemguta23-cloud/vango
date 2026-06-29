'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Nav from '@/components/Nav'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import type { Job, JobStatusEvent } from '@/types'

const STATUS_LABELS: Record<string, { label: string; icon: string; msg: string }> = {
  pending:   { label: 'Finding driver', icon: '🔍', msg: 'We\'re matching you with the nearest available driver...' },
  accepted:  { label: 'Driver on the way', icon: '🚐', msg: 'Your driver has accepted and is heading to the seller.' },
  picked_up: { label: 'Item collected', icon: '📦', msg: 'Your item has been picked up and is on its way to you.' },
  delivered: { label: 'Delivered!', icon: '✅', msg: '🎉 Your item has been delivered. Please pay the driver the agreed cash amount.' },
  cancelled: { label: 'Cancelled', icon: '❌', msg: 'This job was cancelled.' },
}

const STATUS_ORDER = ['pending', 'accepted', 'picked_up', 'delivered']

export default function TrackingPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const supabase = createSupabaseBrowserClient()
  const [job, setJob] = useState<Job | null>(null)
  const [events, setEvents] = useState<JobStatusEvent[]>([])
  const [loading, setLoading] = useState(true)

  const fetchJob = async () => {
    const { data } = await supabase
      .from('jobs')
      .select('*, driver:drivers(*, profile:profiles(*))')
      .eq('id', jobId)
      .single()
    setJob(data as Job)
    setLoading(false)
  }

  const fetchEvents = async () => {
    const { data } = await supabase
      .from('job_status_events')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true })
    setEvents(data ?? [])
  }

  useEffect(() => {
    fetchJob()
    fetchEvents()

    const channel = supabase
      .channel(`job-${jobId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `id=eq.${jobId}` }, () => { fetchJob() })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'job_status_events', filter: `job_id=eq.${jobId}` }, () => { fetchEvents() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [jobId])

  if (loading) return <div className="min-h-screen flex items-center justify-center"><p>Loading...</p></div>
  if (!job) return <div className="min-h-screen flex items-center justify-center"><p>Job not found.</p></div>
  const statusInfo = STATUS_LABELS[job.status] ?? STATUS_LABELS.pending
  const statusIndex = STATUS_ORDER.indexOf(job.status)
  return (
    <div><Nav />
      <div className="max-w-lg mx-auto px-4 pt-24 pb-12">
        <div className="rounded-2xl p-6 text-center mb-6">
          <div className="text-5xl mb-3">{statusInfo.icon}</div>
          <h1 className="text-xl font-black mb-1">{statusInfo.label}</h1>
          <p className="text-slate-600 text-sm">{statusInfo.msg}</p>
        </div>
        {job.driver && <div className="card mb-4"><div className="font-bold">{job.driver.profile?.full_name}</div></div>}
        <div className="card"><h2 className="font-bold mb-3">Job details</h2></div>
      </div>
    </div>
  )
}
