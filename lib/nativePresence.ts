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
 * IMPORTANT: `@capacitor-community/background-geolocation` ships NO
 * JavaScript entry point at all -- its published package has no `main`,
 * `module`, or `exports` field, only native iOS/Android source plus a
 * `.d.ts` file. Importing anything directly `from` that package name (as an
 * earlier version of this file did) makes Next.js/webpack fail the build
 * with "Module not found" the moment any real code path reaches this file --
 * which is exactly what happened the first time this module was actually
 * wired up to the dashboard. The plugin's own README confirms the correct
 * access pattern is Capacitor's `registerPlugin('BackgroundGeolocation')`,
 * which resolves the native implementation at runtime without any bundler
 * ever needing to resolve a JS file inside that package. We declare a
 * minimal local type for the plugin's shape instead of importing its types.
 *
 * The plugin also reports permission denial asynchronously through the
 * watcher CALLBACK (`error.code === 'NOT_AUTHORIZED'`), not by rejecting the
 * `addWatcher()` promise -- that promise resolves as soon as the watcher is
 * registered, before the OS permission prompt is necessarily resolved. So
 * `startDriverPresence` wraps the callback-based API in its own Promise that
 * settles on whichever comes first: a permission error, a successful first
 * location fix, or a bounded timeout (treated as success, since no denial
 * was reported) so a slow GPS fix can never leave the toggle hanging forever.
 *
 * THE WATCHDOG COVERS THE WHOLE FUNCTION, NOT JUST THE WATCHER. An earlier
 * version of this file registered that bounded timeout INSIDE the returned
 * Promise's executor -- i.e. only after `await isNativeApp()` and
 * `await getPlugin()` had already resolved. Both of those perform
 * `await import('@capacitor/core')`, a dynamic webpack chunk fetch, and
 * inside the Capacitor WebView (which loads the live site over the network
 * via `server.url`) such a fetch can stall indefinitely. When it stalled,
 * the Promise was never constructed, the timeout was never registered, and
 * nothing ever settled -- drivers sat on "Checking location..." until the
 * dashboard's own outer 20s guard tripped with "Timed out: location check".
 * `startDriverPresence` therefore now races its ENTIRE body -- native check,
 * dynamic imports and `addWatcher()` alike -- against a single
 * `PRESENCE_OVERALL_TIMEOUT_MS` watchdog, which is deliberately well under
 * the caller's 20s limit so this watchdog always wins.
 *
 * If `plugin.addWatcher(...)` (or anything else inside the Promise executor)
 * throws SYNCHRONOUSLY -- which happens when the native BackgroundGeolocation
 * implementation isn't actually linked into the installed app binary -- the
 * executor is wrapped in its own try/catch so that case resolves to
 * `{ ok: false, ... }` too instead of letting the Promise constructor
 * auto-reject. `startDriverPresence` must NEVER reject; it always resolves.
 *
 * `startDriverPresence` never silently no-ops on a real failure. It always
 * resolves to a typed `DriverPresenceResult` that the caller (the driver
 * dashboard's online toggle) MUST check before completing the "go Online"
 * state change. If the driver denies location permission, or the background
 * watcher fails to start for any other reason, the result is
 * `{ ok: false, ... }` — the caller must revert the UI and must NOT write
 * `is_online: true` to Supabase.
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

// Minimal local shape of the BackgroundGeolocation plugin -- see the module
// doc above for why we don't import types from the package itself.
interface BackgroundGeolocationPlugin {
  addWatcher(
    options: {
      backgroundTitle?: string
      backgroundMessage?: string
      requestPermissions?: boolean
      stale?: boolean
      distanceFilter?: number
    },
    callback: (
      location?: { latitude: number; longitude: number },
      error?: { code?: string; message?: string }
    ) => void
  ): Promise<string>
  removeWatcher(options: { id: string }): Promise<void>
  openSettings(): Promise<void>
}

// Single overall watchdog for `startDriverPresence`. It guards EVERYTHING:
// the `isNativeApp()` check, the dynamic `import('@capacitor/core')` inside
// `getPlugin()`, and the `addWatcher()` round trip / first location fix.
// This must stay comfortably below the driver dashboard's 20s
// `withTimeout(..., 'location check')` so this watchdog always wins and the
// driver gets a working toggle instead of "Timed out: location check".
const PRESENCE_OVERALL_TIMEOUT_MS = 8000

// The teardown helpers also `await import('@capacitor/core')`, so they get a
// (shorter) bound of their own -- neither may hang the caller forever.
const PRESENCE_TEARDOWN_TIMEOUT_MS = 4000

let watcherId: string | null = null
let cachedPlugin: BackgroundGeolocationPlugin | null = null

/**
 * Resolve `work`, or `fallback` if `work` hasn't settled within `ms`.
 * The losing promise is NOT cancelled -- e.g. the location watcher keeps
 * running and keeps streaming coordinates to Supabase long after the raced
 * promise has settled, which is exactly what we want.
 */
function withDeadline<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(fallback), ms)
    }),
  ])
}

async function isNativeApp(): Promise<boolean> {
  try {
    const { Capacitor } = await import('@capacitor/core')
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

async function getPlugin(): Promise<BackgroundGeolocationPlugin> {
  if (cachedPlugin) return cachedPlugin
  const { registerPlugin } = await import('@capacitor/core')
  cachedPlugin = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')
  return cachedPlugin
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
  // The watchdog MUST wrap the dynamic `import()` calls too, not just the
  // addWatcher promise. Those imports fetch webpack chunks over the network
  // inside the Capacitor WebView and can stall indefinitely; when that
  // happened, the old inner-only watchdog was never even registered and the
  // whole call hung until the caller's outer timeout tripped. That was the
  // exact cause of drivers being stuck on "Checking location...".
  //
  // The watchdog resolves to SUCCESS, not failure, on purpose. The policy
  // requirement is that the driver has GRANTED location permission and a
  // watcher has been REQUESTED. A slow first GPS fix, or a slow chunk
  // import, is not a permission refusal and must not stop a driver from
  // working. An explicit `NOT_AUTHORIZED` denial still resolves
  // `{ ok: false, reason: 'permission-denied' }` via the watcher callback,
  // and still wins whenever it arrives before this deadline. The watcher
  // itself outlives this race either way and keeps writing coordinates to
  // Supabase, so customers still see the driver move.
  return withDeadline<DriverPresenceResult>(
    startDriverPresenceInner(driverId),
    PRESENCE_OVERALL_TIMEOUT_MS,
    { ok: true, native: true }
  )
}

/**
 * The real body of `startDriverPresence`. Never call this directly -- it has
 * no time bound of its own; `startDriverPresence` supplies the watchdog.
 */
async function startDriverPresenceInner(driverId: string): Promise<DriverPresenceResult> {
  if (watcherId) return { ok: true, native: true }
  if (!(await isNativeApp())) return { ok: true, native: false }

  const supabase = createSupabaseBrowserClient()

  let plugin: BackgroundGeolocationPlugin
  try {
    plugin = await getPlugin()
  } catch (err: any) {
    return {
      ok: false,
      native: true,
      reason: 'watcher-failed',
      message: String(err?.message || err || 'Could not load the location plugin.'),
    }
  }

  return new Promise<DriverPresenceResult>((resolve) => {
    let settled = false
    const finish = (result: DriverPresenceResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    try {
      plugin
        .addWatcher(
          {
            backgroundTitle: 'Vanute — Online',
            backgroundMessage: 'Keeping you online so you receive nearby jobs.',
            requestPermissions: true,
            stale: false,
            distanceFilter: 50,
          },
          (location, error) => {
            if (error) {
              watcherId = null
              const permissionDenied = error.code === 'NOT_AUTHORIZED'
              finish({
                ok: false,
                native: true,
                reason: permissionDenied ? 'permission-denied' : 'watcher-failed',
                message: error.message || 'Could not start background location.',
              })
              return
            }
            if (!location) return
            finish({ ok: true, native: true })
            // Keep streaming to Supabase on EVERY fix, including the ones
            // that arrive long after the promise above has settled (either
            // here or via the overall watchdog). This is what customers see
            // as the driver's live position.
            supabase
              .from('drivers')
              .update({ current_lat: location.latitude, current_lng: location.longitude })
              .eq('id', driverId)
              .then()
          }
        )
        .then((id) => { watcherId = id })
        .catch((err: any) => {
          watcherId = null
          finish({
            ok: false,
            native: true,
            reason: 'watcher-failed',
            message: String(err?.message || err || 'Could not start background location.'),
          })
        })
    } catch (err: any) {
      // `plugin.addWatcher(...)` (or anything else above) threw SYNCHRONOUSLY
      // -- e.g. the native BackgroundGeolocation implementation isn't linked
      // into the installed app binary. Without this catch, the Promise
      // constructor auto-rejects and the caller's unguarded `await` would
      // throw, leaving the dashboard's "Checking location..." toggle stuck
      // forever. Resolve with a clear failure instead -- startDriverPresence
      // must never reject.
      watcherId = null
      finish({
        ok: false,
        native: true,
        reason: 'watcher-failed',
        message: String(err?.message || err || 'Could not start background location.'),
      })
    }
  })
}

/** Stop background tracking when a driver goes Offline. Safe to call anytime. */
export async function stopDriverPresence(): Promise<void> {
  if (!watcherId) return
  const id = watcherId
  // Clear first: the driver is Offline as far as this module is concerned
  // even if the native round trip below stalls or times out.
  watcherId = null
  await withDeadline<void>(
    (async () => {
      try {
        const plugin = await getPlugin()
        await plugin.removeWatcher({ id })
      } catch {
        /* no-op on web */
      }
    })(),
    PRESENCE_TEARDOWN_TIMEOUT_MS,
    undefined
  )
}

/**
 * Jump the driver to the native app's settings page so they can grant
 * location permission after previously declining it. Safe no-op on the web
 * or if the plugin can't be reached — and time-bounded, because it too has
 * to `await import('@capacitor/core')`.
 */
export async function openDriverLocationSettings(): Promise<void> {
  await withDeadline<void>(
    (async () => {
      if (!(await isNativeApp())) return
      try {
        const plugin = await getPlugin()
        await plugin.openSettings()
      } catch {
        /* no-op */
      }
    })(),
    PRESENCE_TEARDOWN_TIMEOUT_MS,
    undefined
  )
}
