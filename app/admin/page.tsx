'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import type { Job, Driver } from '@/types'
import Link from 'next/link'

// SECURITY: this page verifies the signed-in user has role='admin' before
// loading anything, and redirects everyone else. Data access is additionally
// enforced by RLS admin policies (see supabase/migration_005) — without
// them a non-admin would see nothing here anyway, but the gate keeps the
// page itself from ever rendering for the wrong audience.
// Phone numbers are NOT shown: the phone column is protected at the DB level.
// Look drivers up in the Supabase dashboard if you ever need to call one.
export default function AdminPage() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()
  const [jobs, setJobs] = useState<Job[]>([])
  const [drivers, setDrivers] = useState<any[]>([])
  const [tab, setTab] = useState<'jobs'|'drivers'|'pending'>('jobs')
  const [loading, setLoading] = useState(true)
  const [authorised, setAuthorised] = useState(false)

  const loadData = () =>
    Promise.all([
      supabase.from('jobs').select('*, buyer:profiles(id, full_name), driver:drivers(*, profile:profiles(id, full_name))').order('created_at', { ascending: false }).limit(50),
      supabase.from('drivers').select('*, profile:profiles(id, full_name, role, created_at)').order('created_at', { ascending: false }),
    ]).then(([{ data: j }, { data: d }]) => {
      setJobs((j ?? []) as Job[])
      setDrivers(d ?? [])
      setLoading(false)
    })

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/login'); return }
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      if (profile?.role !== 'admin') { router.replace('/'); return }
      setAuthorised(true)
      loadData()
    }
    init()
  }, [])

  const approve = async (driverId: string) => {
    await supabase.from('drivers').update({ is_approved: true }).eq('id', driverId)
    loadData()
  }

  const reject = async (driverId: string) => {
    await supabase.from('drivers').update({ is_approved: false }).eq('id', driverId)
    loadData()
  }

  const activeJobs = jobs.filter(j => ['accepted','picked_up'].includes(j.status))
  const onlineDrivers = drivers.filter(d => d.is_online)
  const pendingDrivers = drivers.filter(d => !d.is_approved)
  const approvedDrivers = drivers.filter(d => d.is_approved)
  const todayFees = jobs.filter(j => j.status === 'delivered' && new Date(j.created_at).toDateString() === new Date().toDateString())
                      .reduce((sum, j) => sum + Number(j.service_fee), 0)

  const STATUS_BADGE: Record<string, string> = {
    pending: 'badge-orange', accepted: 'badge-blue',
    picked_up: 'badge-blue', delivered: 'badge-green', cancelled: 'badge-slate',
  }

  if (loading || !authorised) return <div className="min-h-screen flex items-center justify-center"><div className="text-5xl animate-bounce">⚙️</div></div>

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 bg-slate-900 min-h-screen fixed left-0 top-0 flex flex-col py-6 z-50">
        <div className="px-5 pb-5 border-b border-white/10 mb-4 flex items-center gap-2 font-black text-white text-lg">
          <span className="w-7 h-7 bg-orange-500 rounded-lg flex items-center justify-center text-sm">🚐</span>
          Van<span className="text-orange-500">Go</span>
          <span className="text-xs text-slate-500 font-normal">Admin</span>
        </div>
        {[
          { icon: '📦', label: 'All Jobs', t: 'jobs' },
          { icon: '🚐', label: 'Drivers', t: 'drivers' },
          { icon: '⏳', label: `Pending ${pendingDrivers.length > 0 ? `(${pendingDrivers.length})` : ''}`, t: 'pending' },
        ].map(item => (
          <button key={item.t} onClick={() => setTab(item.t as any)}
            className={`flex items-center gap-3 px-5 py-2.5 text-sm font-medium text-left transition-all ${
              tab === item.t ? 'text-white bg-orange-500/15 border-r-2 border-orange-500' : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}>
            <span>{item.icon}</span>{item.label}
            {item.t === 'pending' && pendingDrivers.length > 0 && (
              <span className="ml-auto bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">{pendingDrivers.length}</span>
            )}
          </button>
        ))}
        <div className="flex-1" />
        <Link href="/" className="flex items-center gap-3 px-5 py-2.5 text-sm text-slate-400 hover:text-white transition-colors">← Back to site</Link>
      </aside>

      <main className="ml-56 flex-1 p-8 bg-slate-50 min-h-screen">
        <div className="mb-7">
          <h1 className="text-2xl font-black">Dashboard</h1>
          <p className="text-slate-500 text-sm">{new Date().toLocaleDateString('en-AU', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
          {[
            { icon: '📦', bg: 'bg-orange-50', num: activeJobs.length, label: 'Active Jobs' },
            { icon: '🚐', bg: 'bg-green-50',  num: onlineDrivers.length, label: 'Drivers Online' },
            { icon: '💰', bg: 'bg-blue-50',   num: `$${todayFees.toFixed(2)}`, label: 'Fees Today' },
            { icon: '⏳', bg: 'bg-red-50',    num: pendingDrivers.length, label: 'Awaiting Approval' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-4">
              <div className={`w-12 h-12 ${s.bg} rounded-xl flex items-center justify-center text-2xl flex-shrink-0`}>{s.icon}</div>
              <div><div className="text-2xl font-black">{s.num}</div><div className="text-xs text-slate-500">{s.label}</div></div>
            </div>
          ))}
        </div>

        {/* Pending driver approvals */}
        {tab === 'pending' && (
          <div className="space-y-4">
            <h2 className="font-bold text-lg">Drivers awaiting approval</h2>
            {pendingDrivers.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400">All drivers approved ✓</div>
            ) : pendingDrivers.map(d => (
              <div key={d.id} className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white font-bold">
                    {d.profile?.full_name?.charAt(0)}
                  </div>
                  <div>
                    <div className="font-bold">{d.profile?.full_name}</div>
                    <div className="text-sm text-slate-500">ABN: {d.abn || '—'} · Licence: {d.license_number || '—'}</div>
                    <div className="text-sm text-slate-500">🚐 {d.vehicle_type} — {d.vehicle_make} {d.vehicle_model} · {d.vehicle_plate}</div>
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => reject(d.id)} className="px-4 py-2 rounded-xl border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 transition-all">
                    Reject
                  </button>
                  <button onClick={() => approve(d.id)} className="px-4 py-2 rounded-xl bg-green-500 text-white text-sm font-semibold hover:bg-green-600 transition-all">
                    ✓ Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Jobs tab */}
        {tab === 'jobs' && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center">
              <div className="font-bold">All Jobs</div>
              <span className="badge-orange">{activeJobs.length} in transit</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>{['Item','Route','Driver','Status','Fee','Time'].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {jobs.map(j => (
                    <tr key={j.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-5 py-3.5 font-semibold">{j.item_type}</td>
                      <td className="px-5 py-3.5 text-slate-500 text-xs">{j.pickup_address?.split(',')[1]?.trim()} → {j.dropoff_address?.split(',')[1]?.trim()}</td>
                      <td className="px-5 py-3.5 font-medium">{(j.driver as any)?.profile?.full_name ?? <span className="text-slate-400 italic">Unassigned</span>}</td>
                      <td className="px-5 py-3.5"><span className={STATUS_BADGE[j.status] ?? 'badge-slate'}>{j.status.replace('_',' ')}</span></td>
                      <td className="px-5 py-3.5 font-bold">${j.service_fee}</td>
                      <td className="px-5 py-3.5 text-slate-400 text-xs">{new Date(j.created_at).toLocaleTimeString('en-AU', { hour:'2-digit', minute:'2-digit' })}</td>
                    </tr>
                  ))}
                  {jobs.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400">No jobs yet</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Drivers tab */}
        {tab === 'drivers' && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center">
              <div className="font-bold">Approved Drivers</div>
              <span className="badge-green">{onlineDrivers.length} online</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>{['Driver','Vehicle','ABN','Status','Jobs','Stripe','Rating'].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {approvedDrivers.map(d => (
                    <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white text-sm font-bold">
                            {d.profile?.full_name?.charAt(0)}
                          </div>
                          <span className="font-semibold">{d.profile?.full_name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-slate-500">🚐 {d.vehicle_make} {d.vehicle_model} · {d.vehicle_plate}</td>
                      <td className="px-5 py-3.5 text-slate-500">{d.abn || '—'}</td>
                      <td className="px-5 py-3.5">{d.is_online ? <span className="badge-green">● Online</span> : <span className="badge-slate">Offline</span>}</td>
                      <td className="px-5 py-3.5 font-semibold">{d.total_jobs}</td>
                      <td className="px-5 py-3.5">{d.stripe_onboarded ? <span className="badge-green">✓ Connected</span> : <span className="badge-orange">Pending</span>}</td>
                      <td className="px-5 py-3.5"><span className="text-yellow-600 font-bold">⭐ {d.rating}</span></td>
                    </tr>
                  ))}
                  {approvedDrivers.length === 0 && <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-400">No approved drivers yet</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
0
