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

    const { data: job } = await supabase
      .from('jobs')
      .select('id, status, driver_id, buyer_id, driver_fee, discount_code_id')
      .eq('id', jobId)
      .single()

    if (job) {
      // PAYMENT HARD-STOP: this successful payment is what makes the job
      // visible to drivers. Flip 'unpaid' (or an 'expired' one the buyer paid
      // for anyway) to 'pending' with a fresh 24h visibility window.
      const activating = job.status === 'unpaid' || job.status === 'expired'
      if (activating) {
        await supabase.from('jobs').update({
          status: 'pending',
          service_fee_paid: true,
          created_at: new Date().toISOString(),
          stripe_payment_intent_id: pi.id,
        }).eq('id', jobId)
        await supabase.from('job_status_events').insert({
          job_id: jobId,
          status: 'pending',
          note: 'Service fee paid — job is live, finding driver',
        })
      } else {
        await supabase.from('jobs').update({
          service_fee_paid: true,
          stripe_payment_intent_id: pi.id,
        }).eq('id', jobId)
      }

      await supabase.from('job_status_events').insert({
        job_id: jobId,
        status: 'payment_confirmed',
        note: `Payment of $${(pi.amount / 100).toFixed(2)} confirmed`,
      })

      // Cancellation policy: this payment included any outstanding km-based
      // cancellation fees (see create-checkout-session/route.ts) -- mark
      // those cancelled jobs as charged now that payment succeeded.
      const owedJobIds = (pi.metadata?.owed_job_ids || '').split(',').filter(Boolean)
      if (owedJobIds.length) {
        await supabase.from('jobs').update({ cancellation_fee_charged: true }).in('id', owedJobIds)
      }

      // Promo codes are CONSUMED here, when payment actually succeeds (a $0
      // full-waiver activation consumes in create-checkout-session instead).
      // Single-use codes deactivate the moment they hit their cap; cancelling
      // the job later restores them (see app/api/jobs/cancel/route.ts).
      if (job.discount_code_id) {
        const { data: dc } = await supabase
          .from('discount_codes')
          .select('id, uses_count, max_uses, active')
          .eq('id', job.discount_code_id)
          .single()
        if (dc) {
          const newCount = (dc.uses_count ?? 0) + 1
          const exhausted = dc.max_uses != null && newCount >= dc.max_uses
          await supabase.from('discount_codes').update({
            uses_count: newCount,
            active: exhausted ? false : dc.active,
          }).eq('id', dc.id)
        }
      }

      // NOTE (removed): this webhook previously auto-created a Stripe
      // transfer of the full driver_fee to the driver's Connect account on
      // every successful service-fee payment. That double-paid drivers (they
      // already collect the fee in cash/PayID on delivery) and drained the
      // platform balance -- the buyer only ever pays the ~$12 service fee by
      // card. If card-paid driver fees are introduced later, re-add a
      // transfer that is funded by an actual charge for that amount.

      // Notify buyer
      if (job.buyer_id) {
        await notifyUser(supabase, {
          userId: job.buyer_id,
          title: '✅ Payment confirmed',
          body: `Your payment of $${(pi.amount / 100).toFixed(2)} was received. Your job is now live and we're finding a driver!`,
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
