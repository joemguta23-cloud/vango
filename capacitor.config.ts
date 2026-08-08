import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Vanute native app (Capacitor) configuration.
 *
 * The native iOS/Android shell loads the live site (server.url) so the app
 * always runs the latest deployed code — no app-store update needed for most
 * changes. The native layer adds what a browser can't do: background location
 * (drivers stay Online with the app closed) and native push notifications.
 */
const config: CapacitorConfig = {
  appId: 'au.com.vanute.app',
  appName: 'Vanute',
  webDir: 'public',
  server: {
    url: 'https://www.vanute.com.au',
    cleartext: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
}

export default config
