import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { createSupabaseAdminClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { driverId, email, fullName } = await req.json()
    if (!driverId || !email) return NextResponse.json({ error: 'driverId and email required' }, { status: 400 })
    const supabase = createSupabaseAdminClient()
    const { data: driver } = await supabase.from('drivers').select('stripe_account_id').eq('id', driverId).single()
    if (driver?.stripe_account_id) return NextResponse.json({ accountId: driver.stripe_account_id })

    const account = await stripe.accounts.create({
      type: 'express',
      country: 'AU',
      email,
      capabilities: { transfers: { requested: true } },
      business_type: 'individual',
      individual: {
        first_name: fullName?.split(' ')[0] || '',
        last_name: fullName?.split(' ').slice(1).join(' ') || '',
      },
      metadata: { driver_id: driverId },
    })
    await supabase.from('drivers').update({ stripe_account_id: account.id }).eq('id', driverId)
    return NextResponse.json({ accountId: account.id })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
