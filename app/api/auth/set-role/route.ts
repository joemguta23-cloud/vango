import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase'

// Lets a signed-in user set their OWN role to 'buyer' or 'driver' (never
// 'admin'). Used by /auth/callback when someone signs up with a social account
// after choosing the driver toggle -- clients can't write profiles.role
// directly (revoked in migration_005), so this runs with the service role
// after verifying the caller's access token.
export async function POST(req: NextRequest) {
  try {
    const { accessToken, role } = await req.json()
    if (!accessToken || (role !== 'buyer' && role !== 'driver')) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 })
    }

    // Verify the caller using their own access token.
    const authClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data: userData, error: userErr } = await authClient.auth.getUser(accessToken)
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const uid = userData.user.id

    const admin = createSupabaseAdminClient()
    // Never change an admin account's role.
    const { data: prof } = await admin.from('profiles').select('role').eq('id', uid).single()
    if (prof?.role === 'admin') {
      return NextResponse.json({ ok: true, role: 'admin' })
    }
    await admin.from('profiles').update({ role }).eq('id', uid)
    return NextResponse.json({ ok: true, role })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
