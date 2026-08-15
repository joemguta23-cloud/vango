'use client'

import { useEffect } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

/**
 * Keeps a signed-in user signed in across app backgrounding.
 *
 * Why this exists: the native app (Capacitor) loads the live site in a
 * WKWebView. When the user leaves the app, iOS suspends all JS timers, so
 * supabase-js stops refreshing the access token. On returning, the token can be
 * stale and the user gets bounced to /login - even after only a minute away.
 *
 * Fix: pause auto-refresh while backgrounded, and on resume refresh the token
 * before any page code runs a query. A user is only signed out after
 * MAX_INACTIVITY_MS of genuinely not opening the app - locking the phone or
 * switching to another app never signs anyone out.
 */

const LAST_ACTIVE_KEY = 'vanute:lastActiveAt'
const MAX_INACTIVITY_MS = 24 * 60 * 60 * 1000 // 24 hours, rolling
const REFRESH_IF_EXPIRING_WITHIN_MS = 5 * 60 * 1000

function markActive() {
  try {
    window.localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()))
  } catch {
    /* storage unavailable (private mode) - not fatal */
  }
}

function inactiveTooLong(): boolean {
  try {
    const raw = window.localStorage.getItem(LAST_ACTIVE_KEY)
    if (!raw) return false
    const last = Number(raw)
    if (!Number.isFinite(last)) return false
    return Date.now() - last > MAX_INACTIVITY_MS
  } catch {
    return false
  }
}

export default function SessionKeepAlive() {
  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    let removeNativeListener: (() => void) | undefined

    markActive()

    const onForeground = async () => {
      if (inactiveTooLong()) {
        await supabase.auth.signOut()
        return
      }
      markActive()
      try {
        const { data } = await supabase.auth.getSession()
        const session = data.session
        if (
          session?.expires_at &&
          session.expires_at * 1000 - Date.now() < REFRESH_IF_EXPIRING_WITHIN_MS
        ) {
          await supabase.auth.refreshSession()
        }
      } catch {
        /* offline - supabase retries once connectivity returns */
      }
      supabase.auth.startAutoRefresh()
    }

    const onBackground = () => {
      markActive()
      supabase.auth.stopAutoRefresh()
    }

    // Web / PWA
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void onForeground()
      else onBackground()
    }
    document.addEventListener('visibilitychange', onVisibility)

    // Native app (Capacitor) - fires reliably where visibilitychange does not.
    void (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (!Capacitor.isNativePlatform()) return
        const { App } = await import('@capacitor/app')
        const handle = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) void onForeground()
          else onBackground()
        })
        removeNativeListener = () => {
          void handle.remove()
        }
      } catch {
        /* plain web build - Capacitor not present */
      }
    })()

    supabase.auth.startAutoRefresh()

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      removeNativeListener?.()
    }
  }, [])

  return null
}
