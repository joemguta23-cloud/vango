import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { notifyUser } from '@/lib/notify'

// CONSTANT REMINDERS for unacknowledged job-change requests.
//
// When a customer edits a job that a driver has already accepted, the driver
// gets one urgent notification immediately (app/api/jobs/edit). But they may
// be driving — so this endpoint keeps re-pinging them (SMS / email / push +
// in-app) until they Accept or Decline the changes on the job page.
//
// It is called every 10 minutes by pg_cron + pg_net from the Supabase
// database (job name 'change-reminders'). Schedule:
//   - first reminder  ~8 minutes after the change request, if unacknowledged
//   - then roughly every 15 minutes
//   - stops after 24h (the request is stale by then) or the moment the
//     driver responds (pending_changes is cleared by respond-change).
//
// SECURITY: requires the x-cron-key header to match the secret stored in
// public.app_config (key 'cron_secret') — that table is service-role-only
// (RLS enabled with no policies), so only the database cron and this server
// route ever see the value.

const FIRST_REMINDER_MIN = 8
const REPEAT_EVERY_MIN = 15
const GIVE_UP_AFTER_H = 24

export async function POST(req: NextRequest) {
  try {
    const supabase = createSupabaseAdminClient()

    const { data: cfg } = await supabase.from('app_config').select('value').eq('key', 'cron_secret').single()
    const provided = req.headers.get('x-cron-key') || ''
    if (!cfg?.value || provided !== cfg.value) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const now = Date.now()
    const { data: jobs, error } = await supabase
      .from('jobs')
      .select('id, driver_id, item_type, pending_changes, change_requested_at, change_reminded_at')
      .eq('status', 'accepted')
      .not('pending_changes', 'is', null)
      .not('driver_id', 'is', null)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    let reminded = 0
    for (const job of jobs ?? []) {
      const requestedAt = job.change_requested_at ? new Date(job.change_requested_at).getTime() : 0
      if (!requestedAt) continue
      const ageMin = (now - requestedAt) / 60000
      if (ageMin > GIVE_UP_AFTER_H * 60) continue // stale — stop nagging

      const lastRemind = job.change_reminded_at ? new Date(job.change_reminded_at).getTime() : null
      const due = lastRemind == null
        ? ageMin >= FIRST_REMINDER_MIN
        : (now - lastRemind) / 60000 >= REPEAT_EVERY_MIN
      if (!due) continue

      const { data: drv } = await supabase.from('drivers').select('user_id').eq('id', job.driver_id).single()
      if (!drv?.user_id) continue

      const summary: string[] = Array.isArray(job.pending_changes?.summary) ? job.pending_changes.summary : []
      const waitedMin = Math.round(ageMin)
      await supabase.from('notifications').insert({
        user_id: drv.user_id,
        job_id: job.id,
        type: 'job_change_reminder',
        title: '⏰ Reminder: job changes still need your OK',
        body: `The customer's changes to "${job.item_type}" have been waiting ${waitedMin} min (${summary.join('; ') || 'details updated'}). Accept or Decline on the job page.`,
      })
      await notifyUser(supabase, {
        userId: drv.user_id,
        title: '⏰ Vanute: job changes still need your OK',
        body: `The customer changed job "${job.item_type}" ${waitedMin} min ago and is waiting on you. You may be heading to the WRONG address — open the job to Accept, or Decline to release it (no penalty).`,
        url: `/driver/job/${job.id}`,
      })
      await supabase.from('jobs').update({ change_reminded_at: new Date().toISOString() }).eq('id', job.id)
      reminded++
    }

    return NextResponse.json({ ok: true, checked: jobs?.length ?? 0, reminded })
  } catch (err: any) {
    console.error('change-reminders error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
