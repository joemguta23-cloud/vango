import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'

export async function POST(req: NextRequest) {
  try {
    const { accountId, driverId } = await req.json()
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL!
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${baseUrl}/driver/connect?retry=1`,
      return_url: `${baseUrl}/driver/connect/return?driver_id=${driverId}`,
      type: 'account_onboarding',
    })
    return NextResponse.json({ url: link.url })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
