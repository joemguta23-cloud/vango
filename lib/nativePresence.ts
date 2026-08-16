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
 * The plugin reports permission denial asynchronously through the watcher
 * CALLBACK (`error.code === 'NOT_AUTHORIZED'`), not by rejecting the
 * `addWatcher()` promise -- that promise resolves as soon as the watcher is
 * REGISTERED, before the OS permission prompt is necessarily resolved. So
 * `startDriverPresence` wraps the callback-based API in its own Promise.
 *
 * WE SETTLE ON WATCHER REGISTRATION, NOT ON THE FIRST GPS FIX. An earlier
 * version of this file waited for the first successful location fix before
 * letting the driver through. A cold GPS fix routinely takes several seconds
 * (especially indoors), so every single "Go Online" tap sat on "Checking
 * location..." for ~5s. Registration is the correct success signal: it means
 * the watcher is running and the OS will deliver fixes as they arrive. The
 * Promise therefore settles on whichever comes FIRST: `addWatcher()`
 * resolving with a watcher id (success), a `NOT_AUTHORIZED` error from the
 * callback (permission denied), an `addWatcher()` rejection or synchronous
 * throw (watcher-failed), or the overall watchdog below. The watcher
 * intentionally outlives the settled Promise and keeps writing every
 * subsequent fix to Supabase.
 *
 * BECAUSE WE NO LONGER WAIT, A DENIAL CAN ARRIVE LATE. The OS permission
 * prompt may still be on screen when we resolve `{ ok: true }`. If the
 * driver then denies it, `startDriverPresence`'s optional `onLateDenial`
 * callback fires so the caller can put the driver straight back Offline --
 * a driver must NEVER stay Online with no location. The dashboard uses this
 * to revert local state, write `is_online: false`, and show the denial
 * message with the "Open location settings" button.
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
 * `startDriverPresence` therefore races its ENTIRE body -- native check,
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
 * server-side rendering or on the web, and every helper here shares ONE
 * cached `import('@capacitor/core')` promise so that chunk is fetched at
 * most once per session.
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
// `getPlugin()`, and the `addWatcher()` REGISTRATION round trip. Now that we
// no longer block on a first GPS fix, 3s is generous for all of that -- and
// it caps the worst-case "Go Online" wait at ~3s instead of ~8s. It must
// stay comfortably below the driver dashboard's 20s
// `withTimeout(..., 'location check')` so this watchdog always wins and the
// driver gets a working toggle instead of "Timed out: location check".
const PRESENCE_OVERALL_TIMEOUT_MS = 3000

// The teardown helpers also need @capacitor/core, so they get a (shorter)
// bound of their own -- neither may hang the caller forever.
const PRESENCE_TEARDOWN_TIMEOUT_MS = 4000

let watcherId: string | null = null
let cachedPlugin: BackgroundGeolocationPlugin | null = null

// `isNativeApp()` and `getPlugin()` both need @capacitor/core. Caching the
// import PROMISE (rather than importing separately in each) means the
// webpack chunk is resolved once and every later caller gets it instantly.
// A failed import is not cached, so a transient network blip can be retried.
let capacitorCorePromise: Promise<typeof import('@capacitor/core')> | null = null

function loadCapacitorCore(): Promise<typeof import('@capacitor/core')> {
  if (!capacitorCorePromise) {
    capacitorCorePromise = import('@capacitor/core').catch((err) => {
      capacitorCorePromise = null
      throw err
    })
  }
  return capacitorCorePromise
}

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
    const { Capacitor } = await loadCapacitorCore()
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

async function getPlugin(): Promise<BackgroundGeolocationPlugin> {
  if (cachedPlugin) return cachedPlugin
  const { registerPlugin } = await loadCapacitorCore()
  cachedPlugin = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')
  return cachedPlugin
}

// Shared between `startDriverPresence` and its inner body so the watcher
// callback can tell whether the caller has ALREADY been handed an
// `{ ok: true }` result (by us or by the watchdog). If it has, a denial
// arriving afterwards can't be returned -- it has to go out of band through
// `onLateDenial`.
type PresenceDelivery = { deliveredOk: boolean }

/**
 * Begin background location tracking for a driver who wants to go Online.
 * `driverId` is the primary key of the driver's row in the `drivers` table.
 *
 * Returns a result the caller MUST check — see module doc above. Resolves
 * `{ ok: false }` (never throws) when permission is denied or the watcher
 * fails to start, so the dashboard can show a clear explanation and keep the
 * driver Offline rather than silently letting them go online untracked.
 *
 * `onLateDenial` is invoked (at most once, never throwing) if the driver
 * denies location AFTER this promise has already resolved `{ ok: true }` --
 * see module doc. The caller must use it to force the driver back Offline.
 */
export async function startDriverPresence(
  driverId: string,
  onLateDenial?: (message: string) => void
): Promise<DriverPresenceResult> {
  // The watchdog MUST wrap the dynamic `import()` calls too, not just the
  // addWatcher promise. Those imports fetch webpack chunks over the network
  // inside the Capacitor WebView and can stall indefinitely; when that
  // happened, the old inner-only watchdog was never even registered and the
  // whole call hung until the caller's outer timeout tripped. That was the
  // exact cause of drivers being stuck on "Checking location...".
  //
  // The watchdog resolves to SUCCESS, not failure, on purpose. The policy
  // requirement is that the driver has GRANTED location permission and a
  // watcher has been REQUESTED. A slow chunk import, or slow watcher
  // registration, is not a permission refusal and must not stop a driver
  // from working. An explicit `NOT_AUTHORIZED` denial still resolves
  // `{ ok: false, reason: 'permission-denied' }` via the watcher callback
  // whenever it arrives before this deadline -- and `onLateDenial` covers
  // it when it arrives after. The watcher itself outlives this race either
  // way and keeps writing coordinates to Supabase, so customers still see
  // the driver move.
  const delivery: PresenceDelivery = { deliveredOk: false }
  const result = await withDeadline<DriverPresenceResult>(
    startDriverPresenceInner(driverId, delivery, onLateDenial),
    PRESENCE_OVERALL_TIMEOUT_MS,
    { ok: true, native: true }
  )
  // Record that the caller has been told "you're online", so any denial from
  // here on is routed to `onLateDenial` instead of being silently dropped.
  if (result.ok) delivery.deliveredOk = true
  return result
}

/**
 * The real body of `startDriverPresence`. Never call this directly -- it has
 * no time bound of its own; `startDriverPresence` supplies the watchdog.
 */
async function startDriverPresenceInner(
  driverId: string,
  delivery: PresenceDelivery,
  onLateDenial?: (message: string) => void
): Promise<DriverPresenceResult> {
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
    let denied = false
    let lateDenialSent = false

    // Returns true only if THIS call is the one that settled the promise,
    // so the caller can tell a won race from a no-op.
    const finish = (result: DriverPresenceResult): boolean => {
      if (settled) return false
      settled = true
      resolve(result)
      return true
    }

    // A denial that lands after the caller already has an `{ ok: true }`
    // result can't be returned, so hand it over out of band. Deliberately
    // defensive: a throwing handler must not become an unhandled rejection
    // inside the plugin's callback.
    const reportLateDenial = (message: string) => {
      if (lateDenialSent || !onLateDenial) return
      lateDenialSent = true
      try {
        onLateDenial(message)
      } catch {
        /* never let the caller's handler break the watcher */
      }
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
              const permissionDenied = error.code === 'NOT_AUTHORIZED'
              const message = error.message || 'Could not start background location.'
              const registeredId = watcherId
              denied = true
              watcherId = null
              // If the watcher had already been registered (late denial),
              // tear it down -- otherwise a stale id would make the next
              // `startDriverPresence` short-circuit to success.
              if (registeredId) {
                try {
                  plugin.removeWatcher({ id: registeredId }).catch(() => {})
                } catch {
                  /* no-op */
                }
              }
              const wonTheRace = finish({
                ok: false,
                native: true,
                reason: permissionDenied ? 'permission-denied' : 'watcher-failed',
                message,
              })
              // Too late to return this failure? Then push it to the caller.
              if (permissionDenied && (!wonTheRace || delivery.deliveredOk)) {
                reportLateDenial(message)
              }
              return
            }
            if (!location) return
            // Keep streaming to Supabase on EVERY fix, including the ones
            // that arrive long after the promise above has settled. This is
            // what customers see as the driver's live position. It is NOT a
            // settle condition -- waiting for it is what made going Online
            // feel slow.
            supabase
              .from('drivers')
              .update({ current_lat: location.latitude, current_lng: location.longitude })
              .eq('id', driverId)
              .then()
          }
        )
        .then((id) => {
          // A denial beat registration -- don't keep the watcher around.
          if (denied) {
            try {
              plugin.removeWatcher({ id }).catch(() => {})
            } catch {
              /* no-op */
            }
            return
          }
          watcherId = id
          // REGISTRATION is the success signal. The OS has accepted the
          // watcher; fixes will follow on their own schedule and there is
          // no reason to make the driver wait for the first one.
          finish({ ok: true, native: true })
        })
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
 * to load @capacitor/core.
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
