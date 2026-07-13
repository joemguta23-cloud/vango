import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { notifyUser } from '@/lib/notify'

// The assigned driver responds to a customer's pending change request
// (jobs.pending_changes, written by app/api/jobs/edit when the buyer edits
// a job that is already ACCEPTED).
//
//   action 'accept'  -> the new details are applied to the job and it stays
//                       assigned to this driver.
//   action 'decline' -> penalty-free opt-out. The buyer's new details still
//                       stand (that's what they now want delivered), but the
//                       job is RELEASED back into the live pool (status
//                       'pending', no driver) for another driver to accept.
//                       No cancellation fee for anyone — the deal changed
//                       AFTER the driver accepted, so walking away is free.
//                       The re-listed job gets a fresh 24-hour live window.
//
// SECURITY: only the driver currently assigned to this job can respond.

const money = (n: number | string) => {
  const v = Math.round(Number(n) * 100) / 100
  return Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2)
}

export async function POST(req: NextRequest) {
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const supabase = createSupabaseAdminClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const { jobId, action } = await req.json()
    if (!jobId || !['accept', 'decline'].includes(action)) {
      return NextResponse.json({ error: 'Missing jobId or invalid action' }, { status: 400 })
    }

    const { data: job, error } = await supabase.from('jobs').select('*').eq('id', jobId).single()
    if (error || !job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const request = job.pending_changes
    if (!request?.fields) {
      return NextResponse.json({ error: 'There are no pending changes on this job' }, { status: 400 })
    }
    if (job.status !== 'accepted' || !job.driver_id) {
      return NextResponse.json({ error: 'This job is not awaiting a change approval' }, { status: 409 })
    }

    const { data: drv } = await supabase.from('drivers').select('id, user_id').eq('id', job.driver_id).single()
    if (!drv || drv.user_id !== user.id) {
      return NextResponse.json({ error: 'Only the assigned driver can respond to these changes' }, { status: 403 })
    }

    const fields: Record<string, any> = request.fields
    const summary: string[] = Array.isArray(request.summary) ? request.summary : []
    const newFee = fields.driver_fee ?? job.driver_fee

    if (action === 'accept') {
      const { error: updErr } = await supabase.from('jobs').update({
        ...fields,
        pending_changes: null,
        change_requested_at: null,
        change_reminded_at: null,
      }).eq('id', jobId)
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

      await supabase.from('job_status_events').insert({
        job_id: jobId,
        status: 'accepted',
        note: `Driver accepted the customer's updated details — ${summary.join('; ') || 'changes applied'}. New cash fee: $${money(newFee)}.`,
      })
      await supabase.from('notifications').insert({
        user_id: job.buyer_id,
        job_id: jobId,
        type: 'changes_accepted',
        title: '✅ Driver accepted your changes',
        body: `Your updated job details are locked in. Cash / PayID fee on delivery: $${money(newFee)}.`,
      })
      await notifyUser(supabase, {
        userId: job.buyer_id,
        title: '✅ Driver accepted your changes',
        body: `Your Vanute driver accepted the updated job details. Cash / PayID fee on delivery: $${money(newFee)}.`,
        url: `/buyer/tracking/${jobId}`,
      })
      return NextResponse.json({ ok: true, applied: true })
    }

    // ── decline: apply the buyer's new details, release back to the pool ──
    const { error: relErr } = await supabase.from('jobs').update({
      ...fields,
      driver_id: null,
      status: 'pending',
      accepted_at: null,
      pending_changes: null,
      change_requested_at: null,
      change_reminded_at: null,
      // Fresh 24h live window — this is effectively a system repost of the
      // UPDATED job for the next driver (undated jobs auto-expire after 24h).
      created_at: new Date().toISOString(),
    }).eq('id', jobId)
    if (relErr) return NextResponse.json({ error: relErr.message }, { status: 500 })

    // Privacy: stop sharing this driver's live location for the job.
    await supabase.from('drivers').update({
      current_lat: null, current_lng: null, location_updated_at: null,
    }).eq('id', drv.id)

    await supabase.from('job_status_events').insert({
      job_id: jobId,
      status: 'pending',
      note: 'Driver opted out after the customer\'s changes (no penalty for anyone) — job re-listed live for other drivers with the updated details',
    })
    await supabase.from('notifications').insert({
      user_id: job.buyer_id,
      job_id: jobId,
      type: 'changes_declined',
      title: '🔁 Your job is live again',
      body: 'Your driver couldn\'t take the job with the new details, so it\'s back out to other drivers with your updated details. No fee applies to you.',
    })
    await notifyUser(supabase, {
      userId: job.buyer_id,
      title: '🔁 Your Vanute job is live again',
      body: 'Your driver couldn\'t take the job with the new details. No fee applies — your updated job has automatically been re-listed for other drivers.',
      url: `/buyer/tracking/${jobId}`,
    })
    return NextResponse.json({ ok: true, released: true })
  } catch (err: any) {
    console.error('respond-change error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
