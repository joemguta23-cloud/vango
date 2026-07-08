import Link from 'next/link'
import Nav from '@/components/Nav'

const CATEGORIES = [
  { icon: '🧊', name: 'Fridge' }, { icon: '🌀', name: 'Washing Machine' },
  { icon: '🛏️', name: 'Mattress' }, { icon: '🛋️', name: 'Couch/Sofa' },
  { icon: '🖥️', name: 'TV / Desk' }, { icon: '🚪', name: 'Wardrobe' },
  { icon: '🍽️', name: 'Dining Table' }, { icon: '🧰', name: 'Tools / Gear' },
  { icon: '🏋️', name: 'Gym Equipment' }, { icon: '🌿', name: 'Garden' },
  { icon: '🧱', name: 'Building Materials' }, { icon: '📦', name: 'Other Large Items' },
]

const STEPS = [
  { n: '1', title: 'Post your item', desc: 'Take a photo, select the item type, and enter pickup and dropoff addresses. Done in under 2 minutes.' },
  { n: '2', title: 'Get matched instantly', desc: 'We find the nearest available ute or van driver and assign them your job. You see their name, vehicle, and ETA immediately.' },
  { n: '3', title: 'Track & receive', desc: "Get notified at every step. Pay the driver cash or PayID on delivery — we charge a small $11.99 service fee." },
]

export default function HomePage() {
  return (
    <div>
      <Nav />

      <section className="pt-32 pb-16 px-4 text-center max-w-3xl mx-auto">
        <h1 className="text-4xl sm:text-5xl font-black text-slate-800 mb-4">
          Big items, delivered <span className="text-orange-500">fast.</span>
        </h1>
        <p className="text-slate-500 text-lg mb-8">
          VanGo connects Melbourne buyers and sellers with nearby ute and van drivers for same-day large item delivery.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/signup?role=buyer" className="btn-primary justify-center text-base py-3 px-8">📦 I need delivery</Link>
          <Link href="/signup?role=driver" className="btn-secondary justify-center text-base py-3 px-8">🚐 Drive &amp; earn</Link>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 pb-16">
        <h2 className="text-xl font-black text-slate-800 mb-6 text-center">What can we move?</h2>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {CATEGORIES.map(c => (
            <div key={c.name} className="card p-4 text-center">
              <div className="text-3xl mb-2">{c.icon}</div>
              <div className="text-xs font-semibold text-slate-600">{c.name}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white border-y border-slate-200 py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-xl font-black text-slate-800 mb-10 text-center">How it works</h2>
          <div className="grid sm:grid-cols-3 gap-8">
            {STEPS.map(s => (
              <div key={s.n} className="text-center">
                <div className="w-10 h-10 rounded-full bg-orange-500 text-white font-black flex items-center justify-center mx-auto mb-4">{s.n}</div>
                <h3 className="font-bold text-slate-800 mb-2">{s.title}</h3>
                <p className="text-sm text-slate-500">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 px-4 text-center">
        <h2 className="text-2xl font-black text-slate-800 mb-4">Ready to get started?</h2>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/signup?role=buyer" className="btn-primary justify-center text-base py-3 px-8">Post a delivery</Link>
          <Link href="/signup?role=driver" className="btn-secondary justify-center text-base py-3 px-8">Become a driver</Link>
        </div>
      </section>

      <footer className="bg-slate-800 text-slate-300 py-12 px-4 mt-8">
        <div className="max-w-4xl mx-auto text-center text-sm space-y-2">
          <div className="text-lg font-black text-white">Van<span className="text-orange-400">Go</span></div>
          <p>Peer-to-peer large-item &amp; furniture delivery across Melbourne &amp; Victoria, Australia.</p>
          <p>
            VanGo is a service operated by <strong className="text-white">A.C.N. 681 822 426 Pty Ltd</strong>{' '}
            (ACN 681&nbsp;822&nbsp;426), a company registered in Australia, trading as &ldquo;Two Minute Van&rdquo;,
            based in Melbourne, Victoria, Australia.
          </p>
          <p>
            Contact:{' '}
            <a href="mailto:admin@getvango.com.au" className="text-orange-400 font-semibold hover:underline">admin@getvango.com.au</a>
          </p>
          <p className="space-x-4">
            <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
            <Link href="/account-deletion" className="hover:underline">Delete Account</Link>
          </p>
          <p className="text-slate-500 text-xs pt-2">© 2026 A.C.N. 681 822 426 Pty Ltd. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
