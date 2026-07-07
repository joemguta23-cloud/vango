import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { FEATURE_FLAGS } from '@/lib/featureFlags'

// Lets a buyer cancel a job they posted. Disabled in production until
// FEATURE_FLAGS.CANCELLATION_ENABLED is flipped on -- see lib/featureFlags.ts.
//
// SECURITY: the caller must be signed in AND be the buyer who posted this
// job. This route uses the service role internally, so without this check
// anyone who knew a job id could cancel someone else's job.
//
// Free to cancel while the job is still 'pending' (no driver has accepted
// yet). Once a driver has accepted (or later), cancelling sets
// cancellation_fee_owed = true; the $2 fee is added to the buyer's next
// completed job's Stripe Checkout session (see
// app/api/stripe/create-checkout-session/route.ts) and marked as charged
// once that payment succeeds (see app/api/stripe/webhook/route.ts).
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
      .select('id, status, buyer_id')
      .eq('id', jobId)
      .single()

    if (error || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    if (job.buyer_id !== user.id) {
      return NextResponse.json({ error: 'Only the customer who posted this job can cancel it' }, { status: 403 })
    }
    if (job.status === 'delivered' || job.status === 'cancelled') {
      return NextResponse.json({ error: 'This job can no longer be cancelled' }, { status: 400 })
    }

    const feeOwed = job.status !== 'pending' // a driver has already accepted

    await supabase.from('jobs').update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: job.buyer_id,
      cancellation_fee_owed: feeOwed,
      cancellation_fee_charged: false,
    }).eq('id', jobId)

    await supabase.from('job_status_events').insert({
      job_id: jobId,
      status: 'cancelled',
      note: feeOwed
        ? 'Cancelled by customer after driver acceptance -- a $2 fee will be added to your next completed job'
        : 'Cancelled by customer before driver acceptance -- no fee',
    })

    return NextResponse.json({ ok: true, feeOwed })
  } catch (err: any) {
    console.error('cancel job error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
