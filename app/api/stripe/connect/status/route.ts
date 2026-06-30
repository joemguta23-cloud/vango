import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { createSupabaseAdminClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { driverId } = await req.json()
    const supabase = createSupabaseAdminClient()
    const { data: driver } = await supabase.from('drivers').select('stripe_account_id, stripe_onboarded').eq('id', driverId).single()
    if (!driver?.stripe_account_id) return NextResponse.json({ onboarded: false })
    if (driver.stripe_onboarded) return NextResponse.json({ onboarded: true })

    const account = await stripe.accounts.retrieve(driver.stripe_account_id)
    const onboarded = account.details_submitted && account.charges_enabled
    if (onboarded) await supabase.from('drivers').update({ stripe_onboarded: true }).eq('id', driverId)
    return NextResponse.json({ onboarded })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
