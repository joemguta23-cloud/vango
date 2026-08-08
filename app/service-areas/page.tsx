import Link from 'next/link'
import Nav from '@/components/Nav'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Delivery Service Areas — Melbourne & Victoria',
  description:
    'Vanute provides large item and furniture delivery across Melbourne and Victoria — inner city, northern, western, eastern, southern and bayside suburbs. See the areas our ute and van drivers cover.',
  alternates: { canonical: 'https://vanute.com.au/service-areas' },
}

const AREAS = [
  { name: 'Inner Melbourne', suburbs: 'CBD, Carlton, Fitzroy, Collingwood, Richmond, South Yarra, Prahran, Southbank, Docklands' },
  { name: 'Northern suburbs', suburbs: 'Brunswick, Coburg, Preston, Northcote, Thornbury, Reservoir, Epping, Bundoora' },
  { name: 'Western suburbs', suburbs: 'Footscray, Yarraville, Sunshine, Werribee, Point Cook, Melton, Altona, Williamstown' },
  { name: 'Eastern suburbs', suburbs: 'Box Hill, Doncaster, Ringwood, Glen Waverley, Camberwell, Hawthorn, Kew, Croydon' },
  { name: 'Southern & bayside', suburbs: 'St Kilda, Brighton, Bentleigh, Cheltenham, Frankston, Mordialloc, Sandringham, Caulfield' },
  { name: 'Wider Victoria', suburbs: 'Geelong, Ballarat, Bendigo, Mornington Peninsula, Dandenong, Pakenham (on request)' },
]

export default function ServiceAreasPage() {
  return (
    <div>
      <Nav />
      <div className="max-w-4xl mx-auto px-6 pt-24 pb-16">
        <div className="text-xs font-bold text-orange-500 tracking-widest uppercase mb-2">Where we deliver</div>
        <h1 className="text-4xl font-black text-slate-800 mb-4">Large item delivery across Melbourne &amp; Victoria</h1>
        <p className="text-slate-600 leading-relaxed max-w-2xl mb-10">
          Vanute matches you with a nearby ute or van driver for large item and furniture delivery right across
          metropolitan Melbourne and regional Victoria. Whether it is a fridge from a Facebook Marketplace seller
          in Footscray, a couch from Gumtree in Brunswick, or a mattress across town, we cover it.
        </p>

        <div className="grid sm:grid-cols-2 gap-4 mb-12">
          {AREAS.map((a) => (
            <div key={a.name} className="card">
              <h2 className="font-bold text-lg mb-1">{a.name}</h2>
              <p className="text-slate-500 text-sm leading-relaxed">{a.suburbs}</p>
            </div>
          ))}
        </div>

        <div className="card bg-orange-50 border-orange-200 mb-10">
          <h2 className="font-bold text-lg mb-1 text-orange-800">Currently serving Victoria</h2>
          <p className="text-orange-700 text-sm leading-relaxed">
            Vanute operates across Victoria today, with Victoria set as the default region for all buyers and drivers.
            We are expanding to New South Wales, Queensland and the other Australian states soon — check back or sign
            up to be ready when we launch in your state.
          </p>
        </div>

        <div className="flex gap-4 flex-wrap items-center">
          <Link href="/signup?role=buyer" className="btn-primary px-6 py-3">📦 Post a Delivery Job</Link>
          <Link href="/faq" className="text-orange-500 font-semibold hover:underline">Read the FAQ →</Link>
        </div>
      </div>
    </div>
  )
}
