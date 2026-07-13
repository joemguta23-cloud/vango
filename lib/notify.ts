import webpush from 'web-push'

export interface NotifyPayload {
  userId: string
  title: string
  body: string
  url?: string
}

// ── Send SMS via Twilio ───────────────────────────────────────────────────────
export async function sendSMS(phone: string, message: string) {
  if (!process.env.TWILIO_ACCOUNT_SID) return
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER
  const creds = Buffer.from(`${sid}:${token}`).toString('base64')
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: phone, From: from!, Body: message }).toString(),
  })
}

// ── Send email via Resend ─────────────────────────────────────────────────────
export async function sendEmail(to: string, subject: string, html: string) {
  if (!process.env.RESEND_API_KEY) return
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Vanute <no-reply@vanute.com.au>', to, subject, html }),
  })
}

// ── Send browser push notification ───────────────────────────────────────────
export async function sendPush(subscriptions: { endpoint: string; p256dh: string; auth: string }[], payload: { title: string; body: string; url?: string }) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return
  // Initialise lazily inside the function — not at module level
  webpush.setVapidDetails('mailto:hello@vanute.com.au', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY)
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      )
    } catch (_) { /* subscription may have expired */ }
  }
}

// ── Notify a user via all available channels ──────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function notifyUser(supabase: any, { userId, title, body, url }: NotifyPayload) {
  const [{ data: profile }, { data: subs }] = await Promise.all([
    supabase.from('profiles').select('phone').eq('id', userId).single(),
    supabase.from('push_subscriptions').select('*').eq('user_id', userId),
  ])

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const fullUrl = url ? `${baseUrl}${url}` : baseUrl

  if (profile?.phone) await sendSMS(profile.phone, `${title}: ${body}`)

  const { data: authUser } = await supabase.auth.admin.getUserById(userId)
  if (authUser?.user?.email) {
    await sendEmail(authUser.user.email, title, `<p>${body}</p><p><a href="${fullUrl}">View on Vanute →</a></p>`)
  }

  if (subs?.length) await sendPush(subs, { title, body, url: fullUrl })
}
