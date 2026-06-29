import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'VanGo — Large Item Delivery, Melbourne',
  description: 'Peer-to-peer delivery for large Marketplace purchases across Melbourne & Victoria.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>)
}
