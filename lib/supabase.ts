import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Browser Supabase client - MUST be a singleton.
 *
 * Previously every page called createClient() and got its own GoTrueClient.
 * Each instance runs its own token-refresh timer against the SAME refresh
 * token in storage. Supabase has refresh-token reuse detection enabled
 * (10s window), so two instances refreshing seconds apart looks like a replay
 * attack and the whole session is revoked - which is why users were thrown
 * back to the login screen moments after leaving the app.
 *
 * One shared instance = one refresh timer = no false replay = no surprise logout.
 */
let browserClient: SupabaseClient | null = null

export function createSupabaseBrowserClient(): SupabaseClient {
  // During SSR/prerender there is no window; hand back a throwaway,
  // non-persisting client so nothing touches storage on the server.
  if (typeof window === 'undefined') {
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
  }

  if (browserClient) return browserClient

  browserClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    }
  )

  return browserClient
}

export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
