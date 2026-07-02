/**
 * Driver presence — native background location.
 *
 * This module is what makes a driver "stay Online like Uber". In the native
 * VanGo app (iOS/Android via Capacitor) it streams the driver's location to
 * Supabase even when the app is backgrounded or the phone is locked, and keeps
 * a persistent "VanGo — Online" notification so the OS won't suspend it.
 *
 * On the plain website every function is a safe no-op — nothing about the web
 * experience changes. All Capacitor imports are dynamic so they are never
 * evaluated during server-side rendering or on the web.
 */
import { createSupabaseBrowserClient } from '@/lib/supabase'

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
 * Begin background location tracking for a driver who just went Online.
 * `driverId` is the primary key of the driver's row in the `drivers` table.
 */
export async function startDriverPresence(driverId: string): Promise<void> {
  if (watcherId) return
  if (!(await isNativeApp())) return

  const { BackgroundGeolocation } = await import('@capacitor-community/background-geolocation')
  const supabase = createSupabaseBrowserClient()

  watcherId = await BackgroundGeolocation.addWatcher(
    {
      backgroundTitle: 'VanGo — Online',
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
