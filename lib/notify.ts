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

// -- Native push straight to Apple (APNs) -------------------------------------
//
// This is the Uber-style banner: it lands over whatever the driver is doing
// (YouTube, Netflix, locked screen). Web push does NOT work inside the iOS app,
// so the native app depends on this path.
//
// @capacitor/push-notifications hands back a raw APNs device token, which is
// what we store on drivers.push_token - so we talk to Apple directly rather
// than going through Firebase (an APNs token is NOT an FCM token).
//
// APNs requires HTTP/2, and fetch/undici is HTTP/1.1 only - hence node:http2.
//
// Env vars:
//   APNS_KEY_ID       - the 10-char Key ID of the .p8 auth key
//   APNS_TEAM_ID      - Apple team id (W4HM867WCU)
//   APNS_PRIVATE_KEY  - contents of the .p8, newlines may be escaped as \\n
//   APNS_BUNDLE_ID    - defaults to au.com.vanute
//   APNS_SANDBOX      - 'true' only for Xcode-installed builds; TestFlight and
//                       the App Store both use production, which is the default

let cachedJwt: { value: string; made: number } | null = null

function buildApnsJwt(): string | null {
  const keyId = process.env.APNS_KEY_ID
  const teamId = process.env.APNS_TEAM_ID
  const raw = process.env.APNS_PRIVATE_KEY
  if (!keyId || !teamId || !raw) return null

  // Apple rotates tokens hourly; reuse for 45 min to stay well inside the limit.
  if (cachedJwt && Date.now() - cachedJwt.made < 45 * 60 * 1000) return cachedJwt.value

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createSign } = require('crypto')
    const privateKey = raw.includes('BEGIN') ? raw.replace(/\\n/g, '\n') : raw
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const unsigned =
      enc({ alg: 'ES256', kid: keyId }) +
      '.' +
      enc({ iss: teamId, iat: Math.floor(Date.now() / 1000) })

    // APNs wants a JOSE (r||s) signature, not the DER default.
    const signature = createSign('SHA256')
      .update(unsigned)
      .sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }, 'base64url')

    const jwt = unsigned + '.' + signature
    cachedJwt = { value: jwt, made: Date.now() }
    return jwt
  } catch {
    return null
  }
}

export async function sendNativePush(
  tokens: string[],
  payload: { title: string; body: string; url?: string }
) {
  const jwt = buildApnsJwt()
  if (!jwt || tokens.length === 0) return

  const bundleId = process.env.APNS_BUNDLE_ID || 'au.com.vanute'
  const host =
    process.env.APNS_SANDBOX === 'true'
      ? 'https://api.sandbox.push.apple.com'
      : 'https://api.push.apple.com'

  const body = JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: 'default',
      badge: 1,
    },
    url: payload.url,
  })

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const http2 = require('http2')
    const client = http2.connect(host)
    client.on('error', () => {})

    await Promise.all(
      tokens.map(
        (token) =>
          new Promise<void>((resolve) => {
            const req = client.request({
              ':method': 'POST',
              ':path': '/3/device/' + token,
              authorization: 'bearer ' + jwt,
              'apns-topic': bundleId,
              'apns-push-type': 'alert',
              'apns-priority': '10',
              'content-type': 'application/json',
            })
            req.setTimeout(8000, () => {
              req.close()
              resolve()
            })
            req.on('error', () => resolve())
            req.on('end', () => resolve())
            req.on('response', () => {})
            req.resume()
            req.end(body)
          })
      )
    )

    client.close()
  } catch {
    /* never let a push failure break the job flow */
  }
}

// -- Notify a user across every channel they have left switched on -------------
//
// Drivers control each channel independently from /driver/notifications.
// All three default to TRUE, so a driver who never touches settings gets
// everything. Only an explicit false opts them out. Customers have no driver
// row, so they always receive everything.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function notifyUser(supabase: any, { userId, title, body, url }: NotifyPayload) {
  const [{ data: profile }, { data: subs }, { data: driver }] = await Promise.all([
    supabase.from('profiles').select('phone').eq('id', userId).single(),
    supabase.from('push_subscriptions').select('*').eq('user_id', userId),
    supabase
      .from('drivers')
      .select('push_token, push_enabled, sms_enabled, email_enabled')
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const fullUrl = url ? baseUrl + url : baseUrl

  const pushAllowed = !driver || driver.push_enabled !== false
  const smsAllowed = !driver || driver.sms_enabled !== false
  const emailAllowed = !driver || driver.email_enabled !== false

  if (driver?.push_token && pushAllowed) {
    await sendNativePush([driver.push_token], { title, body, url: fullUrl })
  }

  if (smsAllowed && profile?.phone) {
    await sendSMS(profile.phone, title + ': ' + body)
  }

  if (emailAllowed) {
    const { data: authUser } = await supabase.auth.admin.getUserById(userId)
    if (authUser?.user?.email) {
      await sendEmail(
        authUser.user.email,
        title,
        '<p>' + body + '</p><p><a href="' + fullUrl + '">View on Vanute &rarr;</a></p>'
      )
    }
  }

  if (pushAllowed && subs?.length) await sendPush(subs, { title, body, url: fullUrl })
}
