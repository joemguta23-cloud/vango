import { NextRequest, NextResponse } from 'next/server'
import { stripe, SERVICE_FEE_CENTS } from '@/lib/stripe'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { FEATURE_FLAGS, CANCELLATION_FEE_CENTS } from '@/lib/featureFlags'

// Creates a Stripe Checkout Session for the $12 VanGo service fee.
// Card, Apple Pay and Google Pay are surfaced automatically based on what
// is enabled in the Stripe Dashboard payment method settings -- we deliberately
// do not hardcode payment_method_types so new wallets can be turned on later
// without a code change. The driver's cash fee is NOT charged here; only the
// service fee flows through Stripe (driver is paid cash on delivery).
export async function POST(req: NextRequest) {
  try {
    const { jobId } = await req.json()
    if (!jobId) {
      return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })
    }

    const supabase = createSupabaseAdminClient()
    const { data: job, error } = await supabase
      .from('jobs')
      .select('id, service_fee, buyer_id, discount_code_id')
      .eq('id', jobId)
      .single()

    if (error || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    let feeCents = job.service_fee
      ? Math.round(Number(job.service_fee) * 100)
      : SERVICE_FEE_CENTS

    // Feature-flagged: apply a promo code stored on this job (see
    // lib/featureFlags.ts and app/api/discount-codes/validate/route.ts).
    if (FEATURE_FLAGS.DISCOUNT_CODES_ENABLED && job.discount_code_id) {
      const { data: dc } = await supabase
        .from('discount_codes')
        .select('*')
        .eq('id', job.discount_code_id)
        .single()
      if (dc && dc.active) {
        if (dc.waive_service_fee) {
          feeCents = 0
        } else if (dc.percent_off) {
          feeCents = Math.round(feeCents * (1 - dc.percent_off / 100))
        }
      }
    }

    // Feature-flagged: fold in any unpaid $2 cancellation fees from jobs this
    // buyer cancelled after a driver had already accepted (see
    // app/api/jobs/cancel/route.ts). Cleared to "charged" in the webhook once
    // this payment succeeds.
    let cancellationFeeCents = 0
    let owedJobIds: string[] = []
    if (FEATURE_FLAGS.CANCELLATION_ENABLED && job.buyer_id) {
      const { data: owedJobs } = await supabase
        .from('jobs')
        .select('id')
        .eq('buyer_id', job.buyer_id)
        .eq('cancellation_fee_owed', true)
        .eq('cancellation_fee_charged', false)
      if (owedJobs && owedJobs.length) {
        owedJobIds = owedJobs.map((j) => j.id)
        cancellationFeeCents = CANCELLATION_FEE_CENTS * owedJobs.length
      }
    }

    const totalCents = feeCents + cancellationFeeCents
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://getvango.com.au'

    // Nothing to charge (e.g. a full-waiver promo code and no outstanding
    // cancellation fees) -- skip Stripe entirely rather than create a
    // zero-dollar Checkout Session, which Stripe doesn't support.
    if (totalCents <= 0) {
      await supabase.from('job_status_events').insert({
        job_id: jobId,
        status: 'payment_confirmed',
        note: 'No charge -- service fee fully covered by promo code',
      })
      return NextResponse.json({ url: `${appUrl}/buyer/tracking/${jobId}?paid=1` })
    }

    const lineItems = [
      {
        price_data: {
          currency: 'aud',
          product_data: {
            name: 'VanGo service fee',
            description: 'Booking & matching fee -- driver fee is paid cash on delivery',
          },
          unit_amount: feeCents,
        },
        quantity: 1,
      },
    ]

    if (cancellationFeeCents > 0) {
      lineItems.push({
        price_data: {
          currency: 'aud',
          product_data: {
            name: 'Previous cancellation fee',
            description: 'From a job cancelled after a driver had already accepted',
          },
          unit_amount: cancellationFeeCents,
        },
        quantity: 1,
      })
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      metadata: { job_id: jobId, owed_job_ids: owedJobIds.join(',') },
      payment_intent_data: { metadata: { job_id: jobId, owed_job_ids: owedJobIds.join(',') } },
      success_url: `${appUrl}/buyer/tracking/${jobId}?paid=1`,
      cancel_url: `${appUrl}/buyer/tracking/${jobId}?paid=0`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    console.error('create-checkout-session error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
