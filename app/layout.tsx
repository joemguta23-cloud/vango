import type { Metadata, Viewport } from 'next'
import './globals.css'

const SITE_URL = 'https://getvango.com.au'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'VanGo — Large Item & Furniture Delivery in Melbourne, Victoria',
    template: '%s | VanGo Melbourne',
  },
  description:
    "VanGo is Melbourne's peer-to-peer delivery service for large Facebook Marketplace and Gumtree items — fridges, mattresses, couches and furniture — matched to a nearby ute or van driver in minutes. Servicing Melbourne and all of Victoria.",
  keywords: [
    'VanGo', 'VanGo Melbourne', 'VanGo delivery', 'getvango', 'get vango',
    'large item delivery Melbourne', 'furniture delivery Melbourne',
    'ute delivery Melbourne', 'van delivery Melbourne', 'fridge delivery Melbourne',
    'mattress delivery Melbourne', 'couch delivery Melbourne',
    'Facebook Marketplace delivery Melbourne', 'Gumtree pickup Melbourne',
    'man with a van Melbourne', 'same day delivery Melbourne Victoria',
  ],
  authors: [{ name: 'VanGo' }],
  creator: 'VanGo',
  publisher: 'Two Minute Van Pty Ltd',
  applicationName: 'VanGo',
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'VanGo',
    title: 'VanGo — Large Item & Furniture Delivery in Melbourne',
    description:
      'Post your Marketplace pickup and get matched with a nearby ute or van driver in minutes. Servicing Melbourne & Victoria.',
    locale: 'en_AU',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'VanGo — Large Item Delivery, Melbourne',
    description: 'Peer-to-peer large item & furniture delivery across Melbourne & Victoria.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  verification: { google: 'dyoSU1TriG1mmeYc18waERFOEYHmpXordDkWKc3lkCo' },
  category: 'Delivery Service',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  '@id': `${SITE_URL}/#business`,
  name: 'VanGo',
  legalName: 'Two Minute Van Pty Ltd',
  url: SITE_URL,
  description:
    'Peer-to-peer delivery marketplace for large Facebook Marketplace and Gumtree items — fridges, mattresses, couches and furniture — across Melbourne and Victoria.',
  areaServed: { '@type': 'State', name: 'Victoria', containedInPlace: { '@type': 'Country', name: 'Australia' } },
  address: {
    '@type': 'PostalAddress',
    addressLocality: 'Melbourne',
    addressRegion: 'VIC',
    addressCountry: 'AU',
  },
  priceRange: '$$',
  slogan: 'Your marketplace pickup, sorted in minutes.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
