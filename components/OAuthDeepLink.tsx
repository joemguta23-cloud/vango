'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'

// Catches the vanute://auth/callback redirect that Google/Facebook/Apple
// sign-in lands on after the user finishes in the in-app browser (see
// SocialAuthButtons -> signInNative). A custom URL scheme never touches the
// app's own WKWebView location, so Supabase's normal detectSessionInUrl
// parsing - which works fine on the plain web build - never runs for native
// sign-in. This listener does that job by hand: pull the tokens (or PKCE
// code) out of the deep-link URL, hand them to supabase-js so the session is
// persisted the same way a web sign-in would be, then route to the existing
// /auth/callback page so its role-based routing logic runs unchanged.
//
// IMPORTANT: iOS hands appUrlOpen to the app the instant it sees the
// vanute:// scheme, but the in-app browser (SFSafariViewController, opened
// via @capacitor/browser) does NOT dismiss itself just because the app
// received the link -- it just fails to navigate and sits there, frozen on
// whatever "redirecting..." interstitial Supabase/Google was showing right
// before the handoff. Without an explicit Browser.close() call here, the
// sign-in silently succeeds behind the scenes while the user stares at a
// stuck browser sheet forever. This was the exact bug behind reports of
// Google sign-in hanging on "Redirecting..." and never completing.
export default function OAuthDeepLink() {
  const router = useRouter()

  useEffect(() => {
    let removeListener: (() => void) | undefined

    void (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (!Capacitor.isNativePlatform()) return
        const { App } = await import('@capacitor/app')
        const { Browser } = await import('@capacitor/browser')

        const handle = await App.addListener('appUrlOpen', async ({ url }: { url: string }) => {
          if (!url.startsWith('vanute://auth/callback')) return

          // Dismiss the in-app browser immediately -- see note above. Safe to
          // call even if it's already closed.
          try { await Browser.close() } catch { /* already closed */ }

          const supabase = createSupabaseBrowserClient()

          let parsed: URL
          try {
            // A custom-scheme URL isn't a valid base for the URL() parser;
            // swap the scheme for https so both the query and #fragment parse.
            parsed = new URL(url.replace('vanute://', 'https://vanute.invalid/'))
          } catch {
            router.replace('/login?error=oauth')
            return
          }

          const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''))
          const accessToken = hashParams.get('access_token')
          const refreshToken = hashParams.get('refresh_token')
          const code = parsed.searchParams.get('code')
          const role = parsed.searchParams.get('role')

          try {
            if (accessToken && refreshToken) {
              const { error } = await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
              })
              if (error) throw error
            } else if (code) {
              const { error } = await supabase.auth.exchangeCodeForSession(code)
              if (error) throw error
            } else {
              throw new Error('No session data in OAuth redirect')
            }
          } catch {
            router.replace('/login?error=oauth')
            return
          }

          const dest = role ? '/auth/callback?role=' + encodeURIComponent(role) : '/auth/callback'
          router.replace(dest)
        })

        removeListener = () => { void handle.remove() }
      } catch {
        /* plain web build - Capacitor not present */
      }
    })()

    return () => removeListener?.()
  }, [router])

  return null
}
