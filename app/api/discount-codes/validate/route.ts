import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { FEATURE_FLAGS } from '@/lib/featureFlags'

// Validates a promo code entered at job-posting time. Disabled in production
// until FEATURE_FLAGS.DISCOUNT_CODES_ENABLED is flipped on -- see
// lib/featureFlags.ts. The discount_codes table has RLS enabled with no
// client-facing policies, so this server-side (service-role) lookup is the
// only way to read it -- codes can never be enumerated from the browser.
export async function POST(req: NextRequest) {
  if (!FEATURE_FLAGS.DISCOUNT_CODES_ENABLED) {
    return NextResponse.json({ valid: false, error: 'Promo codes are not currently available' }, { status: 403 })
  }

  try {
    const { code } = await req.json()
    if (!code || typeof code !== 'string') {
      return NextResponse.json({ valid: false, error: 'Missing code' }, { status: 400 })
    }

    const supabase = createSupabaseAdminClient()
    const { data: dc } = await supabase
      .from('discount_codes')
      .select('*')
      .ilike('code', code.trim())
      .eq('active', true)
      .maybeSingle()

    if (!dc) {
      return NextResponse.json({ valid: false, error: 'Invalid promo code' })
    }
    if (dc.expires_at && new Date(dc.expires_at) < new Date()) {
      return NextResponse.json({ valid: false, error: 'This promo code has expired' })
    }
    if (dc.max_uses != null && dc.uses_count >= dc.max_uses) {
      return NextResponse.json({ valid: false, error: 'This promo code has reached its usage limit' })
    }

    return NextResponse.json({
      valid: true,
      id: dc.id,
      percentOff: dc.percent_off,
      waiveServiceFee: dc.waive_service_fee,
    })
  } catch (err: any) {
    console.error('validate discount code error:', err.message)
    return NextResponse.json({ valid: false, error: err.message }, { status: 500 })
  }
}
