import { NextRequest, NextResponse } from 'next/server'
import { stripe, SERVICE_FEE_CENTS } from '@/lib/stripe'
import { createSupabaseAdminClient } from '@/lib/supabase'

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
      .select('id, service_fee, buyer_id')
      .eq('id', jobId)
      .single()

    if (error || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const feeCents = job.service_fee
      ? Math.round(Number(job.service_fee) * 100)
      : SERVICE_FEE_CENTS

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://getvango.com.au'

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
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
      ],
      metadata: { job_id: jobId },
      payment_intent_data: { metadata: { job_id: jobId } },
      success_url: `${appUrl}/buyer/tracking/${jobId}?paid=1`,
      cancel_url: `${appUrl}/buyer/tracking/${jobId}?paid=0`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    console.error('create-checkout-session error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
