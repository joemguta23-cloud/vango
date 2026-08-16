import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { notifyUser } from '@/lib/notify'

// Sends a chat message on a job AND pushes a real notification to the OTHER
// participant, so a buyer/driver doesn't have to be staring at the chat to
// know a reply landed. MessageThread.tsx posts here instead of inserting
// directly into job_messages, because only a server route can call
// notifyUser -- it needs the service-role client to read push tokens and
// send email via supabase.auth.admin. Same auth + participant-validation
// pattern as app/api/jobs/contact/route.ts.
export async function POST(req: NextRequest) {
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const supabase = createSupabaseAdminClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const { jobId, body: text } = await req.json()
    if (!jobId || !text || !String(text).trim()) {
      return NextResponse.json({ error: 'Missing jobId or message body' }, { status: 400 })
    }

    const { data: job } = await supabase
      .from('jobs')
      .select('id, buyer_id, driver_id, drivers(user_id)')
      .eq('id', jobId)
      .single()
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const driverUserId = (job.drivers as any)?.user_id
    const isBuyer = user.id === job.buyer_id
    const isDriver = !!driverUserId && user.id === driverUserId
    if (!isBuyer && !isDriver) {
      return NextResponse.json({ error: 'Not a participant of this job' }, { status: 403 })
    }
    const recipientId = isBuyer ? driverUserId : job.buyer_id
    if (!recipientId) {
      return NextResponse.json({ error: 'No recipient for this job yet' }, { status: 400 })
    }

    const { data: message, error: insertErr } = await supabase
      .from('job_messages')
      .insert({ job_id: jobId, sender_id: user.id, body: String(text).trim() })
      .select('*, sender:profiles(full_name)')
      .single()
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

    const senderName = message.sender?.full_name || (isBuyer ? 'Your buyer' : 'Your driver')
    const recipientUrl = isBuyer ? `/driver/job/${jobId}` : `/buyer/tracking/${jobId}`

    // Best-effort: a notify failure should never fail the send itself.
    notifyUser(supabase, {
      userId: recipientId,
      title: `New message from ${senderName}`,
      body: String(text).trim(),
      url: recipientUrl,
    }).catch(() => {})

    return NextResponse.json({ message })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
