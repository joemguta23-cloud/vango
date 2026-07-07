import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { calculatePrice, haversineKm, effectiveSize } from '@/lib/pricing'
import type { ItemSize } from '@/types'

// Driver re-rate at pickup ("this item is bigger than described").
//
// Deliberately a SERVER route (service role) rather than a client-side
// update: driver_fee must never be writable directly from the browser, or
// customers could lower their own fee. This route:
//   1. authenticates the caller from their Supabase access token,
//   2. verifies they are the ASSIGNED driver of this job,
//   3. only allows the size to move UP (never down),
//   4. recomputes the fee with the same pricing engine, priced at the job's
//      original posting time (so the time-of-day multiplier doesn't shift),
//   5. logs the change to job_status_events so the customer sees it on
//      their tracking page, with the old and new fee.
const SIZE_ORDER: ItemSize[] = ['small', 'medium', 'large', 'xlarge']
const SIZE_LABEL: Record<string, string> = { small: 'Small', medium: 'Medium', large: 'Large', xlarge: 'X-Large' }

export async function POST(req: NextRequest) {
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const supabase = createSupabaseAdminClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const { jobId, newSize } = await req.json()
    if (!jobId || !SIZE_ORDER.includes(newSize)) {
      return NextResponse.json({ error: 'Missing jobId or invalid size' }, { status: 400 })
    }

    const { data: job, error } = await supabase
      .from('jobs')
      .select('id, status, driver_id, buyer_id, items, item_type, item_size, driver_fee, extra_stops_fee, second_pickup_address, second_dropoff_address, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, created_at, original_driver_fee')
      .eq('id', jobId)
      .single()
    if (error || !job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    // Caller must be the assigned driver of this job.
    const { data: driver } = await supabase
      .from('drivers').select('id').eq('user_id', user.id).maybeSingle()
    if (!driver || job.driver_id !== driver.id) {
      return NextResponse.json({ error: 'Only the assigned driver can adjust this job' }, { status: 403 })
    }
    if (job.status !== 'accepted' && job.status !== 'picked_up') {
      return NextResponse.json({ error: 'This job can no longer be adjusted' }, { status: 400 })
    }

    // Size can only move UP from the current effective size (anti-abuse both
    // ways: the driver can correct under-declared items, but can't discount).
    const currentEff = effectiveSize(job.item_type, job.item_size as ItemSize)
    if (SIZE_ORDER.indexOf(newSize) <= SIZE_ORDER.indexOf(currentEff)) {
      return NextResponse.json({ error: 'The size can only be adjusted upward' }, { status: 400 })
    }

    // Recompute the fee with the main item re-rated, priced at the job's
    // original posting time so the time-of-day multiplier doesn't change.
    const items: any[] = Array.isArray(job.items) && job.items.length
      ? job.items
      : [{ item_type: job.item_type, item_size: job.item_size }]
    const priceItems = items.map((it: any, i: number) => ({
      // The main (largest/first) item takes the new size; extras unchanged.
      // effectiveSize() treats the catalogue size as a floor only, so an
      // upward re-rate is always honoured.
      size: (i === 0 ? newSize : it.item_size) as ItemSize,
      label: it.item_type,
      type: it.item_type,
    }))
    const km = haversineKm(Number(job.pickup_lat), Number(job.pickup_lng), Number(job.dropoff_lat), Number(job.dropoff_lng))
    const breakdown = calculatePrice(priceItems, km, {
      secondPickup: !!job.second_pickup_address,
      secondDropoff: !!job.second_dropoff_address,
    }, new Date(job.created_at))

    const oldFee = Number(job.driver_fee)
    const newFee = breakdown.driverFee
    if (newFee <= oldFee) {
      return NextResponse.json({ error: 'Adjustment would not increase the fee' }, { status: 400 })
    }

    const newItems = items.map((it: any, i: number) => i === 0 ? { ...it, item_size: newSize } : it)
    const { error: updErr } = await supabase.from('jobs').update({
      item_size: newSize,
      items: newItems,
      driver_fee: newFee,
      original_driver_fee: job.original_driver_fee ?? oldFee,
      price_adjusted_at: new Date().toISOString(),
    }).eq('id', jobId)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

    await supabase.from('job_status_events').insert({
      job_id: jobId,
      status: job.status,
      note: `Driver re-rated the item at pickup: ${SIZE_LABEL[currentEff]} → ${SIZE_LABEL[newSize]}. Cash fee updated $${oldFee} → $${newFee} (based on the item as seen in person).`,
    })

    return NextResponse.json({ ok: true, driverFee: newFee, oldFee })
  } catch (err: any) {
    console.error('adjust-price error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
