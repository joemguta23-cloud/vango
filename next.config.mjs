/** @type {import('next').NextConfig} */

// Legacy domains from the retired "VanGo" brand. They stay registered so old
// links, ads and business cards keep working, but every request is permanently
// redirected to the live Vanute domain — otherwise they serve a full duplicate
// copy of the site, which splits SEO and confuses customers.
//
// /api/* is deliberately EXCLUDED from the redirect. Stripe does not follow
// redirects when delivering webhooks, so if any webhook endpoint is still
// registered against a legacy host, redirecting it would silently break payment
// activation. Leaving /api reachable on the old host keeps those working while
// every human-visible page moves to vanute.com.au.
const LEGACY_HOSTS = ['getvango.com.au', 'www.getvango.com.au', 'getvango.online', 'www.getvango.online']

const nextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co' }],
  },
  async redirects() {
    return LEGACY_HOSTS.map((host) => ({
      source: '/:path((?!api/).*)',
      has: [{ type: 'host', value: host }],
      destination: 'https://www.vanute.com.au/:path',
      permanent: true,
    }))
  },
}

export default nextConfig
