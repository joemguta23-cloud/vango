'use client'
import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

// Social sign-in buttons (Google / Facebook / Apple) shown on the login and
// signup pages alongside the email/password form. Uses Supabase OAuth: the
// provider redirects back to /auth/callback, where the session is picked up
// and the user is routed by role. Pass `role` on the signup page so a brand
// new driver lands in driver onboarding instead of the customer flow.
//
// In the native app (Capacitor) a plain HTTPS redirectTo would hand the user
// off to Safari/Chrome with no way back into the app - Google specifically
// refuses to complete OAuth inside an embedded WebView at all. So on native
// we request a vanute:// redirect instead, open the provider URL in an
// in-app browser tab (@capacitor/browser), and let OAuthDeepLink (mounted in
// app/layout.tsx) catch the vanute://auth/callback return, close the in-app
// browser, and finish sign-in.
type Provider = 'google' | 'facebook' | 'apple'

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>
    <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/>
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
  </svg>
)
const FacebookIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#1877F2" d="M24 12a12 12 0 1 0-13.88 11.85v-8.38H7.08V12h3.04V9.36c0-3 1.79-4.67 4.53-4.67 1.31 0 2.68.24 2.68.24v2.95h-1.51c-1.49 0-1.96.93-1.96 1.87V12h3.33l-.53 3.47h-2.8v8.38A12 12 0 0 0 24 12z"/>
  </svg>
)
const AppleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M16.36 12.78c.02 2.53 2.22 3.37 2.24 3.38-.02.06-.35 1.2-1.16 2.38-.7 1.02-1.42 2.03-2.56 2.05-1.12.02-1.48-.66-2.76-.66-1.28 0-1.68.64-2.74.68-1.1.04-1.94-1.1-2.65-2.12-1.44-2.08-2.55-5.88-1.06-8.45.74-1.27 2.06-2.08 3.49-2.1 1.08-.02 2.1.73 2.76.73.66 0 1.9-.9 3.2-.77.55.02 2.08.22 3.07 1.67-.08.05-1.83 1.07-1.81 3.2M14.2 4.6c.59-.72.99-1.71.88-2.7-.85.03-1.88.57-2.49 1.28-.55.63-1.03 1.64-.9 2.61.95.07 1.92-.48 2.51-1.19"/>
  </svg>
)

const PROVIDERS: { id: Provider; label: string; Icon: () => JSX.Element }[] = [
  { id: 'google', label: 'Continue with Google', Icon: GoogleIcon },
  { id: 'facebook', label: 'Continue with Facebook', Icon: FacebookIcon },
  { id: 'apple', label: 'Continue with Apple', Icon: AppleIcon },
]

const oauthErrorMessage = (message: string) =>
  /not enabled/i.test(message)
    ? 'This sign-in option is being set up — please use email for now.'
    : message

export default function SocialAuthButtons({ role }: { role?: string }) {
  const supabase = createSupabaseBrowserClient()
  const [busy, setBusy] = useState<Provider | null>(null)
  const [error, setError] = useState('')

  const signInNative = async (provider: Provider) => {
    const redirectTo = `vanute://auth/callback${role ? `?role=${encodeURIComponent(role)}` : ''}`
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    })
    if (error) {
      setError(oauthErrorMessage(error.message))
      setBusy(null)
      return
    }
    if (!data?.url) {
      setError('Could not start sign-in. Please try again.')
      setBusy(null)
      return
    }
    const { Browser } = await import('@capacitor/browser')
    // If the user closes the in-app browser without finishing, re-enable the
    // button instead of leaving it stuck on "Redirecting…" forever.
    const handle = await Browser.addListener('browserFinished', () => {
      setBusy(null)
      void handle.remove()
    })
    // Safety net: OAuthDeepLink.tsx normally clears this by navigating the
    // page away once the vanute://auth/callback deep link comes back and the
    // browser is closed. If that handoff ever fails for an unrelated reason
    // (network hiccup, an OS quirk), this stops the button being stuck on
    // "Redirecting…" forever -- the person can just try again.
    setTimeout(() => setBusy(prev => (prev === provider ? null : prev)), 45000)
    await Browser.open({ url: data.url })
  }

  const signInWeb = async (provider: Provider) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://www.vanute.com.au'
    const redirectTo = `${origin}/auth/callback${role ? `?role=${encodeURIComponent(role)}` : ''}`
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } })
    // On success the browser is redirected to the provider; on failure we stay.
    if (error) {
      setError(oauthErrorMessage(error.message))
      setBusy(null)
    }
  }

  const signIn = async (provider: Provider) => {
    setBusy(provider)
    setError('')

    let isNative = false
    try {
      const { Capacitor } = await import('@capacitor/core')
      isNative = Capacitor.isNativePlatform()
    } catch {
      isNative = false // plain web build - @capacitor/core isn't resolvable
    }

    if (isNative) await signInNative(provider)
    else await signInWeb(provider)
  }

  return (
    <div className="space-y-2.5">
      {PROVIDERS.map(p => (
        <button
          key={p.id}
          type="button"
          onClick={() => signIn(p.id)}
          disabled={busy !== null}
          className="w-full flex items-center justify-center gap-2.5 border border-slate-300 bg-white rounded-xl py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          <p.Icon />
          {busy === p.id ? 'Redirecting…' : p.label}
        </button>
      ))}
      {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
    </div>
  )
}
