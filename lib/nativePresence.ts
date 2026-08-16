/**
 * Driver presence — native background location.
 *
 * This is the enforcement point for Vanute's policy that a driver MUST share
 * live location (including background/constant updates) to work as a driver.
 * In the native Vanute app (iOS/Android via Capacitor) it streams the
 * driver's location to Supabase even when the app is backgrounded or the
 * phone is locked, and keeps a persistent "Vanute — Online" notification so
 * the OS won't suspend it.
 *
 * `startDriverPresence` never silently no-ops on failure. It always resolves
 * to a typed `DriverPresenceResult` that the caller (the driver dashboard's
 * online toggle) MUST check before completing the "go Online" state change.
 * If the driver denies location permission, or the background watcher fails
 * to start for any other reason, the result is `{ ok: false, ... }` — the
 * caller must revert the UI and must NOT write `is_online: true` to Supabase.
 *
 * On the plain website (not running inside the native app) there is no way
 * to get true background location from a browser tab, so this resolves
 * `{ ok: true, native: false }`. The caller is responsible for still
 * requiring at least a foreground location permission grant in that case —
 * see `app/driver/dashboard/page.tsx`'s `toggleOnline` — so a driver can
 * never go Online, on any platform, without actively sharing location.
 *
 * All Capacitor imports are dynamic so they are never evaluated during
 * server-side rendering or on the web.
 */
import { createSupabaseBrowserClient } from '@/lib/supabase'

export type DriverPresenceResult =
  | { ok: true; native: boolean }
  | { ok: false; native: boolean; reason: 'permission-denied' | 'watcher-failed'; message: string }

let watcherId: string | null = null

async function isNativeApp(): Promise<boolean> {
  try {
    const { Capacitor } = await import('@capacitor/core')
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

/**
 * Begin background location tracking for a driver who wants to go Online.
 * `driverId` is the primary key of the driver's row in the `drivers` table.
 *
 * Returns a result the caller MUST check — see module doc above. Resolves
 * `{ ok: false }` (never throws) when permission is denied or the watcher
 * fails to start, so the dashboard can show a clear explanation and keep the
 * driver Offline rather than silently letting them go online untracked.
 */
export async function startDriverPresence(driverId: string): Promise<DriverPresenceResult> {
  if (watcherId) return { ok: true, native: true }
  if (!(await isNativeApp())) return { ok: true, native: false }

  const supabase = createSupabaseBrowserClient()

  try {
    const { BackgroundGeolocation } = await import('@capacitor-community/background-geolocation')
    watcherId = await BackgroundGeolocation.addWatcher(
      {
        backgroundTitle: 'Vanute — Online',
        backgroundMessage: 'Keeping you online so you receive nearby jobs.',
        requestPermissions: true,
        stale: false,
        distanceFilter: 50,
      },
      async (location, error) => {
        if (error || !location) return
        await supabase
          .from('drivers')
          .update({ current_lat: location.latitude, current_lng: location.longitude })
          .eq('id', driverId)
      }
    )
    return { ok: true, native: true }
  } catch (err: any) {
    watcherId = null
    const message = String(err?.message || err || 'Could not start background location.')
    const permissionDenied = /denied|permission|not authorized|notauthorized/i.test(message)
    return {
      ok: false,
      native: true,
      reason: permissionDenied ? 'permission-denied' : 'watcher-failed',
      message,
    }
  }
}

/** Stop background tracking when a driver goes Offline. Safe to call anytime. */
export async function stopDriverPresence(): Promise<void> {
  if (!watcherId) return
  try {
    const { BackgroundGeolocation } = await import('@capacitor-community/background-geolocation')
    await BackgroundGeolocation.removeWatcher({ id: watcherId })
  } catch {
    /* no-op on web */
  }
  watcherId = null
}
