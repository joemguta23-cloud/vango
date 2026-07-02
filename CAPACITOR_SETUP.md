# VanGo Native App (Capacitor) — Build & Activation Guide

This is the "activation day" checklist. Everything needed to turn VanGo into a
real iOS + Android app is already committed to the repo. Nothing below costs
money **until the final store-submission step** (Apple $99/yr, Google $25 once).

---

## What's already done (committed to `main`)

- **`capacitor.config.ts`** — app id `au.com.getvango.app`, name "VanGo". The
  native shell loads the live site (`https://getvango.com.au`) so the app always
  runs the latest deployed code. Push-notification presentation is configured.
- **`package.json`** — Capacitor 8 + the background-geolocation and
  push-notification plugins are in the dependencies.
- **`lib/nativePresence.ts`** — the background-location engine. `startDriverPresence()`
  streams a driver's location to Supabase even when the app is backgrounded /
  the phone is locked, and shows a persistent "VanGo — Online" notification so
  the OS won't suspend it. `stopDriverPresence()` ends it. On the website these
  are safe no-ops — the site is completely unaffected.

## One small code change still to apply (do it during the build, below)

The driver dashboard's Online/Offline button already writes `is_online` to
Supabase. To also start/stop background tracking in the **native app**, update
`toggleOnline` in `app/driver/dashboard/page.tsx` so it reads:

```ts
  const toggleOnline = async () => {
    if (!driver) return
    setToggling(true)
    const goingOnline = !driver.is_online
    await supabase.from('drivers').update({ is_online: goingOnline }).eq('id', driver.id)
    setDriver(d => d ? { ...d, is_online: goingOnline } : d)
    // Native app only — no-op on the website:
    try {
      const { startDriverPresence, stopDriverPresence } = await import('@/lib/nativePresence')
      if (goingOnline) await startDriverPresence(driver.id)
      else await stopDriverPresence()
    } catch {}
    setToggling(false)
  }
```

That's the only edit — everything else in the dashboard stays exactly as-is.
(We hold this until build time because it can only be truly tested on a device.)

---

## Build steps (all free — no store account needed yet)

You need a computer with **Node.js** (already installed) for Android, and a
**Mac** (or a cloud Mac like MacinCloud) for the iOS build. On the project folder:

```bash
npm install
npx cap add android      # creates the Android project
npx cap add ios          # Mac only — creates the iOS project
npx cap sync             # copies config + plugins into both
```

### Native permissions (add once, per platform)

**Android** — in `android/app/src/main/AndroidManifest.xml` add:
```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

**iOS** — in `ios/App/App/Info.plist` add:
```xml
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>VanGo uses your location while you're Online to send you nearby delivery jobs.</string>
<key>NSLocationWhenInUseUsageDescription</key>
<string>VanGo uses your location to match you with nearby delivery jobs.</string>
<key>UIBackgroundModes</key>
<array><string>location</string></array>
```

### Run it on a phone (free)
```bash
npx cap open android     # opens Android Studio → Run on a connected phone/emulator
npx cap open ios         # opens Xcode → Run on a connected iPhone/simulator (Mac)
```
On Android you can install the app on your own phone for free with no store
account. Test: log in as a driver, tap **Online**, background the app / lock the
phone, and confirm the driver's location keeps updating in Supabase and the
"VanGo — Online" notification stays visible.

---

## Publishing (this is the only paid step)

- **Google Play:** create a Play Console account (one-time **US$25**), then
  `Build > Generate Signed Bundle (.aab)` in Android Studio and upload.
- **Apple App Store:** enrol in the Apple Developer Program (**US$99/year**),
  then Archive in Xcode and upload via App Store Connect.

When you're ready, say the word and I'll walk you through each screen. I can't
create the accounts or enter payment details for you, but I'll do everything
else alongside you.

---

## Notes / decisions

- **Convex is not used and not needed.** Supabase already provides realtime,
  auth, and the database. Keep it.
- The app loads the live site, so most updates ship instantly via Vercel with
  **no app-store resubmission** — you only resubmit when native code (plugins,
  permissions, icons) changes.
