import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { notifyUser } from '@/lib/notify'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')
  if (!sig) return NextResponse.json({ error: 'No signature' }, { status: 400 })

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  }

  const supabase = createSupabaseAdminClient()

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent
    const jobId = pi.metadata?.job_id
    if (!jobId) return NextResponse.json({ received: true })

    // Fetch job + driver details
    const { data: job } = await supabase
      .from('jobs')
      .select('id, driver_id, buyer_id, driver_fee, discount_code_id, drivers(stripe_account_id, stripe_onboarded)')
      .eq('id', jobId)
      .single()

    if (job) {
      // Update job with payment intent ID
      await supabase.from('jobs').update({ stripe_payment_intent_id: pi.id }).eq('id', jobId)
      await supabase.from('job_status_events').insert({
        job_id: jobId,
        status: 'payment_confirmed',
        note: `Payment of $${(pi.amount / 100).toFixed(2)} confirmed`,
      })

      // Feature-flagged cancellation policy: this payment included any
      // outstanding $2 cancellation fees (see create-checkout-session/route.ts)
      // -- mark those cancelled jobs as charged now that payment succeeded.
      const owedJobIds = (pi.metadata?.owed_job_ids || '').split(',').filter(Boolean)
      if (owedJobIds.length) {
        await supabase.from('jobs').update({ cancellation_fee_charged: true }).in('id', owedJobIds)
      }

      // Feature-flagged discount codes: count this use now that payment
      // (or the no-charge full-waiver path) has actually gone through.
      if (job.discount_code_id) {
        const { data: dc } = await supabase
          .from('discount_codes')
          .select('uses_count')
          .eq('id', job.discount_code_id)
          .single()
        if (dc) {
          await supabase.from('discount_codes').update({ uses_count: dc.uses_count + 1 }).eq('id', job.discount_code_id)
        }
      }

      // Auto-transfer driver fee if driver has Connect account
      const driver = Array.isArray(job.drivers) ? job.drivers[0] : job.drivers as any
      if (driver?.stripe_account_id && driver?.stripe_onboarded) {
        const driverFeeCents = Math.round(Number(job.driver_fee) * 100)
        try {
          await stripe.transfers.create({
            amount: driverFeeCents,
            currency: 'aud',
            destination: driver.stripe_account_id,
            transfer_group: jobId,
            metadata: { job_id: jobId },
          })
        } catch (transferErr: any) {
          console.error('Transfer failed:', transferErr.message)
        }
      }

      // Notify buyer
      if (job.buyer_id) {
        await notifyUser(supabase, {
          userId: job.buyer_id,
          title: '✅ Payment confirmed',
          body: `Your payment of $${(pi.amount / 100).toFixed(2)} was received. Job is on its way!`,
          url: `/buyer/tracking/${jobId}`,
        })
      }
    }
  }

  if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object as Stripe.PaymentIntent
    const jobId = pi.metadata?.job_id
    if (jobId) {
      await supabase.from('job_status_events').insert({
        job_id: jobId,
        status: 'payment_failed',
        note: pi.last_payment_error?.message || 'Payment failed',
      })
    }
  }

  return NextResponse.json({ received: true })
}
