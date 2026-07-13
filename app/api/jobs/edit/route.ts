import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { calculatePrice, effectiveSize, haversineKm, kmToZone, MAX_QUOTED_KM } from '@/lib/pricing'
import { notifyUser } from '@/lib/notify'
import type { ItemSize } from '@/types'

// Buyer edits a job they posted (Uber-style rules):
//
//   unpaid / pending (no driver yet)
//       -> changes apply IMMEDIATELY and the price is recalculated from the
//          new details (size, distance, stops...). The job stays in the same
//          status; nothing extra to pay via Stripe because the flat service
//          fee doesn't change — only the driver's cash fee is repriced.
//
//   accepted (a driver is already on this job)
//       -> changes are NOT applied live. They're stored on the job as a
//          CHANGE REQUEST (jobs.pending_changes) that the assigned driver
//          must review and explicitly Accept before they take effect — the
//          driver may already be en route to the ORIGINAL address. The
//          driver is notified urgently (SMS / email / push + in-app) and
//          re-reminded on a schedule until they respond (see
//          app/api/cron/change-reminders). The driver can also DECLINE and
//          release the job back to the pool penalty-free (see
//          app/api/jobs/respond-change).
//
//   picked_up or later -> the job can no longer be edited.
//
// SECURITY: caller must be signed in AND be the buyer who posted the job.
// All size floors are re-enforced server-side (a fridge can never be priced
// below Medium no matter what the client sends).

const VALID_SIZES: ItemSize[] = ['small', 'medium', 'large', 'xlarge']
const SIZE_LABEL: Record<string, string> = { small: 'Small', medium: 'Medium', large: 'Large', xlarge: 'X-Large' }

const money = (n: number | string) => {
  const v = Math.round(Number(n) * 100) / 100
  return Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2)
}

const itemsLabel = (items: any[]) =>
  (items ?? []).map((i: any) => `${i.item_type} (${SIZE_LABEL[i.item_size] ?? i.item_size})`).join(' + ')

const num = (v: any): number | null => (Number.isFinite(Number(v)) ? Number(v) : null)

export async function POST(req: NextRequest) {
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const supabase = createSupabaseAdminClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const { jobId, changes } = await req.json()
    if (!jobId || !changes) return NextResponse.json({ error: 'Missing jobId or changes' }, { status: 400 })

    const { data: job, error } = await supabase.from('jobs').select('*').eq('id', jobId).single()
    if (error || !job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    if (job.buyer_id !== user.id) {
      return NextResponse.json({ error: 'Only the customer who posted this job can edit it' }, { status: 403 })
    }
    if (job.status === 'picked_up' || job.status === 'delivered') {
      return NextResponse.json({ error: 'This job can no longer be edited — the item has already been picked up' }, { status: 400 })
    }
    if (!['unpaid', 'pending', 'accepted'].includes(job.status)) {
      return NextResponse.json({ error: 'This job can no longer be edited' }, { status: 400 })
    }

    // ── Validate + normalise the incoming details ─────────────────────────
    const rawItems: any[] = Array.isArray(changes.items) ? changes.items : []
    if (rawItems.length === 0) return NextResponse.json({ error: 'The job needs at least one item' }, { status: 400 })
    const items = rawItems.map((it: any) => {
      const type = String(it.item_type ?? '').trim()
      const requested: ItemSize = VALID_SIZES.includes(it.item_size) ? it.item_size : 'medium'
      return {
        item_type: type,
        // HARD GUARDRAIL: floor every size at the catalogue minimum
        // (fridge never below Medium; nothing sneaks into the free tier).
        item_size: effectiveSize(type, requested),
        description: String(it.description ?? '').trim(),
        photo_url: it.photo_url ?? null,
      }
    })
    for (const it of items) {
      if (!it.item_type) return NextResponse.json({ error: 'Every item needs a type' }, { status: 400 })
      if (!it.description) return NextResponse.json({ error: 'Every item needs a description' }, { status: 400 })
    }

    const pickup_address = String(changes.pickup_address ?? '').trim()
    const dropoff_address = String(changes.dropoff_address ?? '').trim()
    if (!pickup_address || !dropoff_address) {
      return NextResponse.json({ error: 'Pickup and dropoff addresses are required' }, { status: 400 })
    }
    const pickup_lat = num(changes.pickup_lat), pickup_lng = num(changes.pickup_lng)
    const dropoff_lat = num(changes.dropoff_lat), dropoff_lng = num(changes.dropoff_lng)
    if (pickup_lat == null || pickup_lng == null || dropoff_lat == null || dropoff_lng == null) {
      return NextResponse.json({ error: 'Please pick the addresses from the suggestion list so the distance can be calculated accurately' }, { status: 400 })
    }

    const second_pickup_address = String(changes.second_pickup_address ?? '').trim() || null
    const second_dropoff_address = String(changes.second_dropoff_address ?? '').trim() || null

    // ── Recalculate the price from the NEW details ────────────────────────
    const km = haversineKm(pickup_lat, pickup_lng, dropoff_lat, dropoff_lng)
    if (km > MAX_QUOTED_KM) {
      return NextResponse.json({ error: 'The new addresses are over 150 km apart — that needs a custom quote. Contact us instead.' }, { status: 400 })
    }
    const price = calculatePrice(
      items.map(i => ({ size: i.item_size, label: i.item_type, type: i.item_type })),
      km,
      { secondPickup: !!second_pickup_address, secondDropoff: !!second_dropoff_address }
    )

    const first = items[0]
    const newFields: Record<string, any> = {
      items,
      item_type: first.item_type,
      item_size: first.item_size,
      item_description: first.description,
      photo_url: first.photo_url,
      pickup_address, pickup_lat, pickup_lng,
      dropoff_address, dropoff_lat, dropoff_lng,
      second_pickup_address,
      second_pickup_lat: second_pickup_address ? (num(changes.second_pickup_lat) ?? pickup_lat) : null,
      second_pickup_lng: second_pickup_address ? (num(changes.second_pickup_lng) ?? pickup_lng) : null,
      second_dropoff_address,
      second_dropoff_lat: second_dropoff_address ? (num(changes.second_dropoff_lat) ?? dropoff_lat) : null,
      second_dropoff_lng: second_dropoff_address ? (num(changes.second_dropoff_lng) ?? dropoff_lng) : null,
      extra_stops_fee: price.extraStopsFee,
      distance_zone: kmToZone(km),
      scheduled_for: changes.scheduled_for || null,
      helper_at_pickup: !!changes.helper_at_pickup,
      helper_at_dropoff: !!changes.helper_at_dropoff,
      helper_note: String(changes.helper_note ?? '').trim() || null,
      driver_fee: price.driverFee,
      // A buyer edit resets the pricing baseline (any earlier driver re-rate
      // was for the OLD details).
      original_driver_fee: null,
    }

    // ── Human-readable old → new diff (shown to the driver + in the log) ──
    const summary: string[] = []
    if (job.pickup_address !== pickup_address) summary.push(`Pickup: "${job.pickup_address}" → "${pickup_address}"`)
    if (job.dropoff_address !== dropoff_address) summary.push(`Dropoff: "${job.dropoff_address}" → "${dropoff_address}"`)
    if ((job.second_pickup_address ?? null) !== second_pickup_address) {
      summary.push(second_pickup_address ? `2nd pickup: now "${second_pickup_address}"` : '2nd pickup removed')
    }
    if ((job.second_dropoff_address ?? null) !== second_dropoff_address) {
      summary.push(second_dropoff_address ? `2nd dropoff: now "${second_dropoff_address}"` : '2nd dropoff removed')
    }
    const oldItems = Array.isArray(job.items) && job.items.length
      ? job.items
      : [{ item_type: job.item_type, item_size: job.item_size }]
    if (itemsLabel(oldItems) !== itemsLabel(items)) {
      summary.push(`Items: ${itemsLabel(oldItems)} → ${itemsLabel(items)}`)
    } else if (JSON.stringify(oldItems.map((i: any) => i.description)) !== JSON.stringify(items.map(i => i.description))) {
      summary.push('Item description updated')
    }
    if ((job.scheduled_for ?? null) !== (newFields.scheduled_for ?? null)) {
      summary.push(newFields.scheduled_for ? 'Schedule changed — check the new pickup time on the job' : 'Schedule changed to ASAP')
    }
    if (Number(job.driver_fee) !== price.driverFee) {
      summary.push(`Cash fee on delivery: $${money(job.driver_fee)} → $${money(price.driverFee)}`)
    }
    if (!!job.helper_at_pickup !== newFields.helper_at_pickup || !!job.helper_at_dropoff !== newFields.helper_at_dropoff) {
      summary.push('Helper arrangements updated')
    } else if ((job.helper_note ?? null) !== newFields.helper_note) {
      summary.push('Notes for the driver updated')
    }

    if (summary.length === 0) {
      // Nothing actually changed — don't bother the driver or rewrite the row.
      return NextResponse.json({ ok: true, applied: true, unchanged: true, driverFee: price.driverFee })
    }

    // ── No driver yet: apply immediately ──────────────────────────────────
    if (job.status === 'unpaid' || job.status === 'pending') {
      const { error: updErr } = await supabase.from('jobs').update(newFields).eq('id', jobId)
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
      await supabase.from('job_status_events').insert({
        job_id: jobId,
        status: job.status,
        note: `Details updated by customer — ${summary.join('; ')}`,
      })
      return NextResponse.json({ ok: true, applied: true, driverFee: price.driverFee })
    }

    // ── Driver already on it: save as a CHANGE REQUEST needing approval ───
    const requested_at = new Date().toISOString()
    const { error: reqErr } = await supabase.from('jobs').update({
      pending_changes: { fields: newFields, summary, requested_at },
      change_requested_at: requested_at,
      change_reminded_at: null, // reset the reminder clock for the new request
    }).eq('id', jobId)
    if (reqErr) return NextResponse.json({ error: reqErr.message }, { status: 500 })

    await supabase.from('job_status_events').insert({
      job_id: jobId,
      status: 'accepted',
      note: `Customer requested changes (awaiting driver approval) — ${summary.join('; ')}`,
    })

    // Urgent driver notification: they could be driving to the WRONG address
    // right now. In-app + SMS + email + push, then repeated reminders via
    // the change-reminders cron until they Accept or Decline.
    const { data: drv } = await supabase.from('drivers').select('user_id').eq('id', job.driver_id).single()
    if (drv?.user_id) {
      await supabase.from('notifications').insert({
        user_id: drv.user_id,
        job_id: jobId,
        type: 'job_changed',
        title: '🚨 URGENT: the customer changed this job',
        body: `${summary.join('; ')}. Open the job to review — Accept the changes or Decline to release the job (no penalty).`,
      })
      await notifyUser(supabase, {
        userId: drv.user_id,
        title: '🚨 URGENT: job details changed',
        body: `Your Vanute job "${first.item_type}" was changed by the customer: ${summary.join('; ')}. You may be heading to the wrong place — open the job now to Accept or Decline the changes.`,
        url: `/driver/job/${jobId}`,
      })
    }

    return NextResponse.json({ ok: true, applied: false, pendingApproval: true, driverFee: price.driverFee })
  } catch (err: any) {
    console.error('edit job error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
