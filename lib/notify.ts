import webpush from 'web-push'

export interface NotifyPayload {
  userId: string
  title: string
  body: string
  url?: string
}

// -- Send SMS via Twilio ------------------------------------------------------
export async function sendSMS(phone: string, message: string) {
  if (!process.env.TWILIO_ACCOUNT_SID) return
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER
  const creds = Buffer.from(sid + ':' + token).toString('base64')
  await fetch('https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + creds, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: phone, From: from!, Body: message }).toString(),
  })
}

// -- Send email via Resend ----------------------------------------------------
export async function sendEmail(to: string, subject: string, html: string) {
  if (!process.env.RESEND_API_KEY) return
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Vanute <admin@vanute.com.au>', to, subject, html }),
  })
}

// -- Send browser (web) push --------------------------------------------------
export async function sendPush(
  subscriptions: { endpoint: string; p256dh: string; auth: string }[],
  payload: { title: string; body: string; url?: string }
) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return
  webpush.setVapidDetails('mailto:hello@vanute.com.au', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY)
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      )
    } catch (_) {
      /* subscription may have expired */
    }
  }
}

// -- Native push (iOS/Android) via Firebase Cloud Messaging v1 -----------------
//
// Web push does NOT work inside the iOS app (WKWebView has no service worker
// push), so the native app relies on this path. lib/push.ts stores each
// driver's device token on drivers.push_token when they go Online.
//
// Requires two env vars:
//   FCM_PROJECT_ID            - Firebase project id
//   FCM_SERVICE_ACCOUNT_JSON  - the whole service-account JSON, as one line

let cachedToken: { value: string; expires: number } | null = null

async function getFcmAccessToken(): Promise<string | null> {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON
  if (!raw) return null
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value

  try {
    const sa = JSON.parse(raw)
    const now = Math.floor(Date.now() / 1000)
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const unsigned =
      enc({ alg: 'RS256', typ: 'JWT' }) +
      '.' +
      enc({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      })

    const { createSign } = await import('crypto')
    const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url')
    const assertion = unsigned + '.' + signature

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    })
    if (!res.ok) return null
    const json = await res.json()
    if (!json.access_token) return null
    cachedToken = { value: json.access_token, expires: Date.now() + 3500 * 1000 }
    return cachedToken.value
  } catch {
    return null
  }
}

export async function sendNativePush(
  tokens: string[],
  payload: { title: string; body: string; url?: string }
) {
  const projectId = process.env.FCM_PROJECT_ID
  const accessToken = await getFcmAccessToken()
  if (!projectId || !accessToken || tokens.length === 0) return

  const endpoint = 'https://fcm.googleapis.com/v1/projects/' + projectId + '/messages:send'

  for (const token of tokens) {
    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: payload.title, body: payload.body },
            data: payload.url ? { url: payload.url } : undefined,
            apns: {
              payload: { aps: { sound: 'default', badge: 1 } },
            },
            android: {
              priority: 'HIGH',
              notification: { sound: 'default', channel_id: 'vanute_jobs' },
            },
          },
        }),
      })
    } catch {
      /* one bad token must not stop the rest of the blast */
    }
  }
}

// -- Notify a user across every available channel ------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function notifyUser(supabase: any, { userId, title, body, url }: NotifyPayload) {
  const [{ data: profile }, { data: subs }, { data: driver }] = await Promise.all([
    supabase.from('profiles').select('phone').eq('id', userId).single(),
    supabase.from('push_subscriptions').select('*').eq('user_id', userId),
    supabase.from('drivers').select('push_token, push_enabled').eq('user_id', userId).maybeSingle(),
  ])

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const fullUrl = url ? baseUrl + url : baseUrl

  // Native app push first - this is the one drivers actually feel on their phone.
  // push_enabled defaults to true; only an explicit false opts out.
  if (driver?.push_token && driver.push_enabled !== false) {
    await sendNativePush([driver.push_token], { title, body, url: fullUrl })
  }

  if (profile?.phone) await sendSMS(profile.phone, title + ': ' + body)

  const { data: authUser } = await supabase.auth.admin.getUserById(userId)
  if (authUser?.user?.email) {
    await sendEmail(
      authUser.user.email,
      title,
      '<p>' + body + '</p><p><a href="' + fullUrl + '">View on Vanute &rarr;</a></p>'
    )
  }

  if (subs?.length) await sendPush(subs, { title, body, url: fullUrl })
}
