'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import type { Job, Driver } from '@/types'

const ITEM_ICONS: Record<string, string> = {
  'Fridge':'Fridge','Washer/Dryer':'Washer','Mattress':'Mattress','Couch':'Couch',
  'TV/Desk':'TV','Wardrobe':'Wardrobe','Dining Table':'Table','Gym Equipment':'Gym',
  'Tools':'Tools','Garden':'Garden','Materials':'Materials','Other':'Item',
}

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
    const channel = supabase
      .channel('pending-jobs')
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
    const itemCount = Array.isArray((job as any).items) ? (job as any).items.length : 1
    if (itemCount > 1) {
      const itemList = (job as any).items.map((it: any) => it.item_type).join(', ')
      const confirmed = window.confirm(
        `This job has ${itemCount} items (${itemList}) that all need to fit in your vehicle at the same time. Please check the item descriptions/photos and confirm everything will fit before accepting.\n\nContinue and accept this job?`
      )
      if (!confirmed) return
    }
    const { error } = await supabase.from('jobs').update({ driver_id: driver.id, status: 'accepted' }).eq('id', job.id).eq('status', 'pending')
    if (error) { alert('Sorry, that job was just taken.'); return }
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
          <div className="flex items-center gap-3 mb-6 flex-wrap">
            <button onClick={toggleOnline} disabled={toggling}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border font-semibold text-sm transition-all ${
                driver?.is_online
                  ? 'bg-green-500/15 border-green-500/30 text-green-400'
                  : 'bg-white/10 border-white/15 text-slate-300'
              }`}>
              <span className={`w-2 h-2 rounded-full ${driver?.is_online ? 'bg-green-400' : 'bg-slate-500'}`} />
              {driver?.is_online ? 'Online - accepting jobs' : 'Offline - tap to go online'}
            </button>
            <span className="text-xs bg-white/10 border border-white/15 text-slate-300 px-3 py-1.5 rounded-lg font-semibold">
              {driver?.vehicle_make} {driver?.vehicle_model} - {driver?.vehicle_plate}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3">
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
            {myJobs.map(job => (
              <div key={job.id} className="card mb-3 border-orange-200 bg-orange-50 cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => router.push(`/driver/job/${job.id}`)}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold">{job.item_type}</div>
                    <div className="text-xs text-slate-500">{job.pickup_address} to {job.dropoff_address}</div>
                  </div>
                  <span className="badge-orange">{job.status === 'accepted' ? 'Heading to pickup' : 'Item collected'}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-base">Available jobs</h2>
          <span className="text-sm text-slate-500">{jobs.length} available</span>
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
                  <div className="text-xs text-slate-400">cash</div>
                </div>
              </div>
              {itemCount > 1 && (
                <div className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                  ⚠️ Multiple items -- check they'll all fit in your vehicle before accepting.
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-slate-600 mb-3">
                <span>{job.pickup_address.split(',')[0]}</span>
                <span className="text-slate-300">to</span>
                <span>{job.dropoff_address.split(',')[0]}</span>
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
