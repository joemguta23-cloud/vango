import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { notifyUser } from '@/lib/notify'

// POST body: { jobId, event: 'accepted'|'picked_up'|'delivered'|'new_job' }
export async function POST(req: NextRequest) {
  try {
    const { jobId, event } = await req.json()
    const supabase = createSupabaseAdminClient()

    const { data: job } = await supabase
      .from('jobs')
      .select('id, buyer_id, driver_id, item_type, pickup_address, dropoff_address, drivers(user_id)')
      .eq('id', jobId)
      .single()

    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const driverUserId = (job.drivers as any)?.user_id

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
        // Notify all online drivers — find them
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
