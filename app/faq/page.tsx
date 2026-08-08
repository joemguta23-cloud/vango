import Link from 'next/link'
import Nav from '@/components/Nav'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Large Item Delivery Melbourne — FAQ',
  description:
    'Answers about Vanute large item and furniture delivery in Melbourne & Victoria — costs, what we carry, Facebook Marketplace & Gumtree pickups, payment, and becoming a driver.',
  alternates: { canonical: 'https://vanute.com.au/faq' },
}

const FAQS = [
  {
    q: 'How does Vanute delivery work in Melbourne?',
    a: 'Post your item with a photo plus pickup and dropoff addresses, and Vanute matches you with the nearest available ute or van driver in Melbourne. You see the driver, their vehicle and ETA, and track the delivery live. Most jobs are matched in minutes.',
  },
  {
    q: 'How much does large item delivery cost in Melbourne?',
    a: 'The driver fee depends on item size and distance — typically from around $55 for a medium item up to $130+ for extra-large items, plus a small distance surcharge. Vanute adds a flat $12 service fee. You pay the driver in cash on delivery and the $12 by card when you post the job.',
  },
  {
    q: 'Can Vanute deliver a Facebook Marketplace or Gumtree purchase?',
    a: 'Yes — that is exactly what Vanute is built for. Bought a fridge, couch or mattress on Facebook Marketplace or Gumtree in Melbourne? Post the pickup and dropoff addresses and a nearby ute or van driver collects it from the seller and delivers it to your door.',
  },
  {
    q: 'What items can Vanute deliver?',
    a: 'Large and bulky goods: fridges, washing machines, mattresses, couches and sofas, TVs and desks, wardrobes, dining tables, gym equipment, garden items, building materials and other large items that will not fit in a normal car.',
  },
  {
    q: 'Which areas of Melbourne and Victoria does Vanute cover?',
    a: 'Vanute currently operates across metropolitan Melbourne and Victoria — inner city, northern, southern, eastern, western and bayside suburbs. See our service areas page for details. We are expanding to other Australian states soon.',
  },
  {
    q: 'How do I pay for my delivery?',
    a: 'You pay the driver fee in cash directly to the driver on delivery. Vanute’s flat $12 service fee is charged to your card (Apple Pay and Google Pay supported) at the moment you post the job.',
  },
  {
    q: 'How fast can I get something delivered in Melbourne?',
    a: 'Most deliveries are matched within minutes and completed the same day. You can also schedule a pickup for later if that suits you better.',
  },
  {
    q: 'How do I become a Vanute driver in Melbourne?',
    a: 'If you have a ute or van, sign up as a driver, add your vehicle and licence details, and start accepting delivery jobs near you. You set your own hours and get paid cash on every delivery. There is no sign-up fee.',
  },
]

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
}

export default function FaqPage() {
  return (
    <div>
      <Nav />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <div className="max-w-3xl mx-auto px-6 pt-24 pb-16">
        <div className="text-xs font-bold text-orange-500 tracking-widest uppercase mb-2">Help &amp; FAQ</div>
        <h1 className="text-4xl font-black text-slate-800 mb-8">Large item delivery in Melbourne — your questions answered</h1>
        <div className="space-y-5">
          {FAQS.map((f) => (
            <div key={f.q} className="card">
              <h2 className="font-bold text-lg mb-2">{f.q}</h2>
              <p className="text-slate-600 leading-relaxed">{f.a}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 flex gap-4 flex-wrap items-center">
          <Link href="/signup?role=buyer" className="btn-primary px-6 py-3">📦 Post a Delivery Job</Link>
          <Link href="/service-areas" className="text-orange-500 font-semibold hover:underline">See service areas →</Link>
        </div>
      </div>
    </div>
  )
}
