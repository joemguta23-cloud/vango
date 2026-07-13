'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import Nav from '@/components/Nav'
import { createSupabaseBrowserClient } from '@/lib/supabase'

// Buyer home / "My jobs". Lists the buyer's current (active) and previous
// jobs so they can leave a job and come back to it any time. Live-refreshes
// via realtime whenever any of this buyer's jobs changes status.
// PAYMENT HARD-STOP: a job posts as 'unpaid' and is invisible to drivers
// until the service fee is paid (or fully waived by a promo code). Unpaid
// jobs show here with an "Awaiting payment" badge — open one to pay.
// Jobs posted without a scheduled date are automatically removed if no
// driver accepts within 24 hours (unpaid ones too). Those show a notice
// banner plus a one-tap "Repost" — a repost keeps its paid status, and each
// repost also stays live for up to 24 hours.
const STATUS_META = {
  unpaid:    { label: 'Awaiting payment — not visible to drivers', icon: '💳', tone: 'bg-purple-100 text-purple-700' },
  pending:   { label: 'Finding driver',    icon: '🔍', tone: 'bg-orange-100 text-orange-700' },
  accepted:  { label: 'Driver on the way', icon: '🚐', tone: 'bg-blue-100 text-blue-700' },
  picked_up: { label: 'Item collected',    icon: '📦', tone: 'bg-blue-100 text-blue-700' },
  delivered: { label: 'Delivered',         icon: '✅', tone: 'bg-green-100 text-green-700' },
  cancelled: { label: 'Cancelled',         icon: '❌', tone: 'bg-slate-100 text-slate-500' },
  expired:   { label: 'Removed — not accepted in 24h', icon: '⏳', tone: 'bg-amber-100 text-amber-700' },
}
const ACTIVE = ['unpaid', 'pending', 'accepted', 'picked_up']
// Fields never copied when reposting an expired job (fresh defaults apply).
const REPOST_SKIP = /^(id|created_at|updated_at|status|driver_id)$|cancel|rating|rated|refund|paid|payment|stripe|adjust/i

function JobCard({ job, onRepost, reposting }) {
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
      {job.status === 'unpaid' && (
        <div className="text-xs font-semibold text-purple-600 mt-2">💳 Pay the service fee to make this job live →</div>
      )}
      {job.status !== 'expired' && job.status !== 'unpaid' && <div className="text-xs font-semibold text-orange-500 mt-2">View details →</div>}
      {job.status === 'expired' && (
        <div className="mt-3 border-t border-amber-100 pt-3">
          <p className="text-xs text-amber-700 mb-2">This job was removed after 24 hours. Repost it and it goes live again for up to 24 hours.</p>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRepost(job) }}
            disabled={reposting === job.id}
            className="w-full text-sm font-bold bg-orange-500 text-white rounded-lg py-2 hover:bg-orange-600 disabled:opacity-60"
          >{reposting === job.id ? 'Reposting…' : '🔁 Repost job'}</button>
        </div>
      )}
    </a>
  )
}

export default function BuyerDashboard() {
  const supabase = createSupabaseBrowserClient()
  const [jobs, setJobs] = useState(null)
  const [notes, setNotes] = useState([])
  const [userId, setUserId] = useState(null)
  const [reposting, setReposting] = useState(null)

  const fetchJobs = async (uid) => {
    const { data } = await supabase.from('jobs').select('*').eq('buyer_id', uid).order('created_at', { ascending: false })
    setJobs(data ?? [])
  }

  const fetchNotes = async (uid) => {
    const { data } = await supabase.from('notifications').select('*').eq('user_id', uid).eq('read', false).order('created_at', { ascending: false }).limit(10)
    setNotes(data ?? [])
  }

  const dismissNote = async (id) => {
    setNotes(n => n.filter(x => x.id !== id))
    await supabase.from('notifications').update({ read: true }).eq('id', id)
  }

  // Relist an expired job as a brand-new job with a fresh 24h window. If the
  // original's service fee was already paid (or waived), the repost goes
  // straight back to 'pending'; otherwise it reposts as 'unpaid' and the
  // buyer pays from the tracking page to make it live.
  const repost = async (job) => {
    if (!userId || reposting) return
    setReposting(job.id)
    const copy = {}
    for (const k of Object.keys(job)) { if (!REPOST_SKIP.test(k)) copy[k] = job[k] }
    const wasPaid = !!job.service_fee_paid
    copy.buyer_id = userId
    copy.status = wasPaid ? 'pending' : 'unpaid'
    copy.service_fee_paid = wasPaid
    copy.scheduled_for = null
    const { error } = await supabase.from('jobs').insert(copy)
    if (!error) {
      await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('job_id', job.id)
      await fetchJobs(userId)
      await fetchNotes(userId)
    } else {
      alert('Could not repost this job: ' + error.message)
    }
    setReposting(null)
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = '/login'; return }
      setUserId(data.user.id)
      fetchJobs(data.user.id)
      fetchNotes(data.user.id)
    })
  }, [])

  // Live-refresh the list whenever any of this buyer's jobs changes.
  useEffect(() => {
    if (!userId) return
    const channel = supabase.channel(`buyer-jobs-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: `buyer_id=eq.${userId}` }, () => { fetchJobs(userId); fetchNotes(userId) })
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

        {notes.length > 0 && (
          <div className="space-y-2 mb-6">
            {notes.map(n => (
              <div key={n.id} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-amber-800">⏳ {n.title}</p>
                    <p className="text-xs text-amber-700 mt-0.5">{n.body}</p>
                  </div>
                  <button onClick={() => dismissNote(n.id)} className="text-xs font-bold text-amber-700 hover:text-amber-900 shrink-0">Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        )}

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
            <div className="space-y-3">{active.map(j => <JobCard key={j.id} job={j} onRepost={repost} reposting={reposting} />)}</div>
          </div>
        )}

        {past.length > 0 && (
          <div>
            <h2 className="text-sm font-bold text-slate-500 mb-3">Previous jobs ({past.length})</h2>
            <div className="space-y-3">{past.map(j => <JobCard key={j.id} job={j} onRepost={repost} reposting={reposting} />)}</div>
          </div>
        )}
      </div>
    </div>
  )
}
