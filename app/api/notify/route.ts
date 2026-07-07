import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { notifyUser } from '@/lib/notify'

// POST body: { jobId, event: 'accepted'|'picked_up'|'delivered'|'new_job' }
//
// SECURITY: requires a signed-in caller who is a participant of the job
// (the customer who posted it, or the assigned driver). This route uses the
// service role internally, so without this check anyone could spray push
// notifications at every online driver or at a job's customer.
export async function POST(req: NextRequest) {
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const supabase = createSupabaseAdminClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const { jobId, event } = await req.json()

    const { data: job } = await supabase
      .from('jobs')
      .select('id, buyer_id, driver_id, item_type, pickup_address, dropoff_address, drivers(user_id)')
      .eq('id', jobId)
      .single()

    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const driverUserId = (job.drivers as any)?.user_id

    // Caller must be this job's customer or its assigned driver.
    if (user.id !== job.buyer_id && user.id !== driverUserId) {
      return NextResponse.json({ error: 'Not a participant of this job' }, { status: 403 })
    }

    switch (event) {
      case 'accepted':
        if (job.buyer_id) await notifyUser(supabase, {
          userId: job.buyer_id,
          title: '🚐 Driver on the way!',
          body: `A driver has accepted your ${job.item_type} delivery. They\'re heading to pick it up now.`,
          url: `/buyer/tracking/${jobId}`,
        })
        break

      case 'picked_up':
        if (job.buyer_id) await notifyUser(supabase, {
          userId: job.buyer_id,
          title: '📦 Item picked up!',
          body: `Your ${job.item_type} has been picked up and is en route to ${job.dropoff_address}.`,
          url: `/buyer/tracking/${jobId}`,
        })
        break

      case 'delivered':
        if (job.buyer_id) await notifyUser(supabase, {
          userId: job.buyer_id,
          title: '🎉 Delivered!',
          body: `Your ${job.item_type} has been delivered successfully. Please rate your driver.`,
          url: `/buyer/tracking/${jobId}`,
        })
        break

      case 'new_job':
        // Only the customer who posted the job can trigger the driver blast.
        if (user.id !== job.buyer_id) {
          return NextResponse.json({ error: 'Only the job poster can send this' }, { status: 403 })
        }
        const { data: onlineDrivers } = await supabase
          .from('drivers').select('user_id').eq('is_online', true).eq('is_approved', true)
        for (const d of onlineDrivers || []) {
          await notifyUser(supabase, {
            userId: d.user_id,
            title: '📬 New job near you!',
            body: `${job.item_type} delivery — ${job.pickup_address} → ${job.dropoff_address}`,
            url: `/driver/dashboard`,
          })
        }
        break
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
