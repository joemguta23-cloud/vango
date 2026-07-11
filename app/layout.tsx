import type { Metadata, Viewport } from 'next'
import './globals.css'

const SITE_URL = 'https://getvango.com.au'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Vanute — Large Item & Furniture Delivery in Melbourne, Victoria',
    template: '%s | Vanute Melbourne',
  },
  description:
    "Vanute (Get Vanute) is Melbourne's peer-to-peer delivery service for large Facebook Marketplace and Gumtree items — fridges, mattresses, couches and furniture — matched to a nearby ute or van driver in minutes. Servicing Melbourne and all of Victoria.",
  keywords: [
    'Vanute', 'Vanute Melbourne', 'Vanute delivery', 'getvanute', 'get vanute',
    'get van ute', 'van ute', 'van ute delivery Melbourne', 'vanute delivery', 'vanute melbourne delivery',
    'large item delivery Melbourne', 'furniture delivery Melbourne',
    'ute delivery Melbourne', 'van delivery Melbourne', 'fridge delivery Melbourne',
    'mattress delivery Melbourne', 'couch delivery Melbourne',
    'Facebook Marketplace delivery Melbourne', 'Gumtree pickup Melbourne',
    'man with a van Melbourne', 'same day delivery Melbourne Victoria',
  ],
  authors: [{ name: 'Vanute' }],
  creator: 'Vanute',
  publisher: 'Two Minute Van Pty Ltd',
  applicationName: 'Vanute',
  alternates: { canonical: SITE_URL },
  icons: {
    icon: [{ url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAMAAABg3Am1AAAAkFBMVEXj3teeqZjmZR/dkWNcZ1P5y7AgW56UbFptinQzWjjdspanjXMgT2KftM/de0YzIRtZNSSpXDD8gDq7xLgAN2BUfrJ1lYK4z81vUT3uPwD+/v72VgHrSAD5hkf1SgDsVAMGSZkXTpL2dzL6rIL6u5cYUZr6mmX5cyj6p3dbg7WAVE75klmKnIj5sooETaAWSothmS/mAAABsElEQVR42u2UaZOcIBCGmwbEc849Eq7JKKIZdff//7uAY7KVWacq+ZZUzUsXttCPDRQtyL8UPIAH8K8CAPCHwNTzps/Zdrsl94Dq+fui50pKbzqNu+1utyvuAPAtKrn2UvamVsCEoHSfwxpQkTZprxZaBTMQwsUXsS9WgOqpTNrzuX0/t6GVTwmNABRUiGKP/DNAyhAb9L70iZ8BxM0G88bCLfD6Ghb/tthbsJhBS4qobC4lVfAbwCmdxIVdGLsIcYliAmmtJ7pHpalzB43ewQfgvyqtbmSH2ppu9qy9DnUeFoBqvI1XekB68MExxpvwiBFYuyXDz++ftNYfgHFu6h03nDdNSKQUle56U3qtT7PUYejs7Jz00CloOEy8cQ5yZcJMx6flavWnGVGOpKRRM6vjHupwuDWtDfU8TYnHruPLcQ3YIdopTRl78Tbu0xrUv2RzFmbIIYzGfY8kqCDgCIMNlHkzi/cbs2jTpy+cQpYbEw8XFkk5MmqLkqxcdpaiJVlcDpB0JGOw+HJkUMhsrURICgTY5wIasywjq/XEwgysVBwc75UgHB8/sgfwvwE/AFNG4OOoeCRZAAAAAElFTkSuQmCC', type: 'image/png' }],
    shortcut: [{ url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAMAAABg3Am1AAAAkFBMVEXj3teeqZjmZR/dkWNcZ1P5y7AgW56UbFptinQzWjjdspanjXMgT2KftM/de0YzIRtZNSSpXDD8gDq7xLgAN2BUfrJ1lYK4z81vUT3uPwD+/v72VgHrSAD5hkf1SgDsVAMGSZkXTpL2dzL6rIL6u5cYUZr6mmX5cyj6p3dbg7WAVE75klmKnIj5sooETaAWSothmS/mAAABsElEQVR42u2UaZOcIBCGmwbEc849Eq7JKKIZdff//7uAY7KVWacq+ZZUzUsXttCPDRQtyL8UPIAH8K8CAPCHwNTzps/Zdrsl94Dq+fui50pKbzqNu+1utyvuAPAtKrn2UvamVsCEoHSfwxpQkTZprxZaBTMQwsUXsS9WgOqpTNrzuX0/t6GVTwmNABRUiGKP/DNAyhAb9L70iZ8BxM0G88bCLfD6Ghb/tthbsJhBS4qobC4lVfAbwCmdxIVdGLsIcYliAmmtJ7pHpalzB43ewQfgvyqtbmSH2ppu9qy9DnUeFoBqvI1XekB68MExxpvwiBFYuyXDz++ftNYfgHFu6h03nDdNSKQUle56U3qtT7PUYejs7Jz00CloOEy8cQ5yZcJMx6flavWnGVGOpKRRM6vjHupwuDWtDfU8TYnHruPLcQ3YIdopTRl78Tbu0xrUv2RzFmbIIYzGfY8kqCDgCIMNlHkzi/cbs2jTpy+cQpYbEw8XFkk5MmqLkqxcdpaiJVlcDpB0JGOw+HJkUMhsrURICgTY5wIasywjq/XEwgysVBwc75UgHB8/sgfwvwE/AFNG4OOoeCRZAAAAAElFTkSuQmCC', type: 'image/png' }],
  },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'Vanute',
    title: 'Vanute — Large Item & Furniture Delivery in Melbourne',
    description:
      'Post your Marketplace pickup and get matched with a nearby ute or van driver in minutes. Servicing Melbourne & Victoria.',
    locale: 'en_AU',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vanute — Large Item Delivery, Melbourne',
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
  name: 'Vanute',
  alternateName: ['Get Vanute', 'GetVanute', 'Get Van Ute', 'Van Ute', 'Vanute Melbourne'],
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
