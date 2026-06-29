'use client'
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import type { Job, Driver } from '@/types'
import Link from 'next/link'

export default function AdminPage() {
  const supabase = createSupabaseBrowserClient()
  const [jobs, setJobs] = useState<Job[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [tab, setTab] = useState('jobs')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('jobs').select('*').order('created_at',{ascending:false}).limit(50).then(({data})=>{setJobs(data??[]);setLoading(false)})
  },[])

  if(loading) return <div className="min-h-screen flex items-center justify-center text-5xl">⚙️</div>

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 bg-slate-900 min-h-screen fixed left-0 top-0 p-6">
        <div className="font-black text-white text-lg mb-6">🚐 VanGo Admin</div>
        <Link href="/" className="text-slate-400 text-sm">← Back to site</Link>
      </aside>
      <main className="ml-56 flex-1 p-8 bg-slate-50 min-h-screen">
        <h1>Dashboard</h1>
        <p className="text-slate-500">{jobs.length} total jobs</p>
      </main>
    </div>
  )
}
