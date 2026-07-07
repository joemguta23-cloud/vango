import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

// Returns the OTHER party's phone number for an ACTIVE job, so the customer
// can call the driver and vice versa once a job has been accepted.
//
// Privacy design: the profiles.phone column is not readable by any client
// (column-level grant, see migration_005). This route is the ONLY way a
// number crosses to the other side, and it:
//   1. authenticates the caller from their Supabase access token,
//   2. verifies they are a participant (customer or assigned driver),
//   3. only answers while the job is actually active (accepted / picked_up),
//      never before a driver accepts and never after delivery.
export async function GET(req: NextRequest) {
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const supabase = createSupabaseAdminClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const jobId = req.nextUrl.searchParams.get('jobId')
    if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })

    const { data: job } = await supabase
      .from('jobs')
      .select('id, status, buyer_id, driver_id, drivers(user_id)')
      .eq('id', jobId)
      .single()
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    if (job.status !== 'accepted' && job.status !== 'picked_up') {
      return NextResponse.json({ error: 'Calling is only available while a job is active' }, { status: 403 })
    }

    const driverUserId = (job.drivers as any)?.user_id
    let targetId: string | null = null
    if (user.id === job.buyer_id) targetId = driverUserId ?? null
    else if (user.id === driverUserId) targetId = job.buyer_id
    if (!targetId) return NextResponse.json({ error: 'Not a participant of this job' }, { status: 403 })

    const { data: profile } = await supabase
      .from('profiles').select('full_name, phone').eq('id', targetId).single()
    if (!profile?.phone) {
      return NextResponse.json({ error: 'No phone number on file — use the in-app chat instead' }, { status: 404 })
    }

    return NextResponse.json({ phone: profile.phone, name: profile.full_name })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
