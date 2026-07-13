import { NextRequest, NextResponse } from 'next/server'
import { stripe, SERVICE_FEE_CENTS } from '@/lib/stripe'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { FEATURE_FLAGS } from '@/lib/featureFlags'

// Creates a Stripe Checkout Session for the Vanute service fee.
//
// PAYMENT HARD-STOP: jobs are created with status 'unpaid' and are NOT
// visible to drivers. They only go live ('pending') when either
//   (a) the Stripe payment succeeds (see app/api/stripe/webhook/route.ts), or
//   (b) a promo code fully waives the fee -- the $0 path below activates the
//       job immediately and consumes the code.
// A promo code is only CONSUMED at activation, so an abandoned checkout
// never burns a code, and cancelling a job restores its code (see
// app/api/jobs/cancel/route.ts).
//
// Card, Apple Pay and Google Pay are surfaced automatically based on what
// is enabled in the Stripe Dashboard payment method settings. The driver's
// cash / PayID fee is NOT charged here; only the service fee flows through
// Stripe.
export async function POST(req: NextRequest) {
  try {
    const { jobId } = await req.json()
    if (!jobId) {
      return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })
    }

    const supabase = createSupabaseAdminClient()
    const { data: job, error } = await supabase
      .from('jobs')
      .select('id, status, service_fee, buyer_id, discount_code_id')
      .eq('id', jobId)
      .single()

    if (error || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    let feeCents = job.service_fee
      ? Math.round(Number(job.service_fee) * 100)
      : SERVICE_FEE_CENTS

    // Promo code applied to this job. Re-validate now -- the code could have
    // expired or been used up between applying it and reaching checkout.
    // IMPORTANT: the code is NOT consumed here for card payments; it is
    // consumed by the webhook once payment actually succeeds.
    let dcValid: any = null
    if (FEATURE_FLAGS.DISCOUNT_CODES_ENABLED && job.discount_code_id) {
      const { data: dc } = await supabase
        .from('discount_codes')
        .select('*')
        .eq('id', job.discount_code_id)
        .single()

      const stillValid = dc && dc.active
        && (!dc.expires_at || new Date(dc.expires_at) >= new Date())
        && (dc.max_uses == null || (dc.uses_count ?? 0) < dc.max_uses)

      if (stillValid) {
        dcValid = dc
        if (dc.waive_service_fee) {
          feeCents = 0
        } else if (dc.percent_off) {
          feeCents = Math.round(feeCents * (1 - dc.percent_off / 100))
        }
      }
    }

    // Outstanding cancellation fees from jobs this buyer cancelled after a
    // driver had already accepted (km-based driver reimbursement, see
    // app/api/jobs/cancel/route.ts). Folded into this checkout and cleared
    // to "charged" in the webhook once payment succeeds.
    let cancellationFeeCents = 0
    let owedJobIds: string[] = []
    if (FEATURE_FLAGS.CANCELLATION_ENABLED && job.buyer_id) {
      const { data: owedJobs } = await supabase
        .from('jobs')
        .select('id, cancellation_fee')
        .eq('buyer_id', job.buyer_id)
        .eq('cancellation_fee_owed', true)
        .eq('cancellation_fee_charged', false)
      if (owedJobs && owedJobs.length) {
        owedJobIds = owedJobs.map((j) => j.id)
        cancellationFeeCents = owedJobs.reduce((sum, j) => sum + Math.round(Number(j.cancellation_fee || 0) * 100), 0)
      }
    }

    const totalCents = feeCents + cancellationFeeCents
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.vanute.com.au'

    // Nothing to charge (full-waiver promo code and no outstanding
    // cancellation fees): ACTIVATE the job right now -- this is the only
    // no-payment path to a live job -- and consume the code.
    if (totalCents <= 0) {
      await supabase.from('jobs').update({
        status: 'pending',
        service_fee_paid: true,
        created_at: new Date().toISOString(), // fresh 24h visibility window
      }).eq('id', jobId).in('status', ['unpaid', 'expired'])

      if (dcValid) {
        const newCount = (dcValid.uses_count ?? 0) + 1
        const exhausted = dcValid.max_uses != null && newCount >= dcValid.max_uses
        await supabase
          .from('discount_codes')
          .update({ uses_count: newCount, active: exhausted ? false : dcValid.active })
          .eq('id', dcValid.id)
      }

      await supabase.from('job_status_events').insert({
        job_id: jobId,
        status: 'payment_confirmed',
        note: 'No charge -- service fee fully covered by promo code. Job is live, finding driver.',
      })
      return NextResponse.json({ url: `${appUrl}/buyer/tracking/${jobId}?paid=1` })
    }

    const lineItems = [
      {
        price_data: {
          currency: 'aud',
          product_data: {
            name: 'Vanute service fee',
            description: 'Booking & matching fee -- driver fee is paid cash / PayID on delivery',
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
            name: 'Cancellation fee (driver reimbursement)',
            description: 'Distance charge from a previous job cancelled after a driver had accepted',
          },
          unit_amount: cancellationFeeCents,
        },
        quantity: 1,
      })
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
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
