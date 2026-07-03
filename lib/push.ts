/**
 * Native driver push notifications (Capacitor).
 *
 * Uber-style: when a driver is Online, we register their device for push so a
 * new nearby job alerts them with a sound even when the app is backgrounded or
 * the phone is locked. On the web every function is a safe no-op.
 *
 * DELIVERY REQUIRES (set up at publishing, see CAPACITOR_SETUP.md):
 *  - Firebase Cloud Messaging (Android) + APNs (iOS) configured in the native project
 *  - the driver's device token stored (drivers.push_token) so the server can target them
 *  - a server send (Supabase Edge Function / /api/notify) that pushes to online drivers
 *    with token(s) when a new pending job appears, payload sound: 'default' for the beep
 *  - optional: public/notify.mp3 for the in-app (foreground) chime
 */
import { createSupabaseBrowserClient } from '@/lib/supabase'

async function isNativeApp(): Promise<boolean> {
  try {
    const { Capacitor } = await import('@capacitor/core')
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

/**
 * Ask the driver for notification permission and register their device token.
 * Call when a driver goes Online. Returns the outcome so the UI can show a
 * prompt if permission is denied. No-op (returns 'unavailable') on the web.
 */
export async function registerDriverPush(driverId: string): Promise<'granted' | 'denied' | 'unavailable'> {
  if (!(await isNativeApp())) return 'unavailable'
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')

    let receive = (await PushNotifications.checkPermissions()).receive
    if (receive === 'prompt' || receive === 'prompt-with-rationale') {
      receive = (await PushNotifications.requestPermissions()).receive
    }
    if (receive !== 'granted') return 'denied'

    // Store the device token so the server can push new jobs to this driver.
    PushNotifications.addListener('registration', async (token) => {
      const supabase = createSupabaseBrowserClient()
      await supabase.from('drivers').update({ push_token: token.value }).eq('id', driverId)
    })

    // Foreground chime: a job arriving while the app is open still beeps.
    PushNotifications.addListener('pushNotificationReceived', () => {
      try { new Audio('/notify.mp3').play().catch(() => {}) } catch {}
    })

    await PushNotifications.register()
    return 'granted'
  } catch {
    return 'unavailable'
  }
}

/** Clear the driver's push token when they go Offline. Safe to call anytime. */
export async function unregisterDriverPush(driverId: string): Promise<void> {
  if (!(await isNativeApp())) return
  try {
    const supabase = createSupabaseBrowserClient()
    await supabase.from('drivers').update({ push_token: null }).eq('id', driverId)
  } catch {
    /* no-op */
  }
}
