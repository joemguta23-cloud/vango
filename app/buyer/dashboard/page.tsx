'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import Nav from '@/components/Nav'
import { createSupabaseBrowserClient } from '@/lib/supabase'

// Buyer home / "My jobs". Lists the buyer's current (active) and previous
// jobs so they can leave a job and come back to it any time. Live-refreshes
// via realtime whenever any of this buyer's jobs changes status.
const STATUS_META = {
  pending:   { label: 'Finding driver',    icon: '🔍', tone: 'bg-orange-100 text-orange-700' },
  accepted:  { label: 'Driver on the way', icon: '🚐', tone: 'bg-blue-100 text-blue-700' },
  picked_up: { label: 'Item collected',    icon: '📦', tone: 'bg-blue-100 text-blue-700' },
  delivered: { label: 'Delivered',         icon: '✅', tone: 'bg-green-100 text-green-700' },
  cancelled: { label: 'Cancelled',         icon: '❌', tone: 'bg-slate-100 text-slate-500' },
}
const ACTIVE = ['pending', 'accepted', 'picked_up']

function JobCard({ job }) {
  const m = STATUS_META[job.status] ?? STATUS_META.pending
  return (
    <a href={`/buyer/tracking/${job.id}`} className="card block hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${m.tone}`}>{m.icon} {m.label}</span>
        <span className="text-xs text-slate-400">{new Date(job.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span>
      </div>
      <div className="font-bold text-slate-800">{job.item_type} <span className="font-normal text-slate-400 text-sm">({job.item_size})</span></div>
      <div className="text-sm text-slate-500 mt-1 truncate">📍 {job.pickup_address}</div>
      <div className="text-sm text-slate-500 truncate">🏁 {job.dropoff_address}</div>
      <div className="text-xs font-semibold text-orange-500 mt-2">View details →</div>
    </a>
  )
}

export default function BuyerDashboard() {
  const supabase = createSupabaseBrowserClient()
  const [jobs, setJobs] = useState(null)
  const [userId, setUserId] = useState(null)

  const fetchJobs = async (uid) => {
    const { data } = await supabase.from('jobs').select('*').eq('buyer_id', uid).order('created_at', { ascending: false })
    setJobs(data ?? [])
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = '/login'; return }
      setUserId(data.user.id)
      fetchJobs(data.user.id)
    })
  }, [])

  // Live-refresh the list whenever any of this buyer's jobs changes.
  useEffect(() => {
    if (!userId) return
    const channel = supabase.channel(`buyer-jobs-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: `buyer_id=eq.${userId}` }, () => fetchJobs(userId))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId])

  const active = (jobs ?? []).filter(j => ACTIVE.includes(j.status))
  const past = (jobs ?? []).filter(j => !ACTIVE.includes(j.status))

  return (
    <div>
      <Nav />
      <div className="max-w-lg mx-auto px-4 pt-24 pb-12">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-black text-slate-800">My jobs</h1>
          <a href="/buyer/post" className="btn-primary py-2 px-4 text-sm">📦 Post a job</a>
        </div>

        {jobs === null && <p className="text-center text-slate-400 py-12">Loading your jobs…</p>}

        {jobs !== null && jobs.length === 0 && (
          <div className="card text-center py-12">
            <div className="text-5xl mb-3">📦</div>
            <p className="font-bold text-slate-700 mb-1">No jobs yet</p>
            <p className="text-sm text-slate-500 mb-4">Post your first delivery and we'll match you with a driver.</p>
            <a href="/buyer/post" className="btn-primary inline-block py-2.5 px-5">Post a job</a>
          </div>
        )}

        {active.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-bold text-slate-500 mb-3 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Current jobs ({active.length})
            </h2>
            <div className="space-y-3">{active.map(j => <JobCard key={j.id} job={j} />)}</div>
          </div>
        )}

        {past.length > 0 && (
          <div>
            <h2 className="text-sm font-bold text-slate-500 mb-3">Previous jobs ({past.length})</h2>
            <div className="space-y-3">{past.map(j => <JobCard key={j.id} job={j} />)}</div>
          </div>
        )}
      </div>
    </div>
  )
}
