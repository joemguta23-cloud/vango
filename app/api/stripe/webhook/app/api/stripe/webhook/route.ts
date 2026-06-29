import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createSupabaseAdminClient } from '@/lib/supabase'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
})

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
    if (jobId) {
      await supabase.from('jobs').update({ stripe_payment_intent_id: pi.id }).eq('id', jobId)
      await supabase.from('job_status_events').insert({
        job_id: jobId,
        status: 'payment_confirmed',
        note: `Payment of $${(pi.amount / 100).toFixed(2)} confirmed`,
      })
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
