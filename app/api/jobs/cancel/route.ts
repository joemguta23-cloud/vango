import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { FEATURE_FLAGS, CANCELLATION_FEE_CENTS } from '@/lib/featureFlags'
import { haversineKm, distanceFeeForKm } from '@/lib/pricing'

// Lets a buyer cancel a job they posted, up until the item is picked up.
//
// SECURITY: the caller must be signed in AND be the buyer who posted this
// job. This route uses the service role internally, so without this check
// anyone who knew a job id could cancel someone else's job.
//
// Fee rules:
//   - unpaid / pending (no driver yet)  -> FREE to cancel.
//   - accepted (driver already on it)   -> cancellation fee = the job's
//     DISTANCE CHARGE (per-km component, distanceFeeForKm over the pickup->
//     dropoff distance, floored at $2) to reimburse the driver for their
//     time. Recorded on the job (cancellation_fee / cancellation_fee_owed)
//     and folded into the buyer's NEXT job's Stripe Checkout (see
//     app/api/stripe/create-checkout-session/route.ts); marked charged once
//     that payment succeeds (see app/api/stripe/webhook/route.ts).
//   - picked_up or later                -> can no longer be cancelled.
//
// Promo codes: a code is consumed when a job ACTIVATES. If this job had a
// consumed code, cancelling restores it (uses_count going back down and the
// code re-activating) so the customer can use it again -- the transaction
// never actually went through.
export async function POST(req: NextRequest) {
  if (!FEATURE_FLAGS.CANCELLATION_ENABLED) {
    return NextResponse.json({ error: 'Cancellation is not currently available' }, { status: 403 })
  }

  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const supabase = createSupabaseAdminClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const { jobId } = await req.json()
    if (!jobId) {
      return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })
    }

    const { data: job, error } = await supabase
      .from('jobs')
      .select('id, status, buyer_id, discount_code_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng')
      .eq('id', jobId)
      .single()

    if (error || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    if (job.buyer_id !== user.id) {
      return NextResponse.json({ error: 'Only the customer who posted this job can cancel it' }, { status: 403 })
    }
    if (job.status === 'picked_up') {
      return NextResponse.json({ error: 'This job can no longer be cancelled — the item has already been picked up' }, { status: 400 })
    }
    if (!['unpaid', 'pending', 'accepted'].includes(job.status)) {
      return NextResponse.json({ error: 'This job can no longer be cancelled' }, { status: 400 })
    }

    // After-acceptance fee: the distance charge for this trip (driver
    // reimbursement), floored at CANCELLATION_FEE_CENTS.
    const feeOwed = job.status === 'accepted'
    let feeDollars = 0
    if (feeOwed) {
      const haveCoords = [job.pickup_lat, job.pickup_lng, job.dropoff_lat, job.dropoff_lng]
        .every(v => Number.isFinite(Number(v)))
      const km = haveCoords
        ? haversineKm(Number(job.pickup_lat), Number(job.pickup_lng), Number(job.dropoff_lat), Number(job.dropoff_lng))
        : 0
      feeDollars = Math.max(CANCELLATION_FEE_CENTS / 100, distanceFeeForKm(km))
    }

    await supabase.from('jobs').update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: job.buyer_id,
      cancellation_stage: feeOwed ? 'after_accept' : 'before_accept',
      cancellation_fee: feeDollars,
      cancellation_fee_owed: feeOwed,
      cancellation_fee_charged: false,
    }).eq('id', jobId)

    // Restore a consumed promo code. Codes are consumed at ACTIVATION, so an
    // 'unpaid' job never consumed one -- only restore for pending/accepted.
    if (job.discount_code_id && (job.status === 'pending' || job.status === 'accepted')) {
      const { data: dc } = await supabase
        .from('discount_codes')
        .select('id, uses_count, max_uses')
        .eq('id', job.discount_code_id)
        .single()
      if (dc) {
        const newCount = Math.max(0, (dc.uses_count ?? 0) - 1)
        await supabase.from('discount_codes').update({
          uses_count: newCount,
          // Re-activate: the freed use makes it valid again (single-use codes
          // that were exhausted come back to life).
          active: dc.max_uses == null || newCount < dc.max_uses ? true : false,
        }).eq('id', dc.id)
      }
    }

    await supabase.from('job_status_events').insert({
      job_id: jobId,
      status: 'cancelled',
      note: feeOwed
        ? `Cancelled by customer after driver acceptance — a $${feeDollars.toFixed(2)} cancellation fee (this trip's distance charge, reimbursing the driver) will be added to your next job's checkout`
        : 'Cancelled by customer before driver acceptance — no fee',
    })

    return NextResponse.json({ ok: true, feeOwed, fee: feeDollars })
  } catch (err: any) {
    console.error('cancel job error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
