'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import type { Job, Driver } from '@/types'

export default function DriverDashboardPage() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()
  const [driver, setDriver] = useState<Driver | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [myJobs, setMyJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)

  useEffect(() => {
    loadData()
    const channel = supabase.channel('pending-jobs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => loadData())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  const loadData = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: d } = await supabase.from('drivers').select('*, profile:profiles(*)').eq('user_id', user.id).single()
    if (!d) { router.push('/driver/onboard'); return }
    setDriver(d)
    const { data: pending } = await supabase.from('jobs').select('*, buyer:profiles(*)').eq('status', 'pending').order('created_at', { ascending: false })
    setJobs(pending ?? [])
    const { data: mine } = await supabase.from('jobs').select('*, buyer:profiles(*)').eq('driver_id', d.id).in('status', ['accepted', 'picked_up']).order('created_at', { ascending: false })
    setMyJobs(mine ?? [])
    setLoading(false)
  }

  const toggleOnline = async () => {
    if (!driver) return
    setToggling(true)
    await supabase.from('drivers').update({ is_online: !driver.is_online }).eq('id', driver.id)
    setDriver(d => d ? { ...d, is_online: !d.is_online } : d)
    setToggling(false)
  }

  const acceptJob = async (job: Job) => {
    if (!driver) return
    const { error } = await supabase.from('jobs').update({ driver_id: driver.id, status: 'accepted' }).eq('id', job.id).eq('status', 'pending')
    if (error) { alert('Job already taken.'); return }
    await supabase.from('job_status_events').insert({ job_id: job.id, status: 'accepted', note: `Driver accepted` })
    router.push(`/driver/job/${job.id}`)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><p>Loading...</p></div>

  return (
    <div>
      <div className="bg-slate-900 pt-16">
        <div className="max-w-2xl mx-auto px-4 py-8">
          <h1 className="text-2xl font-black text-white mb-4">{driver?.profile?.full_name} 👋</h1>
          <button onClick={toggleOnline} disabled={toggling}
            className={`pas3 px-5 rounded-xl font-semibold text-sm transition-all ${driver?.is_online?'bg-green-500 text-white':'bg-white/10 text-slate-300'}`}>
            {driver?.is_online ? 'Online — tap to go offline' : 'Offline — tap to go online'}
          </button>
        </div>
      </div>
      <Nav />
      <div className="max-w-2xl mx-auto px-4 py-6">
        {myJobs.length > 0 && (
          <div className="mb-8">
            <h2 className="font-bold mb-3">Active jobs</h2>
            {myJobs.map(job => (
              <div key={job.id} className="card mb-3 cursor-pointer" onClick={() => router.push(`/driver/job/${job.id}`)}>
                <div className="font-bold">{job.item_type}</div>
                <div className="text-sm text-slate-500">{job.pickup_address} → {job.dropoff_address}</div>
              </div>
            ))}
          </div>
        )}
        <h2 className="font-bold mb-3">Available jobs</h2>
        {jobs.map(job => (
          <div key={job.id} className="card mb-3">
            <div className="flex justify-between items-center">
              <div>
                <div className="font-bold">{job.item_type}</div>
                <div className="text-sm text-slate-500">{job.pickup_address} → {job.dropoff_address}</div>
              </div>
              <div className="text-right">
                <div className="font-black text-xl">$${job.driver_fee}</div>
                <button onClick={() => acceptJob(job)} className="btn-primary py-2 px-4 text-sm mt-1">Accept</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
